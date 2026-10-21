"""Bounded, warm prepared-archive retrieval versus native Zebra RPC.

Public testnet data only. No server mutation, transparent balance inference,
decryption, source retries during measurement, or cache clearing.
"""
import argparse
import base64
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import statistics
import sys
import threading
import time
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from benchmarks.prep.full.retrieval import Http, digest, integer, hexhash, require

GENESIS = "05a60a92d99d85997cce3b87616c089f6124d7342af37106edc76126334a2c38"
TX_FIELDS = ["txid", "block_height", "version", "locktime", "is_coinbase",
             "transparent_input_count", "transparent_output_count", "sapling_spend_count",
             "sapling_output_count", "orchard_action_count", "ironwood_action_count"]
HEADER_FIELDS = ["height", "hash", "previous_hash", "time"]


def array(value):
    require(isinstance(value, list), "INVALID_ARRAY")
    return value


def actions(tx, pool):
    bundle = tx.get(pool)
    require(bundle is None or isinstance(bundle, dict), "INVALID_POOL_BUNDLE")
    return len(array(bundle.get("actions", []))) if bundle else 0


def transaction(tx, height):
    vin, vout = array(tx["vin"]), array(tx["vout"])
    require(all(isinstance(v, dict) for v in vin + vout), "INVALID_TRANSPARENT_COMPONENT")
    return dict(zip(TX_FIELDS, [hexhash(tx["txid"]), integer(height), integer(tx["version"]),
        integer(tx["locktime"]), any("coinbase" in item for item in vin), len(vin), len(vout),
        len(array(tx.get("vShieldedSpend", []))), len(array(tx.get("vShieldedOutput", []))),
        actions(tx, "orchard"), actions(tx, "ironwood")]))


def header(block):
    return {"height": integer(block["height"]), "hash": hexhash(block["hash"]),
            "previous_hash": hexhash(block.get("previousblockhash", "0" * 64)), "time": integer(block["time"])}


def output_addresses(tx):
    result = []
    for item in array(tx["vout"]):
        script = item.get("scriptPubKey", {})
        require(isinstance(script, dict), "INVALID_OUTPUT_SCRIPT")
        values = array(script.get("addresses", []))
        result.extend(value for value in values if isinstance(value, str))
        if isinstance(script.get("address"), str):
            result.append(script["address"])
    return set(result)


def normalize(rows, workload):
    return sorted(rows, key=(lambda row: row["height"]) if workload == "headers"
                  else (lambda row: (row["block_height"], row["txid"])))


def matches(row, workload):
    if workload == "sapling":
        return row["sapling_spend_count"] > 0 or row["sapling_output_count"] > 0
    if workload in ("orchard", "ironwood"):
        return row[workload + "_action_count"] > 0
    return True


class RpcError(ValueError):
    def __init__(self, code):
        self.rpc_code = code
        super().__init__("RPC_ERROR")


