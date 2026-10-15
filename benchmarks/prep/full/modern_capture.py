"""Capture three genuine NU5 blocks for bounded, offline Prep compatibility proof.

Raw blocks come from pinned official Zebra fixtures; decoded transactions come
from CipherScan's documented node-backed verbose API. The RPC block envelope is
synthesized from the parsed raw header. This is NOT a live full-node source, a
consensus validation, or a benchmark. No wallet/viewing keys are involved.
"""
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import struct
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HEIGHTS = (1687106, 1687107, 1687108)
API = "https://api.mainnet.cipherscan.app/api"
ZEBRA_TAG = "v6.2.3"
MAX_BODY = 4 * 1024 * 1024


class NumberToken(str):
    """A source JSON decimal/exponent token, never routed through binary float."""


def parse_json(text):
    return json.loads(text, parse_float=NumberToken)


def exact_json(value):
    if isinstance(value, NumberToken):
        return str(value)
    if isinstance(value, dict):
        return "{" + ",".join(json.dumps(k) + ":" + exact_json(v) for k, v in value.items()) + "}"
    if isinstance(value, list):
        return "[" + ",".join(exact_json(v) for v in value) + "]"
    return json.dumps(value, separators=(",", ":"), allow_nan=False)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def compact_size(raw, offset):
    first = raw[offset]
    if first < 253:
        return first, offset + 1
    length = {253: 2, 254: 4, 255: 8}[first]
    end = offset + 1 + length
    if end > len(raw):
        raise ValueError("truncated CompactSize")
    value = int.from_bytes(raw[offset + 1:end], "little")
    if value < {253: 253, 254: 65536, 255: 4294967296}[first]:
        raise ValueError("noncanonical CompactSize")
    return value, end


def header(raw, height):
    if len(raw) < 141:
        raise ValueError("truncated block")
    solution_len, start = compact_size(raw, 140)
    end = start + solution_len
    if end >= len(raw):
        raise ValueError("truncated solution")
    count, tx_start = compact_size(raw, end)
    digest = hashlib.sha256(hashlib.sha256(raw[:end]).digest()).digest()[::-1].hex()
    return {
        "height": height, "hash": digest, "previousblockhash": raw[4:36][::-1].hex(),
        "version": struct.unpack_from("<i", raw)[0], "merkleroot": raw[36:68][::-1].hex(),
        "blockcommitments": raw[68:100][::-1].hex(), "time": struct.unpack_from("<I", raw, 100)[0],
        "bits": raw[104:108][::-1].hex(), "nonce": raw[108:140][::-1].hex(),
        "solution": raw[start:end].hex(), "size": len(raw), "nTx": count,
    }, tx_start


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Zeer-bounded-public-data-proof/1.0"})
    with urllib.request.urlopen(req, timeout=30) as response:
        body = response.read(MAX_BODY + 1)
        if len(body) > MAX_BODY:
            raise ValueError("capture response exceeds 4 MiB")
        return body, {"requested_url": url, "resolved_url": response.url,
                      "sha256": sha(body), "bytes": len(body)}


