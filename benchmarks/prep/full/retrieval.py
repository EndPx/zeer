"""Common prepared public projections: Prep HTTP, frozen node RPC, CipherScan PG.

Run once per candidate/workload/round; orchestration alternates candidates. A
verified warmup precedes one measured pass. Native access paths intentionally
differ; this compares complete retrieval, not isolated database engine speed.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
import gzip
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import threading
import time
import sys
from urllib.parse import urlsplit

FIELDS = ("txid", "mined_height", "version", "locktime", "size_bytes", "transparent_input_count", "transparent_output_count")
ORACLE_FIELDS = ("id", "minedHeight", "version", "locktime", "sizeBytes", "transparentInputCount", "transparentOutputCount")
FROM, TO = 1, 2048
MAX_RESPONSE = 32 * 1024 * 1024
# Direct script execution and -m invocation use the same repository imports.
if str(Path(__file__).resolve().parents[3]) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parents[3]))


def remaining(deadline):
    value = deadline - time.monotonic()
    require(value > 0, "GLOBAL_DEADLINE_EXCEEDED")
    return value


def require(ok, code):
    if not ok:
        raise ValueError(code)


def integer(value):
    require(type(value) is int or isinstance(value, str) and re.fullmatch(r"0|[1-9][0-9]*", value), "INVALID_INTEGER")
    result = int(value)
    require(0 <= result <= 0xffffffff, "INTEGER_OUT_OF_RANGE")
    return result


def hexhash(value):
    require(isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value), "INVALID_HASH")
    return value


def transaction(values):
    require(len(values) == 7, "INVALID_PROJECTION")
    row = dict(zip(FIELDS, [hexhash(values[0]), *(integer(value) for value in values[1:])]))
    require(FROM <= row["mined_height"] <= TO and row["version"] in (1, 2) and row["size_bytes"] > 0, "TRANSACTION_OUTSIDE_DATASET")
    return row


def decoded_transaction(txid, height, version, locktime, decoded):
    require(isinstance(decoded, dict) and isinstance(decoded.get("vin"), list) and isinstance(decoded.get("vout"), list), "MISSING_PUBLIC_TRANSACTION_FIELDS")
    size = decoded.get("size")
    if "hex" in decoded:
        raw = decoded["hex"]
        require(isinstance(raw, str) and len(raw) % 2 == 0 and re.fullmatch(r"[0-9a-fA-F]+", raw), "INVALID_TRANSACTION_HEX")
        derived = len(raw) // 2
        require(size is None or integer(size) == derived, "TRANSACTION_SIZE_MISMATCH")
        size = derived
    return transaction((txid, height, version, locktime, size, len(decoded["vin"]), len(decoded["vout"])))


def header(height, blockhash, timestamp):
    row = {"height": integer(height), "hash": hexhash(blockhash), "time": integer(timestamp)}
    require(FROM <= row["height"] <= TO, "HEADER_OUTSIDE_DATASET")
    return row


def ordered(rows, workload):
    return sorted(rows, key=(lambda row: row["height"]) if workload == "headers" else (lambda row: (row["mined_height"], row["txid"])))


def digest(rows):
    return hashlib.sha256(json.dumps(rows, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode()).hexdigest()


def load_dataset(oracle_path, manifest_path):
    raw = oracle_path.read_bytes()
    oracle = json.loads(gzip.decompress(raw) if oracle_path.suffix == ".gz" else raw)
    manifest_raw = manifest_path.read_bytes()
    manifest = json.loads(manifest_raw.decode("utf-8-sig"))
    require(oracle.get("range") == {"from": FROM, "to": TO}, "ORACLE_RANGE_MISMATCH")
    blocks = ordered([header(row["id"], row["hash"], row["time"]) for row in oracle["blocks"]], "headers")
    txs = ordered([transaction([row[key] for key in ORACLE_FIELDS]) for row in oracle["transactions"]], "transactions")
    require(len(blocks) == TO and [row["height"] for row in blocks] == list(range(FROM, TO + 1)), "ORACLE_HEADERS_INCOMPLETE")
    require(len(txs) == 16962 and len({row["txid"] for row in txs}) == len(txs), "ORACLE_TRANSACTIONS_INCOMPLETE")
    require(manifest.get("network") == "mainnet" and manifest.get("end_height") == oracle["source"]["height"] and manifest.get("end_hash") == oracle["source"]["hash"], "MANIFEST_SOURCE_MISMATCH")
    require(digest(manifest["records"]) == manifest.get("records_sha256"), "MANIFEST_CHECKSUM_MISMATCH")
    sparse = [transaction([row[key] for key in FIELDS]) for row in manifest["records"]]
    require(len(sparse) == 128 and len({row["txid"] for row in sparse}) == 128, "SPARSE_SELECTION_MISMATCH")
    by_id = {row["txid"]: row for row in txs}
    require(all(by_id.get(row["txid"]) == row for row in sparse), "MANIFEST_ORACLE_MISMATCH")
    return {"oracle": oracle, "manifest": manifest, "headers": blocks, "transactions": txs,
            "sparse": ordered(sparse, "sparse"), "oracle_sha256": hashlib.sha256(raw).hexdigest(),
            "manifest_sha256": hashlib.sha256(manifest_raw).hexdigest()}


class Http:
    def __init__(self, endpoint, token=None, deadline=None):
        p = urlsplit(endpoint)
        require(p.scheme in ("http", "https") and p.hostname and not p.username and not p.password and not p.query and not p.fragment and p.path in ("", "/"), "CREDENTIAL_FREE_ENDPOINT_REQUIRED")
        self.connection = (http.client.HTTPSConnection if p.scheme == "https" else http.client.HTTPConnection)(p.hostname, p.port, timeout=30)
        self.token, self.requests, self.response_bytes = token, 0, 0
        self.deadline = deadline

    def request(self, path, body=None):
        if self.deadline is not None:
            self.connection.timeout = min(30, remaining(self.deadline))
            if self.connection.sock:
                self.connection.sock.settimeout(self.connection.timeout)
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        self.requests += 1
        self.connection.request("GET" if body is None else "POST", path, None if body is None else json.dumps(body, separators=(",", ":")), headers)
        response = self.connection.getresponse()
        raw = response.read(MAX_RESPONSE + 1)
        self.response_bytes += len(raw)
        require(response.status == 200 and len(raw) <= MAX_RESPONSE, "HTTP_STATUS_OR_SIZE_FAILURE")
        return json.loads(raw, parse_float=Decimal)

    def close(self):
        self.connection.close()


class Prep:
    strategy = "Persistent HTTP; limit 128 blocks/page; batched txids filter for sparse; decoded transaction object overfetch."

    def __init__(self, endpoint, dataset, deadline=None, projection="decoded"):
        self.http, self.dataset, self.identity = Http(endpoint, os.environ.get("PREP_API_TOKEN"), deadline), dataset, None
        require(projection in ("decoded", "metadata"), "INVALID_PREP_PROJECTION")
        self.projection = projection
        if projection == "metadata":
            self.strategy = "Persistent HTTP; limit 128 blocks/page; batched txids filter; direct size/input/output count metadata fields."

    def preflight(self):
        meta = self.http.request("/height")
        require(meta.get("ready") is True and meta.get("network") == "mainnet" and meta.get("payload_kind") == "full-v1" and integer(meta["start_block"]) <= FROM and integer(meta["archive_height"]) >= TO, "PREP_NOT_READY_OR_RANGE")
        identity = {key: meta[key] for key in ("network", "start_block", "archive_height", "epoch", "revision", "payload_kind")}
        if self.identity is not None:
            require(identity == self.identity, "PREP_IDENTITY_CHANGED")
        self.identity = identity
        for height in (FROM, TO):
            page = self.http.request("/query", {"from_block": height, "to_block": height + 1, "limit": 1, "field_selection": {"block": ["height", "hash", "time"], "transaction": []}})
            require(page.get("epoch") == meta["epoch"] and page.get("network") == "mainnet" and page.get("next_block") == height + 1 and page.get("data", {}).get("blocks") == [self.dataset["headers"][height - 1]], "PREP_BOUNDARY_MISMATCH")
        return identity

    def retrieve(self, workload):
        compact = getattr(self, "projection", "decoded") == "metadata"
        query = {"from_block": FROM, "to_block": TO + 1, "limit": 128, "field_selection": {
            "block": ["height", "hash", "time"] if workload == "headers" else [],
            "transaction": [] if workload == "headers" else ["txid", "block_height", "version", "locktime", *(["size_bytes", "transparent_input_count", "transparent_output_count"] if compact else ["decoded"])]}}
        if workload == "sparse":
            query["transaction_filter"] = {"txids": [row["txid"] for row in self.dataset["sparse"]]}
        rows, next_block, cursor = [], FROM, None
        while True:
            body = {**query, **({"cursor": cursor} if cursor is not None else {})}
            page = self.http.request("/query", body)
            require(page.get("network") == "mainnet" and page.get("epoch") == self.identity["epoch"] and page.get("revision") == self.identity["revision"] and next_block < integer(page["next_block"]) <= TO + 1 and page.get("to_block") == TO + 1, "PREP_CHANGED_OR_NONADVANCING")
            next_block, cursor = page["next_block"], page["cursor"]
            if workload == "headers":
                rows.extend(header(row["height"], row["hash"], row["time"]) for row in page["data"]["blocks"])
            else:
                if compact:
                    rows.extend(transaction((row["txid"], row["block_height"], row["version"], row["locktime"], row["size_bytes"], row["transparent_input_count"], row["transparent_output_count"])) for row in page["data"]["transactions"])
                else:
                    rows.extend(decoded_transaction(row["txid"], row["block_height"], row["version"], row["locktime"], row["decoded"]) for row in page["data"]["transactions"])
            if cursor is None:
                require(next_block == TO + 1, "PREP_TRUNCATED_RANGE")
                return ordered(rows, workload)

    def stats(self):
        return {"requests": self.http.requests, "response_bytes": self.http.response_bytes}

    def close(self):
        self.http.close()


class Rpc:
    strategy = "8 persistent worker connections; full scans getblockhash + getblock verbosity1/2 per height; sparse getrawtransaction verbosity1 + getblock verbosity1 for mined height."

    def __init__(self, endpoint, dataset, deadline=None):
        self.endpoint, self.dataset, self.local = endpoint, dataset, threading.local()
        self.connections, self.lock = [], threading.Lock()
        self.executor = ThreadPoolExecutor(max_workers=8)
        self.deadline = deadline

    def call(self, method, params):
        if not hasattr(self.local, "http"):
            self.local.http = Http(self.endpoint, deadline=self.deadline)
            with self.lock:
                self.connections.append(self.local.http)
        response = self.local.http.request("/", {"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
        require(response.get("id") == 1 and not response.get("error") and "result" in response, "RPC_FAILURE")
        return response["result"]

    def preflight(self):
        info = self.call("getblockchaininfo", [])
        source = self.dataset["oracle"]["source"]
        require(info.get("chain") in ("main", "mainnet") and integer(info["blocks"]) == source["height"] and info["bestblockhash"] == source["hash"], "RPC_FROZEN_HEAD_MISMATCH")
        for height in (FROM, TO):
            require(self.call("getblockhash", [height]) == self.dataset["headers"][height - 1]["hash"], "RPC_BOUNDARY_MISMATCH")
        require(self.call("getblockhash", [0]) == self.dataset["manifest"]["genesis_hash"], "RPC_GENESIS_MISMATCH")
        return {"height": info["blocks"], "hash": info["bestblockhash"]}

    def retrieve(self, workload):
        def block_rows(height):
            blockhash = hexhash(self.call("getblockhash", [height]))
            block = self.call("getblock", [blockhash, 1 if workload == "headers" else 2])
            require(block.get("hash") == blockhash and integer(block["height"]) == height, "RPC_BLOCK_IDENTITY_MISMATCH")
            if workload == "headers":
                return [header(height, blockhash, block["time"])]
            require(isinstance(block.get("tx"), list) and block["tx"], "RPC_TRANSACTIONS_MISSING")
            return [decoded_transaction(tx["txid"], height, tx["version"], tx["locktime"], tx) for tx in block["tx"]]

        def sparse_row(selected):
            txid = selected["txid"]
            tx = self.call("getrawtransaction", [txid, 1])
            require(tx.get("txid") == txid, "RPC_WRONG_TRANSACTION")
            block = self.call("getblock", [hexhash(tx.get("blockhash")), 1])
            require(block.get("hash") == tx["blockhash"] and txid in block.get("tx", []), "RPC_TRANSACTION_MEMBERSHIP_MISMATCH")
            return [decoded_transaction(txid, block["height"], tx["version"], tx["locktime"], tx)]

        jobs = self.dataset["sparse"] if workload == "sparse" else range(FROM, TO + 1)
        groups = self.executor.map(sparse_row if workload == "sparse" else block_rows, jobs)
        return ordered([row for group in groups for row in group], workload)

    def stats(self):
        return {"requests": sum(c.requests for c in self.connections), "response_bytes": sum(c.response_bytes for c in self.connections)}

    def close(self):
        self.executor.shutdown(wait=True, cancel_futures=True)
        for connection in self.connections:
            connection.close()


class CipherScan:
    strategy = "One native SQL range query or batched txid ANY filter, ordered rows; read-only repeatable-read snapshot; no ingestion included."

    def __init__(self, endpoint, dataset, deadline=None):
        import psycopg
        self.connection = psycopg.connect(endpoint, autocommit=True, connect_timeout=10,
            options="-c default_transaction_read_only=on -c statement_timeout=60000 -c search_path=public")
        self.dataset, self.requests = dataset, 0
        self.deadline = deadline

    def query(self, sql, params=()):
        self.requests += 1
        with self.connection.cursor() as cursor:
            if self.deadline is not None:
                timeout_ms = max(1, int(min(60, remaining(self.deadline)) * 1000))
                self.requests += 1
                cursor.execute(f"SET statement_timeout={timeout_ms}")
            cursor.execute(sql, params)
            return cursor.fetchall() if cursor.description is not None else []

    def preflight(self):
        require(self.query("SHOW default_transaction_read_only")[0][0] == "on", "PG_NOT_READ_ONLY")
        checkpoint = self.query("SELECT value FROM public.indexer_state WHERE key='backfill_height'")
        require(len(checkpoint) == 1 and integer(checkpoint[0][0]) >= TO, "PG_CHECKPOINT_INCOMPLETE")
        bounds = self.query("SELECT min(height),max(height),count(*) FROM public.blocks WHERE height BETWEEN %s AND %s", (FROM, TO))[0]
        require(bounds == (FROM, TO, TO), "PG_RANGE_INCOMPLETE")
        for height in (FROM, TO):
            require(self.query("SELECT hash FROM public.blocks WHERE height=%s", (height,)) == [(self.dataset["headers"][height - 1]["hash"],)], "PG_BOUNDARY_MISMATCH")
        return {"checkpoint": integer(checkpoint[0][0]), "range_rows": bounds[2]}

    def retrieve(self, workload):
        # Explicit read-only stable snapshot; transaction commands are included in timing.
        self.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        try:
            if workload == "headers":
                rows = [header(*row) for row in self.query("SELECT height,hash,timestamp FROM public.blocks WHERE height BETWEEN %s AND %s ORDER BY height", (FROM, TO))]
            else:
                sql = "SELECT txid,block_height,version,locktime,size,vin_count,vout_count FROM public.transactions WHERE block_height BETWEEN %s AND %s"
                params = (FROM, TO)
                if workload == "sparse":
                    sql += " AND txid=ANY(%s)"
                    params += ([row["txid"] for row in self.dataset["sparse"]],)
                rows = [transaction(row) for row in self.query(sql + " ORDER BY block_height,txid", params)]
            self.query("COMMIT")
            return ordered(rows, workload)
        except BaseException:
            self.query("ROLLBACK")
            raise

    def stats(self):
        return {"requests": self.requests, "response_bytes": None}

    def close(self):
        self.connection.close()


class GrpcSparse:
    strategy = "128 sequential native GetTransaction calls; returned raw v1 envelopes decoded locally, mined height from protobuf response; compact blocks cannot enumerate equivalent full public transactions."

    def __init__(self, endpoint, dataset, deadline=None):
        from benchmarks.transactions.benchmark import GrpcTransactionAdapter
        self.adapter, self.dataset = GrpcTransactionAdapter(endpoint), dataset
        self.deadline = deadline if deadline is not None else time.monotonic() + 180
        self.requests, self.response_bytes = 0, 0
        call = self.adapter._call

        def counted(method, request, deadline):
            self.requests += 1
            response = call(method, request, deadline)
            self.response_bytes += response.ByteSize()
            return response

        self.adapter._call = counted

    def preflight(self):
        self.adapter.preflight(self.dataset["manifest"], self.deadline)
        source = self.dataset["oracle"]["source"]
        return {"height": source["height"], "hash": source["hash"]}

    def retrieve(self, workload):
        require(workload == "sparse", "GRPC_WORKLOAD_NOT_APPLICABLE")
        return ordered([
            transaction([observed[key] for key in FIELDS])
            for observed in (self.adapter.lookup(row["txid"], self.deadline) for row in self.dataset["sparse"])
        ], workload)

    def stats(self):
        return {"requests": self.requests, "response_bytes": self.response_bytes}

    def close(self):
        self.adapter.close()


def measure(adapter, workload, expected):
    before = adapter.stats()
    start = time.perf_counter_ns()
    rows = adapter.retrieve(workload)
    elapsed = time.perf_counter_ns() - start
    after = adapter.stats()
    verify_start = time.perf_counter_ns()
    expected_digest, observed_digest = digest(expected), digest(rows)
    require(rows == expected and observed_digest == expected_digest, "PROJECTION_MISMATCH")
    return {"status": "PASS", "rows": len(rows), "sha256": observed_digest, "retrieval_normalize_ns": elapsed,
            "verification_ns": time.perf_counter_ns() - verify_start, "rows_per_second": len(rows) * 1e9 / elapsed,
            "requests": after["requests"] - before["requests"],
            "response_bytes": None if after["response_bytes"] is None else after["response_bytes"] - before["response_bytes"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", choices=("prep", "rpc", "cipherscan", "lwd", "zinder", "zaino"), required=True)
    parser.add_argument("--workload", choices=("headers", "transactions", "sparse"), required=True)
    parser.add_argument("--endpoint-env", required=True)
    parser.add_argument("--oracle", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--round", type=int, required=True)
    parser.add_argument("--timeout-seconds", type=int, default=180)
    parser.add_argument("--prep-projection", choices=("decoded", "metadata"), default="decoded")
    args = parser.parse_args()
    require(args.prep_projection == "decoded" or args.candidate == "prep", "PREP_PROJECTION_REQUIRES_PREP")
    require(re.fullmatch(r"[A-Z][A-Z0-9_]{0,63}", args.endpoint_env) and 1 <= args.round <= 5 and 1 <= args.timeout_seconds <= 900, "INVALID_ARGUMENT")
    endpoint = os.environ.get(args.endpoint_env)
    require(endpoint, "ENDPOINT_ENV_REQUIRED")
    dataset = load_dataset(args.oracle, args.manifest)
    report = {"format": "prep-common-prepared-retrieval-v1", "status": "RUNNING", "candidate": args.candidate,
              "workload": args.workload, "round": args.round, "range": {"from": FROM, "to_inclusive": TO},
              "oracle_sha256": dataset["oracle_sha256"], "manifest_sha256": dataset["manifest_sha256"],
              "runner_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "timing_boundary": "First request through final response decode, projection normalization and ordering; hashing/equality verification and pre/postflight excluded. PG BEGIN/COMMIT and RPC scheduling are included.",
              "limitations": ["Prepared sources, warm caches; no source sync, archive build or entity indexing included.",
                              "Native access paths differ: Prep pagination/filter, RPC bounded concurrency8, PostgreSQL SQL indexes.",
                              "All normalized rows retained in client memory during timing; same canonical order for all candidates.",
                              "Early mainnet public v1/v2 projection only; no current mainnet, private scanning, EVM logs or engine-only ranking.",
                              "PostgreSQL response bytes unavailable; requests counts include BEGIN/COMMIT SQL commands."]}
    report["limitations"].append("gRPC response bytes are serialized protobuf payload ByteSize, excluding transport frames; HTTP bytes exclude headers. PG counts also include bounded timeout settings.")
    report["timeout_seconds"] = args.timeout_seconds
    report["prep_projection"] = args.prep_projection if args.candidate == "prep" else None
    adapter = None
    with args.out.open("x", encoding="utf-8") as output:
        try:
            if args.candidate in ("lwd", "zinder", "zaino") and args.workload != "sparse":
                report["status"] = "NOT_APPLICABLE"
                report["reason"] = "Only the sparse gRPC adapter is validated in this harness. Compact blocks alone cannot enumerate the same full public transaction projection; early-range height/hash/time header compatibility has not been validated, so these workloads are not measured."
            else:
                adapter = {"prep": Prep, "rpc": Rpc, "cipherscan": CipherScan, "lwd": GrpcSparse, "zinder": GrpcSparse, "zaino": GrpcSparse}[args.candidate](
                    endpoint, dataset, time.monotonic() + args.timeout_seconds,
                    **({"projection": args.prep_projection} if args.candidate == "prep" else {}))
            if adapter is None:
                print(json.dumps({"status": report["status"], "reason": report["reason"]}))
                return 0
            report["strategy"] = adapter.strategy
            report["initial_source"] = adapter.preflight()
            report["warmup"] = measure(adapter, args.workload, dataset[args.workload])
            report["run"] = measure(adapter, args.workload, dataset[args.workload])
            report["final_source"] = adapter.preflight()
            require(report["final_source"] == report["initial_source"], "SOURCE_CHANGED")
            report["status"] = "PASS"
        except Exception as error:
            report["status"] = "FAIL"
            report["failure_code"] = str(error) if isinstance(error, ValueError) and re.fullmatch(r"[A-Z_]+", str(error)) else "RETRIEVAL_FAILED"
        finally:
            if adapter:
                try:
                    adapter.close()
                except Exception:
                    report["status"], report["failure_code"] = "FAIL", "ADAPTER_CLOSE_FAILED"
            json.dump(report, output, indent=2)
            output.write("\n")
    print(json.dumps({"status": report["status"], "candidate": args.candidate, "workload": args.workload, "round": args.round, "run": report.get("run"), "failure_code": report.get("failure_code")}))
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
