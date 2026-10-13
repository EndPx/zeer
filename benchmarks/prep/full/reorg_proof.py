"""Bounded real-node reorg proof on an explicitly disposable, peerless Regtest.

This MUTATES the private source node with invalidateblock and generate. Never
use an application node. The caller supplies a disposable copy, an explicit
expected head, and --allow-disposable-regtest-mutation. Before each mutation we
check the actual Regtest genesis, private endpoint, peer count and bounded head.

Pinned RPC implementation:
https://github.com/ZcashFoundation/zebra/blob/v6.2.3/zebra-rpc/src/methods.rs#L663-L693
This proves recovery from an administrative canonical branch replacement. It
does not demonstrate naturally occurring P2P consensus reorgs or mainnet safety.
"""

import argparse
import hashlib
import http.client
import ipaddress
import json
import os
import pathlib
import socket
import time
import urllib.parse

REGTEST_GENESIS = "029f11d80ef9765602235e1bc9727e3eb6ba20839319f761fee920d63401e327"
MAX_BODY = 32 * 1024 * 1024


def require(condition, message):
    if not condition:
        raise ValueError(message)


def private_ip(address):
    ip = ipaddress.ip_address(address)
    if ip.is_loopback:
        return True
    allowed = ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7")
    return any(ip in ipaddress.ip_network(network) for network in allowed)


class PrivateEndpoint:
    def __init__(self, url, token=None):
        parsed = urllib.parse.urlsplit(url)
        require(parsed.scheme == "http" and parsed.hostname and
                not parsed.username and not parsed.password and
                not parsed.query and not parsed.fragment and
                parsed.path in ("", "/"), "private_plaintext_root_endpoint_required")
        self.host, self.port, self.token = parsed.hostname, parsed.port or 80, token

    def request(self, path, body=None):
        # Resolve and validate on EVERY call; connect directly to that IP, so no
        # redirect or second DNS lookup can redirect a mutation to a public node.
        addresses = list(dict.fromkeys(
            item[4][0] for item in socket.getaddrinfo(
                self.host, self.port, type=socket.SOCK_STREAM)))
        require(addresses and all(private_ip(ip) for ip in addresses),
                "endpoint_must_resolve_only_to_private_addresses")
        headers = {"Content-Type": "application/json", "Host": self.host}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        connection = http.client.HTTPConnection(addresses[0], self.port, timeout=20)
        try:
            connection.request("GET" if body is None else "POST", path,
                               None if body is None else json.dumps(body), headers)
            response = connection.getresponse()
            raw = response.read(MAX_BODY + 1)
            require(len(raw) <= MAX_BODY, "response_size_limit")
            return response.status, json.loads(raw)
        finally:
            connection.close()

    def rpc(self, method, params):
        status, body = self.request("/", {
            "jsonrpc": "2.0", "id": 1, "method": method, "params": params})
        require(status == 200 and body.get("id") == 1 and not body.get("error"),
                "rpc_failed_" + method)
        return body["result"]


def guard_source(source, expected_height):
    info = source.rpc("getblockchaininfo", [])
    require(info.get("chain") in ("test", "regtest"), "regtest_chain_alias_required")
    require(source.rpc("getblockhash", [0]) == REGTEST_GENESIS,
            "known_regtest_genesis_required")
    require(source.rpc("getpeerinfo", []) == [], "peerless_node_required")
    require(2 <= expected_height <= 10_000 and info["blocks"] == expected_height,
            "unexpected_or_unbounded_node_height")
    return info


def wait_until(check, timeout, message):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
        time.sleep(0.5)
    raise ValueError(message)