class Rpc:
    def __init__(self, endpoint, authorization=None, workers=4, timeout=90):
        self.endpoint, self.authorization = endpoint, authorization
        self.workers, self.timeout = workers, timeout
        self.local, self.connections, self.lock = threading.local(), [], threading.Lock()
        self.executor = ThreadPoolExecutor(max_workers=workers)
        self.methods = Counter()

    def call(self, method, params):
        if not hasattr(self.local, "http"):
            connection = Http(self.endpoint, authorization=self.authorization)
            with self.lock:
                self.connections.append(connection)
            self.local.http = connection
        connection = self.local.http
        connection.deadline = getattr(self, "deadline", time.monotonic() + self.timeout)
        with self.lock:
            self.methods[method] += 1
        body = connection.request("/", {"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
        if body.get("error"):
            raise RpcError(body["error"].get("code"))
        require(body.get("id") == 1 and "result" in body, "INVALID_RPC_ENVELOPE")
        return body["result"]

    def stats(self):
        return {"requests": sum(c.requests for c in self.connections),
                "response_bytes": sum(c.response_bytes for c in self.connections)}

    def retrieve(self, manifest, workload):
        start, end = manifest["from_block"], manifest["to_block"]
        if workload == "headers":
            return normalize(list(self.executor.map(lambda h: header(self.call("getblockheader", [str(h)])), range(start, end))), workload)
        if workload in ("txids", "address"):
            ids = manifest["txids"] if workload == "txids" else self.call("getaddresstxids", [{"addresses": [manifest["address"]], "start": start, "end": end - 1}])
            require(isinstance(ids, list) and all(re.fullmatch(r"[0-9a-f]{64}", value) for value in ids), "INVALID_RPC_IDS")
            def read(txid):
                tx = self.call("getrawtransaction", [txid, 1])
                require(tx.get("txid") == txid and tx.get("in_active_chain") is True, "RPC_TRANSACTION_IDENTITY")
                row = transaction(tx, tx["height"])
                if not start <= row["block_height"] < end:
                    return []
                if workload == "address" and manifest["address"] not in output_addresses(tx):
                    return []
                return [row]
            return normalize([row for group in self.executor.map(read, sorted(set(ids))) for row in group], workload)
        def read(height):
            block = self.call("getblock", [str(height), 2])
            require(integer(block["height"]) == height, "RPC_BLOCK_HEIGHT_MISMATCH")
            return [row for tx in array(block["tx"]) if matches(row := transaction(tx, height), workload)]
        return normalize([row for group in self.executor.map(read, range(start, end)) for row in group], workload)

    def close(self):
        self.executor.shutdown(wait=True, cancel_futures=True)
        for connection in self.connections:
            connection.close()


class Prep:
    def __init__(self, endpoint, token=None, timeout=90):
        self.http, self.timeout = Http(endpoint, token=token), timeout

    def stats(self):
        return {"requests": self.http.requests, "response_bytes": self.http.response_bytes}

    def retrieve(self, manifest, workload):
        self.http.deadline = self.deadline
        query = {"from_block": manifest["from_block"], "to_block": manifest["to_block"],
                 "scan_mode": "adaptive", "field_selection": {"block": HEADER_FIELDS if workload == "headers" else [],
                 "transaction": [] if workload == "headers" else TX_FIELDS}}
        if workload == "txids":
            query["transaction_filter"] = {"txids": manifest["txids"]}
        elif workload == "address":
            query["transaction_filter"] = {"transparent_output_addresses": [manifest["address"]]}
        elif workload in ("sapling", "orchard", "ironwood"):
            query["transaction_filter"] = {"shielded_pools": [workload]}
        rows, epoch, previous = [], None, query["from_block"]
        while True:
            page = self.http.request("/query", query)
            require(page.get("network") == "testnet" and page.get("from_block") == query["from_block"]
                    and page.get("to_block") == query["to_block"], "PREP_RANGE_IDENTITY")
            if epoch is None:
                epoch = page["epoch"]
            require(page["epoch"] == epoch and previous < page["next_block"] <= query["to_block"], "PREP_CHANGED_OR_TRUNCATED")
            previous = page["next_block"]
            rows.extend(page["data"]["blocks" if workload == "headers" else "transactions"])
            if page["cursor"] is None:
                require(previous == query["to_block"], "PREP_INCOMPLETE")
                return normalize(rows, workload)
            require(previous < query["to_block"] and isinstance(page["cursor"], str), "INVALID_PREP_CURSOR")
            query["cursor"] = page["cursor"]

    def close(self):
        self.http.close()


def capture(rpc, start, end):
    require(0 < start < end and end - start <= 1024, "BOUNDED_MODERN_RANGE_REQUIRED")
    info = rpc.call("getblockchaininfo", [])
    require(info["chain"] in ("test", "testnet") and rpc.call("getblockhash", [0]) == GENESIS, "TESTNET_REQUIRED")
    blocks = list(rpc.executor.map(lambda h: rpc.call("getblock", [str(h), 2]), range(start, end)))
    headers = [header(block) for block in blocks]
    require([row["height"] for row in headers] == list(range(start, end)), "REFERENCE_HEADERS_INCOMPLETE")
    for a, b in zip(headers, headers[1:]):
        require(b["previous_hash"] == a["hash"], "REFERENCE_HEADERS_DISCONNECTED")
    for row in (headers[0], headers[-1]):
        raw = bytes.fromhex(rpc.call("getblockheader", [row["hash"], False]))
        require(hashlib.sha256(hashlib.sha256(raw).digest()).digest()[::-1].hex() == row["hash"], "HEADER_HASH_MISMATCH")
    records = [(transaction(tx, block["height"]), output_addresses(tx)) for block in blocks for tx in array(block["tx"])]
    txs = normalize([row for row, _ in records], "transactions")
    require(len({row["txid"] for row in txs}) == len(txs), "DUPLICATE_REFERENCE_TXID")
    address_counts = Counter(address for _, addresses in records for address in addresses)
    require(address_counts, "TRANSPARENT_OUTPUT_REQUIRED")
    address = sorted(address_counts, key=lambda value: (-address_counts[value], value))[0]
    coverage = {pool: sum(matches(row, pool) for row in txs) for pool in ("sapling", "orchard", "ironwood")}
    coverage["transparent"] = sum(row["transparent_input_count"] > 0 or row["transparent_output_count"] > 0 for row in txs)
    coverage["non_coinbase_transparent"] = sum(not row["is_coinbase"] and (row["transparent_input_count"] > 0 or row["transparent_output_count"] > 0) for row in txs)
    require(all(value > 0 for value in coverage.values()), "NONEMPTY_POOL_AND_TRANSPARENT_REQUIRED")
    selected = {next(row["txid"] for row in txs if matches(row, pool)) for pool in ("sapling", "orchard", "ironwood")}
    selected.add(next(row["txid"] for row in txs if not row["is_coinbase"] and row["transparent_output_count"] > 0))
    for row in sorted(txs, key=lambda row: row["txid"]):
        if len(selected) >= 16:
            break
        selected.add(row["txid"])
    expected = {"headers": headers, "transactions": txs, "txids": [row for row in txs if row["txid"] in selected],
                "address": normalize([row for row, addresses in records if address in addresses], "address")}
    expected.update({pool: [row for row in txs if matches(row, pool)] for pool in ("sapling", "orchard", "ironwood")})
    return {"format": "zeer-prep-rpc-reference-v1", "network": "testnet", "genesis_hash": GENESIS,
            "from_block": start, "to_block": end, "start_hash": headers[0]["hash"], "end_hash": headers[-1]["hash"],
            "boundary_raw_header_hashes_verified": True, "source_tip_at_capture": info["blocks"],
            "address": address, "address_selection": "Most frequent observed transparent output address; lexical tie-break.",
            "txids": sorted(selected), "coverage_transactions": coverage, "expected": expected,
            "expected_sha256": {name: digest(rows) for name, rows in expected.items()}}


def boundary(rpc, manifest):
    rpc.deadline = time.monotonic() + rpc.timeout
    require(rpc.call("getblockhash", [manifest["from_block"]]) == manifest["start_hash"]
            and rpc.call("getblockhash", [manifest["to_block"] - 1]) == manifest["end_hash"], "SOURCE_BOUNDARY_CHANGED")


def measure(adapter, manifest, workload):
    before = adapter.stats()
    adapter.deadline = time.monotonic() + adapter.timeout
    started = time.perf_counter_ns()
    rows = adapter.retrieve(manifest, workload)
    require(time.monotonic() <= adapter.deadline, "GLOBAL_DEADLINE_EXCEEDED")
    elapsed = (time.perf_counter_ns() - started) / 1e9
    after = adapter.stats()
    verified = time.perf_counter_ns()
    require(rows == manifest["expected"][workload] and digest(rows) == manifest["expected_sha256"][workload], "RESULT_MISMATCH")
    return {"status": "PASS", "elapsed_seconds": elapsed, "verification_seconds": (time.perf_counter_ns() - verified) / 1e9,
            "rows": len(rows), "sha256": digest(rows),
            **{key: after[key] - before[key] for key in before}}


def write_json(path, value):
    require(not path.is_symlink(), "OUTPUT_SYMLINK_REFUSED")
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("x", encoding="utf-8") as output:
        json.dump(value, output, indent=2)
        output.write("\n")
    os.replace(temporary, path)


def summary(runs, rounds):
    result = {}
    for workload in dict.fromkeys(row["workload"] for row in runs):
        candidates = {}
        for candidate in ("prep", "rpc"):
            selected = [row for row in runs if row["workload"] == workload and row["candidate"] == candidate]
            require(len(selected) == rounds and all(row["status"] == "PASS" for row in selected), "INCOMPLETE_MEASUREMENTS")
            require(len({(row["rows"], row["sha256"]) for row in selected}) == 1, "UNSTABLE_RESULTS")
            candidates[candidate] = {"median_seconds": statistics.median(row["elapsed_seconds"] for row in selected),
                "median_requests": statistics.median(row["requests"] for row in selected),
                "median_response_bytes": statistics.median(row["response_bytes"] for row in selected),
                "rows": selected[0]["rows"], "sha256": selected[0]["sha256"]}
        require(candidates["prep"]["sha256"] == candidates["rpc"]["sha256"], "CANDIDATE_RESULTS_DIFFER")
        result[workload] = candidates
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=["capture", "run"])
    parser.add_argument("--rpc-env", default="BENCH_RPC_URL")
    parser.add_argument("--prep-env", default="BENCH_PREP_URL")
    parser.add_argument("--rpc-cookie-file", type=Path)
    parser.add_argument("--from-block", type=int)
    parser.add_argument("--to-block", type=int)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--timeout-seconds", type=int, default=90)
    args = parser.parse_args()
    require(1 <= args.rounds <= 5 and 1 <= args.workers <= 8 and 1 <= args.timeout_seconds <= 180, "INVALID_BOUNDS")
    rpc_url = os.environ[args.rpc_env]
    authorization = None
    if args.rpc_cookie_file:
        require(ipaddress.ip_address(urlsplit(rpc_url).hostname).is_private, "PRIVATE_AUTHENTICATED_RPC_REQUIRED")
        authorization = "Basic " + base64.b64encode(args.rpc_cookie_file.read_bytes().strip()).decode()
    rpc = Rpc(rpc_url, authorization, args.workers, args.timeout_seconds)
    try:
        if args.stage == "capture":
            require(not args.manifest.exists(), "MANIFEST_ALREADY_EXISTS")
            started = time.perf_counter_ns()
            manifest = capture(rpc, args.from_block, args.to_block)
            manifest["reference_capture"] = {**rpc.stats(), "elapsed_seconds": (time.perf_counter_ns() - started) / 1e9}
            write_json(args.manifest, manifest)
            print(json.dumps({key: value for key, value in manifest.items() if key not in ("expected", "txids")}))
            return
        require(args.out and not args.out.exists(), "NEW_OUTPUT_REQUIRED")
        manifest = json.loads(args.manifest.read_text())
        require(manifest["network"] == "testnet" and manifest["genesis_hash"] == GENESIS, "TESTNET_MANIFEST_REQUIRED")
        for name, rows in manifest["expected"].items():
            require(digest(rows) == manifest["expected_sha256"][name], "REFERENCE_DIGEST_MISMATCH")
        prep = Prep(os.environ[args.prep_env], os.environ.get("PREP_API_TOKEN"), args.timeout_seconds)
        result = {"format": "zeer-prep-zebra-rpc-v1", "status": "RUNNING", "started_at_utc": datetime.now(timezone.utc).isoformat(),
                  "manifest_sha256": hashlib.sha256(args.manifest.read_bytes()).hexdigest(),
                  "harness_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  "range": {"from_block": manifest["from_block"], "to_block_exclusive": manifest["to_block"]},
                  "rpc_workers": args.workers, "repetitions_per_candidate": args.rounds,
                  "cache": "Verified warmup per candidate/workload before alternating measurements; no cache clearing or cold-cache claim.",
                  "timing_boundary": "First retrieval request through final decode, normalized projection and ordering. Digest/equality and source-boundary checks excluded and separately recorded.",
                  "response_bytes": "Actual HTTP response body bytes, including JSON-RPC envelopes and overfetch; HTTP/TLS headers excluded; identity encoding.",
                  "rpc_paths": {"headers": "getblockheader(height)", "txids": "getrawtransaction(txid,1), returned height checked",
                     "address": "getaddresstxids(start,end) then getrawtransaction and output-only filtering",
                     "pool_filters": "getblock(height,2) then client-side component filtering", "transactions": "getblock(height,2)"},
                  "prep_path": "Adaptive /query with exact fields and matching public filters; one in-flight cursor page.",
                  "run_order": "Alternating candidate pairs; first candidate switches with workload index and round index.",
                  "runs": [], "warmups": []}
        write_json(args.out, result)
        try:
            rpc.deadline = time.monotonic() + args.timeout_seconds
            require(rpc.call("getblockhash", [0]) == GENESIS, "TESTNET_RPC_REQUIRED")
            prep.http.deadline = time.monotonic() + args.timeout_seconds
            meta, capabilities = prep.http.request("/height"), prep.http.request("/capabilities")
            require(meta.get("ready") is True and meta.get("network") == "testnet" and meta.get("payload_kind") == "full-v1"
                    and meta["start_block"] <= manifest["from_block"] and meta["archive_height"] >= manifest["to_block"] - 1
                    and capabilities["query"].get("max_adaptive_scan_blocks"), "PREP_PREFLIGHT_FAILED")
            result["prep_preflight"] = {key: meta.get(key) for key in ("network", "start_block", "archive_height", "epoch", "revision", "payload_kind")}
            for workload_index, workload in enumerate(manifest["expected"]):
                for candidate, adapter in [("rpc", rpc), ("prep", prep)]:
                    boundary(rpc, manifest)
                    result["warmups"].append({"workload": workload, "candidate": candidate, **measure(adapter, manifest, workload)})
                for round_index in range(args.rounds):
                    order = [("rpc", rpc), ("prep", prep)] if (round_index + workload_index) % 2 == 0 else [("prep", prep), ("rpc", rpc)]
                    for candidate, adapter in order:
                        boundary(rpc, manifest)
                        row = {"workload": workload, "candidate": candidate, "round": round_index, **measure(adapter, manifest, workload)}
                        boundary(rpc, manifest)
                        result["runs"].append(row)
                        write_json(args.out, result)
                        print(json.dumps(row), flush=True)
            result["summary"] = summary(result["runs"], args.rounds)
            result["status"] = "PASS"
        except Exception as error:
            result["status"], result["error_type"] = "FAIL", type(error).__name__
            raise
        finally:
            prep.close()
            result["finished_at_utc"] = datetime.now(timezone.utc).isoformat()
            write_json(args.out, result)
    finally:
        rpc.close()


if __name__ == "__main__":
    main()