def capture(directory):
    directory.mkdir(parents=True, exist_ok=False)
    ref_body, ref_source = fetch(f"https://api.github.com/repos/ZcashFoundation/zebra/git/ref/tags/{ZEBRA_TAG}")
    ref = json.loads(ref_body)["object"]
    if ref["type"] == "tag":
        tag_body, _ = fetch(ref["url"])
        ref = json.loads(tag_body)["object"]
    if ref["type"] != "commit":
        raise ValueError("tag does not resolve to a commit")
    commit = ref["sha"]
    sources = [ref_source]
    observations = []
    blocks = []
    totals = {"transactions": 0, "sapling_transactions": 0, "orchard_transactions": 0,
              "sapling_spends": 0, "sapling_outputs": 0, "orchard_actions": 0}
    for height in HEIGHTS:
        filename = f"block-main-{height // 1000000}-{height // 1000 % 1000:03}-{height % 1000:03}.txt"
        raw_body, source = fetch(f"https://raw.githubusercontent.com/ZcashFoundation/zebra/{commit}/zebra-test/src/vectors/{filename}")
        sources.append(source)
        raw = bytes.fromhex(raw_body.decode())
        info, tx_start = header(raw, height)
        api_body, source = fetch(f"{API}/block/{height}")
        sources.append(source)
        listing = parse_json(api_body)
        assert listing["hash"] == info["hash"]
        assert int(listing["transaction_count"]) == info["nTx"] == len(listing["transactions"])
        if int(listing["size"]) != len(raw):
            observations.append({"height": height, "explorer_reported_size": int(listing["size"]),
                                 "official_raw_size": len(raw), "decision": "Use exact raw byte length; explorer metadata differs."})
        assert listing["previous_block_hash"] == info["previousblockhash"]
        assert int(listing["timestamp"]) == info["time"]
        txs, tx_bytes = [], []
        for summary in listing["transactions"]:
            txid = summary["txid"]
            body, source = fetch(f"{API}/tx/{txid}/verbose")
            sources.append(source)
            item = parse_json(body)
            tx = item["decoded"]
            assert tx["txid"] == item["txid"] == txid
            assert tx["hex"] == item["hex"]
            assert tx["blockhash"] == info["hash"]
            txs.append(tx)
            tx_bytes.append(bytes.fromhex(tx["hex"]))
            spends, outputs = len(tx.get("vShieldedSpend", [])), len(tx.get("vShieldedOutput", []))
            actions = len(tx.get("orchard", {}).get("actions", []))
            totals["transactions"] += 1
            totals["sapling_transactions"] += bool(spends or outputs)
            totals["orchard_transactions"] += bool(actions)
            totals["sapling_spends"] += spends
            totals["sapling_outputs"] += outputs
            totals["orchard_actions"] += actions
        assert b"".join(tx_bytes) == raw[tx_start:], "all transaction bytes must exactly exhaust official full block"
        if blocks:
            assert info["previousblockhash"] == blocks[-1]["decoded"]["hash"]
        info["tx"] = txs
        blocks.append({"raw": raw.hex(), "raw_sha256": sha(raw), "decoded": info})
    assert totals["sapling_outputs"] and totals["sapling_spends"] and totals["orchard_actions"]
    fixture = {"schema_version": 1, "source_kind": "frozen-genuine-mainnet-fixture-replay",
               "captured_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
               "zebra_tag": ZEBRA_TAG, "zebra_commit": commit, "sources": sources,
               "totals": totals, "blocks": blocks, "observations": observations,
               "limitations": ["Synthesized RPC block envelope; not a captured getblock verbosity=2 response.",
                   "Full raw blocks and every transaction byte matched official Zebra mainnet fixtures.",
                   "Decoded transactions captured from CipherScan node-backed getrawtransaction verbose endpoint.",
                   "No independent consensus/proof validation or v5 transaction-id computation.",
                   "Historical NU5 sample; not modern-tip sustained follow or production-scale evidence."]}
    (directory / "fixture.json").write_text(exact_json(fixture) + "\n", encoding="utf-8")
    print(json.dumps({"status": "PASS", "directory": str(directory), "zebra_commit": commit, **totals}))


def fixture_block_hash(by_height, height):
    first_height = min(by_height)
    if height == first_height - 1:
        # The first complete raw header commits to this predecessor. Its full
        # block is deliberately outside this bounded capture.
        return by_height[first_height]["decoded"]["previousblockhash"]
    return by_height[height]["decoded"]["hash"]


def serve(path, port, bind):
    fixture = parse_json(path.read_text(encoding="utf-8"))
    by_height = {block["decoded"]["height"]: block for block in fixture["blocks"]}
    by_hash = {block["decoded"]["hash"]: block for block in fixture["blocks"]}
    head = by_height[max(by_height)]["decoded"]

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 65536:
                self.send_error(413)
                return
            req = json.loads(self.rfile.read(length))
            method, params = req.get("method"), req.get("params", [])
            try:
                if method == "getblockchaininfo" and not params:
                    result = {"chain": "main", "blocks": head["height"], "bestblockhash": head["hash"]}
                elif method == "getblockhash" and len(params) == 1:
                    result = fixture_block_hash(by_height, params[0])
                elif method == "getblock" and len(params) == 2 and params[1] in (0, 1, 2):
                    block = by_hash[params[0]]
                    result = block["raw"] if params[1] == 0 else block["decoded"]
                    if params[1] == 1:
                        result = {**result, "tx": [tx["txid"] for tx in result["tx"]]}
                else:
                    raise ValueError("read-only fixture method not supported")
                response = {"jsonrpc": "2.0", "id": req.get("id"), "result": result}
            except (KeyError, ValueError, TypeError):
                response = {"jsonrpc": "2.0", "id": req.get("id"), "error": {"code": -32602, "message": "not in bounded fixture"}}
            body = exact_json(response).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    print(f"Frozen fixture RPC http://{bind}:{port}; NOT a live node", flush=True)
    ThreadingHTTPServer((bind, port), Handler).serve_forever()


def lossless(value):
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return str(value) if isinstance(value, NumberToken) else value
    if isinstance(value, int):
        return str(value)
    if isinstance(value, list):
        return [lossless(item) for item in value]
    if isinstance(value, dict):
        return {key: lossless(item) for key, item in value.items()}
    raise ValueError("unexpected numeric type")