def execute(args):
    require(args.allow_disposable_regtest_mutation, "explicit_disposable_mutation_flag_required")
    require(not args.out.exists(), "refusing_existing_result")
    confirmation_lag = max(args.confirmations - 1, 0)
    require(args.confirmations in (0, 1, 2) and confirmation_lag < args.depth,
            "confirmation_count_must_expose_replaced_block")
    require(1 <= args.depth <= 5 and 1 <= args.from_block < args.expected_head - args.depth
            and args.expected_head - args.from_block <= 30,
            "small_reorg_and_surviving_prefix_required")
    require(5 <= args.timeout <= 300, "bounded_timeout_required")
    source = PrivateEndpoint(args.source)
    prep = PrivateEndpoint(args.prep, os.environ.get("PREP_API_TOKEN"))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    journal = args.out.with_suffix(".journal.jsonl")
    require(not journal.exists(), "refusing_existing_journal")

    def record(stage, **values):
        with journal.open("a", encoding="utf-8") as file:
            file.write(json.dumps({"stage": stage, "unix_time": time.time(), **values}) + "\n")

    guard_source(source, args.expected_head)
    initial_indexed = args.expected_head - confirmation_lag
    common_height = args.expected_head - args.depth
    old_hashes = {str(n): source.rpc("getblockhash", [n])
                  for n in range(args.from_block, args.expected_head + 1)}
    status, before = prep.request("/height")
    require(status == 200 and before["ready"] and before["network"] == "regtest" and
            before["archive_height"] == initial_indexed, "prep_must_match_initial_head")
    selection = {"block": ["height", "hash", "previous_hash", "raw"],
                 "transaction": ["txid", "block_height", "index", "raw"]}
    old_query = {"from_block": args.from_block, "to_block": initial_indexed + 1,
                 "limit": 1, "field_selection": selection}
    status, old_page = prep.request("/query", old_query)
    require(status == 200 and old_page["cursor"] and
            old_page["data"]["blocks"][0]["hash"] == old_hashes[str(args.from_block)],
            "initial_page_or_cursor_invalid")
    # Verify the archive actually holds the soon-to-be-orphaned tip before the
    # source changes, rather than merely trusting its reported height.
    status, old_tip = prep.request("/query", {
        "from_block": initial_indexed, "to_block": initial_indexed + 1,
        "limit": 1, "field_selection": selection})
    require(status == 200 and old_tip["data"]["blocks"][0]["hash"] == old_hashes[str(initial_indexed)],
            "prep_old_tip_not_equal_to_node")
    record("initial", source_height=args.expected_head, old_hashes=old_hashes,
           epoch=old_page["epoch"], common_height=common_height)

    guard_source(source, args.expected_head)
    invalidated_hash = old_hashes[str(common_height + 1)]
    source.rpc("invalidateblock", [invalidated_hash])
    wait_until(lambda: source.rpc("getblockchaininfo", [])["blocks"] == common_height,
               args.timeout, "node_did_not_rewind")
    record("node_invalidated", invalidated_hash=invalidated_hash,
           source_height=common_height)
    guard_source(source, common_height)
    replacement = source.rpc("generate", [args.depth + 1])
    final_height = args.expected_head + 1
    final_indexed = final_height - confirmation_lag
    require(len(replacement) == args.depth + 1, "unexpected_generated_count")
    guard_source(source, final_height)
    require(source.rpc("getblockhash", [common_height]) == old_hashes[str(common_height)],
            "common_ancestor_changed")
    require(all(source.rpc("getblockhash", [n]) != old_hashes[str(n)]
                for n in range(common_height + 1, args.expected_head + 1)),
            "replacement_did_not_change_canonical_branch")
    record("node_replaced_branch", source_height=final_height, new_hashes=replacement)

    def ready_after_reorg():
        status, body = prep.request("/height")
        if status == 200 and body.get("ready") and body.get("archive_height") == final_indexed:
            return body
        return None

    after = wait_until(ready_after_reorg, args.timeout, "prep_did_not_recover")
    require(int(after["epoch"]) > int(old_page["epoch"]), "epoch_did_not_advance")
    cursor_status, invalid_cursor = prep.request("/query", {**old_query, "cursor": old_page["cursor"]})
    require(cursor_status == 409 and invalid_cursor.get("error", {}).get("code") == "REORG",
            "old_cursor_not_rejected_with_409_REORG")

    query = {**old_query, "to_block": final_indexed + 1, "limit": 2}
    blocks, transactions, cursor = [], [], None
    for _ in range(20):
        request = {**query, **({"cursor": cursor} if cursor else {})}
        status, page = prep.request("/query", request)
        require(status == 200 and page["epoch"] == after["epoch"], "canonical_page_error")
        blocks.extend(page["data"]["blocks"])
        transactions.extend(page["data"]["transactions"])
        cursor = page["cursor"]
        if cursor is None:
            require(page["next_block"] == final_indexed + 1, "incomplete_scan")
            break
    else:
        raise ValueError("scan_page_bound")
    require([b["height"] for b in blocks] == list(range(args.from_block, final_indexed + 1)),
            "duplicate_or_missing_block")
    expected_transactions, checked = [], []
    for block in blocks:
        canonical = source.rpc("getblockhash", [block["height"]])
        raw = source.rpc("getblock", [canonical, 0])
        decoded = source.rpc("getblock", [canonical, 2])
        require(block["hash"] == canonical and block["raw"] == raw and
                block["previous_hash"] == decoded["previousblockhash"], "canonical_block_mismatch")
        expected_transactions.extend({"txid": tx["txid"], "block_height": block["height"],
                                      "index": index, "raw": tx["hex"]}
                                     for index, tx in enumerate(decoded["tx"]))
        checked.append({"height": block["height"], "hash": canonical,
                        "raw_sha256": hashlib.sha256(bytes.fromhex(raw)).hexdigest()})
    require(transactions == expected_transactions, "missing_duplicate_or_incorrect_transactions")
    identities = [(tx["block_height"], tx["index"]) for tx in transactions]
    require(len(identities) == len(set(identities)), "duplicate_transaction_location")
    require(after["source_height"] == final_height and after["lag_blocks"] == confirmation_lag,
            "source_progress_not_caught_up")
    require(source.rpc("getblockchaininfo", [])["bestblockhash"] == replacement[-1],
            "source_changed_during_verification")
    result = {"schema_version": 1, "status": "PASS", "network": "isolated-regtest",
              "method": "Zebra invalidateblock followed by generate on a disposable peerless node",
              "initial_height": args.expected_head, "final_height": final_height,
              "confirmations": args.confirmations, "final_indexed_height": final_indexed,
              "common_ancestor_height": common_height, "replaced_block_count": args.depth,
              "invalidated_hash": invalidated_hash, "replacement_hashes": replacement,
              "old_epoch": old_page["epoch"], "new_epoch": after["epoch"],
              "old_cursor_http_status": cursor_status,
              "old_cursor_error": invalid_cursor["error"]["code"],
              "verified_blocks": checked, "verified_transactions": len(transactions),
              "no_missing_or_duplicate_blocks_or_transactions": True,
              "raw_blocks_and_transactions_equal_node": True, "lag_blocks": after["lag_blocks"],
              "limitations": "Administrative real-node Regtest reorg; not natural P2P, mainnet or deep-reorg proof."}
    args.out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    record("pass", new_epoch=after["epoch"])
    print(json.dumps(result, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--prep", required=True)
    parser.add_argument("--expected-head", type=int, required=True)
    parser.add_argument("--from-block", type=int, default=1020)
    parser.add_argument("--depth", type=int, default=2)
    parser.add_argument("--confirmations", type=int, choices=(0, 1, 2), default=1)
    parser.add_argument("--timeout", type=float, default=90)
    parser.add_argument("--allow-disposable-regtest-mutation", action="store_true")
    parser.add_argument("--out", type=pathlib.Path, required=True)
    execute(parser.parse_args())


if __name__ == "__main__":
    main()