def verify(path, prep, output):
    if output.exists():
        raise FileExistsError("proof output already exists")
    fixture_bytes = path.read_bytes()
    fixture = parse_json(fixture_bytes)
    heights = [block['decoded']['height'] for block in fixture['blocks']]
    if (not heights or len(heights) > 1024
            or any(type(height) is not int or not 0 <= height <= 0xffffffff for height in heights)
            or any(height != heights[0] + index for index, height in enumerate(heights))):
        raise ValueError('verification requires 1..1024 contiguous captured blocks')
    expected_blocks, expected_txs = [], []
    for block in fixture["blocks"]:
        decoded = block["decoded"]
        expected_blocks.append({"height": decoded["height"], "hash": decoded["hash"],
                                "previous_hash": decoded["previousblockhash"], "time": decoded["time"],
                                "raw": block["raw"], "decoded": lossless(decoded)})
        for index, tx in enumerate(decoded["tx"]):
            expected_txs.append({"txid": tx["txid"], "block_height": decoded["height"],
                                 "index": index, "version": tx["version"], "locktime": tx["locktime"],
                                 "raw": tx["hex"], "vin": lossless(tx["vin"]), "vout": lossless(tx["vout"]),
                                 "decoded": lossless(tx)})
    query = {"from_block": heights[0], "to_block": heights[-1] + 1, "limit": 1,
             "field_selection": {"block": list(expected_blocks[0]), "transaction": list(expected_txs[0])}}

    def pages(request):
        blocks, txs, cursor, count = [], [], None, 0
        while True:
            body = dict(request)
            if cursor:
                body["cursor"] = cursor
            headers = {"Content-Type": "application/json"}
            token = os.environ.get("PREP_API_TOKEN")
            if token:
                headers["Authorization"] = "Bearer " + token
            req = urllib.request.Request(prep.rstrip("/") + "/query", json.dumps(body).encode(), headers)
            with urllib.request.urlopen(req, timeout=30) as response:
                data = response.read(32 * 1024 * 1024 + 1)
            assert len(data) <= 32 * 1024 * 1024
            result = json.loads(data)
            blocks.extend(result["data"]["blocks"])
            txs.extend(result["data"]["transactions"])
            count += 1
            assert count <= len(heights)
            cursor = result["cursor"]
            if cursor is None:
                assert result["next_block"] == heights[-1] + 1
                return blocks, txs, count

    blocks, txs, page_count = pages(query)
    assert blocks == expected_blocks, "whole raw/decoded block projection mismatch"
    assert txs == expected_txs, "whole raw/decoded transaction projection mismatch"
    filters = {}
    for name, predicate in [
        ("has_sapling", lambda tx: bool(tx.get("vShieldedSpend") or tx.get("vShieldedOutput"))),
        ("has_orchard", lambda tx: bool(tx.get("orchard", {}).get("actions"))),
    ]:
        for enabled in (True, False):
            filtered_query = {**query, "transaction_filter": {name: enabled},
                              "field_selection": {"block": [], "transaction": ["txid", "raw", "decoded"]}}
            _, matched, _ = pages(filtered_query)
            expected = [{key: tx[key] for key in ["txid", "raw", "decoded"]}
                        for tx in expected_txs if predicate(tx["decoded"]) == enabled]
            assert matched == expected, name + " pool filter mismatch"
            filters[f"{name}={enabled}"] = {"status": "PASS", "matches": len(matched)}
    report = {"status": "PASS", "source_kind": fixture["source_kind"],
              "verified_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "fixture_sha256": sha(fixture_bytes), "blocks": len(blocks), "transactions": len(txs),
              "pages": page_count, "totals": fixture["totals"], "pool_filters": filters,
              "full_projection_sha256": sha(json.dumps({"blocks": blocks, "transactions": txs},
                                                       sort_keys=True, separators=(",", ":")).encode()),
              "limitations": fixture["limitations"], "observations": fixture["observations"]}
    with output.open("x", encoding="utf-8") as report_file:
        report_file.write(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    capture_parser = sub.add_parser("capture")
    capture_parser.add_argument("--out", type=pathlib.Path, required=True)
    serve_parser = sub.add_parser("serve")
    serve_parser.add_argument("--fixture", type=pathlib.Path, required=True)
    serve_parser.add_argument("--port", type=int, default=18232)
    serve_parser.add_argument("--bind", choices=["127.0.0.1", "0.0.0.0"], default="127.0.0.1",
                              help="0.0.0.0 only inside isolated benchmark container; never publish its port")
    verify_parser = sub.add_parser("verify")
    verify_parser.add_argument("--fixture", type=pathlib.Path, required=True)
    verify_parser.add_argument("--prep", required=True)
    verify_parser.add_argument("--out", type=pathlib.Path, required=True)
    args = parser.parse_args()
    if args.command == "capture":
        capture(args.out)
    elif args.command == "serve":
        serve(args.fixture, args.port, args.bind)
    else:
        verify(args.fixture, args.prep, args.out)
