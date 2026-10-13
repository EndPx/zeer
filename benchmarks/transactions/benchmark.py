"""Frozen pre-Overwinter v1 transaction lookup comparison.

Expected fields come from an independent node RPC/archive, never this decoder.
Times include per-ID lookup and client normalization, exclude output verification.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import queue
import re
import statistics
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

FIELDS = ("txid", "mined_height", "version", "locktime", "size_bytes", "transparent_input_count", "transparent_output_count")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
SCENARIO = "transaction-lookup-preoverwinter-v1"
MAX_RAW_BYTES = 2_000_000


class DataError(ValueError):
    pass


class DeadlineError(TimeoutError):
    pass


def canonical_sha256(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode()).hexdigest()


def hash256(raw: bytes) -> str:
    return hashlib.sha256(hashlib.sha256(raw).digest()).digest()[::-1].hex()


def hexhash(value):
    if not isinstance(value, str) or not HEX64.fullmatch(value):
        raise DataError("invalid_hash")
    return value


def remaining(deadline):
    delta = deadline - time.monotonic()
    if delta <= 0:
        raise DeadlineError("deadline_exceeded")
    return delta


class _Reader:
    def __init__(self, raw):
        if not isinstance(raw, bytes) or not 10 <= len(raw) <= MAX_RAW_BYTES:
            raise DataError("invalid_raw_size")
        self.raw, self.position = raw, 0

    def take(self, count):
        if count < 0 or self.position + count > len(self.raw):
            raise DataError("truncated_transaction")
        out = self.raw[self.position:self.position + count]
        self.position += count
        return out

    def integer(self, size):
        return int.from_bytes(self.take(size), "little")

    def compact_size(self):
        tag = self.integer(1)
        if tag < 253:
            return tag
        size, minimum = {253: (2, 253), 254: (4, 65536), 255: (8, 4294967296)}[tag]
        count = self.integer(size)
        if count < minimum:
            raise DataError("noncanonical_compact_size")
        return count


def decode_v1(raw: bytes, mined_height: int) -> dict:
    """Parse the full v1 envelope; no script execution or consensus certification.

    Versions 2+ and Overwinter flags are explicitly rejected. V2 JoinSplit
    encoding is intentionally outside this experiment.
    """
    reader = _Reader(raw)
    header = reader.integer(4)
    if header & 0x80000000:
        raise DataError("overwinter_not_supported")
    if header != 1:
        raise DataError("only_preoverwinter_version1_supported")
    input_count = reader.compact_size()
    if input_count == 0:
        raise DataError("empty_inputs_or_witness_marker_unsupported")
    if input_count > len(raw) // 41:
        raise DataError("impossible_input_count")
    for _ in range(input_count):
        reader.take(32 + 4)
        reader.take(reader.compact_size())
        reader.take(4)
    output_count = reader.compact_size()
    if output_count == 0 or output_count > len(raw) // 9:
        raise DataError("impossible_output_count")
    for _ in range(output_count):
        reader.take(8)
        reader.take(reader.compact_size())
    locktime = reader.integer(4)
    if reader.position != len(raw):
        raise DataError("trailing_transaction_data")
    return normalize_record({
        "txid": hash256(raw), "mined_height": mined_height, "version": header,
        "locktime": locktime, "size_bytes": len(raw),
        "transparent_input_count": input_count,
        "transparent_output_count": output_count,
    })


def normalize_record(record):
    if not isinstance(record, dict) or any(key not in record for key in FIELDS):
        raise DataError("missing_fields")
    result = {key: record[key] for key in FIELDS}
    hexhash(result["txid"])
    for field in FIELDS[1:]:
        if type(result[field]) is not int:
            raise DataError("noninteger_field")
    if result["version"] != 1:
        raise DataError("unsupported_record_version")
    if not 1 <= result["mined_height"] <= 2048:
        raise DataError("height_outside_selected_prefix")
    if not 0 <= result["locktime"] <= 0xFFFFFFFF:
        raise DataError("invalid_locktime")
    if not 10 <= result["size_bytes"] <= MAX_RAW_BYTES:
        raise DataError("invalid_record_size")
    if not 1 <= result["transparent_input_count"] <= result["size_bytes"] // 41:
        raise DataError("invalid_input_count")
    if not 1 <= result["transparent_output_count"] <= result["size_bytes"] // 9:
        raise DataError("invalid_output_count")
    return result


def validate_manifest(manifest):
    if manifest.get("schema_version") != 1 or manifest.get("scenario") != SCENARIO:
        raise DataError("invalid_manifest_schema")
    if manifest.get("network") != "mainnet":
        raise DataError("mainnet_manifest_required")
    hexhash(manifest.get("genesis_hash"))
    hexhash(manifest.get("end_hash"))
    end = manifest.get("end_height")
    selection_end = manifest.get("selection_end_height")
    if type(end) is not int or not 1 <= end <= 100000:
        raise DataError("invalid_frozen_head")
    if type(selection_end) is not int or not 1 <= selection_end <= min(end, 2048):
        raise DataError("invalid_selection_end")
    source = manifest.get("reference_source", {})
    if not isinstance(source, dict) or any(not isinstance(source.get(key), str) or not source[key].strip() for key in ("name", "version", "provenance")):
        raise DataError("missing_reference_provenance")
    records = manifest.get("records")
    if not isinstance(records, list) or not 1 <= len(records) <= 128:
        raise DataError("invalid_reference_count")
    if canonical_sha256(records) != manifest.get("records_sha256"):
        raise DataError("reference_checksum_mismatch")
    blocks = manifest.get("blocks")
    if not isinstance(blocks, list):
        raise DataError("missing_block_membership")
    block_map = {}
    for block in blocks:
        height = block.get("height")
        if type(height) is not int or not 1 <= height <= end or height in block_map:
            raise DataError("invalid_or_duplicate_block_height")
        block_map[height] = hexhash(block.get("hash"))
    if 1 not in block_map or block_map.get(end) != manifest["end_hash"]:
        raise DataError("missing_frozen_boundary_blocks")
    expected = []
    for record in records:
        projection = normalize_record(record)
        if projection["mined_height"] > selection_end or projection["mined_height"] not in block_map:
            raise DataError("missing_transaction_block_membership")
        raw_hex = record.get("raw_hex")
        if not isinstance(raw_hex, str) or len(raw_hex) != 2 * projection["size_bytes"]:
            raise DataError("reference_raw_size_mismatch")
        try:
            raw = bytes.fromhex(raw_hex)
        except ValueError:
            raise DataError("invalid_raw_hex") from None
        if len(raw) != projection["size_bytes"] or hash256(raw) != projection["txid"]:
            raise DataError("reference_raw_identity_mismatch")
        # This is envelope admission only; expected counts/locktime are not
        # generated or checked by the timed decoder during manifest loading.
        if raw[:4] != b"\x01\x00\x00\x00":
            raise DataError("reference_not_version1")
        expected.append(projection)
    if len({row["txid"] for row in expected}) != len(expected):
        raise DataError("duplicate_reference_txid")
    return expected


def verify_records(actual, expected):
    mismatch = []
    for index, (got, want) in enumerate(zip(actual, expected)):
        fields = [key for key in FIELDS if got.get(key) != want[key]]
        if fields:
            mismatch.append({"index": index, "fields": fields})
    return {
        "passed": actual == expected,
        "expected_count": len(expected), "actual_count": len(actual),
        "duplicate_txids": len(actual) - len({row.get("txid") for row in actual}),
        "mismatches": mismatch,
        "actual_records_sha256": canonical_sha256(actual),
        "actual_field_sha256": {key: canonical_sha256([row.get(key) for row in actual]) for key in FIELDS},
    }


def redact_endpoint(endpoint):
    try:
        parts = urlsplit(endpoint)
        if not parts.hostname or parts.scheme not in {"postgres", "postgresql", "grpc", "grpcs", "http", "https"}:
            return "[redacted]"
        host = f"[{parts.hostname}]" if ":" in parts.hostname else parts.hostname
        return f"{parts.scheme}://{host}" + (f":{parts.port}" if parts.port else "")
    except (ValueError, TypeError):
        return "[redacted]"


def _bounded(action, seconds):
    channel = queue.Queue(maxsize=1)
    def work():
        try:
            channel.put((True, action()))
        except Exception as error:
            channel.put((False, error))
    threading.Thread(target=work, daemon=True).start()
    try:
        success, value = channel.get(timeout=seconds)
    except queue.Empty:
        raise DeadlineError("stage_timeout") from None
    if not success:
        raise value
    return value


def code_identity():
    files = sorted(Path(__file__).parent.glob("*.py"))
    hashes = {file.name: hashlib.sha256(file.read_bytes()).hexdigest() for file in files}
    return {"files": hashes, "sha256": canonical_sha256(hashes)}


def failure_fields(error):
    result = {"status": "TIMEOUT" if isinstance(error, TimeoutError) else "FAIL", "error_type": type(error).__name__}
    # Only our symbolic codes are emitted; third-party messages can contain DSNs.
    if type(error) in (DataError, DeadlineError) and re.fullmatch(r"[a-z][a-z0-9_]{0,79}", str(error)):
        result["error_code"] = str(error)
    return result


def run_benchmark(adapter, manifest, *, candidate, profile, repetitions=5,
                  stage_timeout_s=120, clock_ns=time.perf_counter_ns,
                  verifier=verify_records, identity_callback=None):
    expected = validate_manifest(manifest)
    if type(repetitions) is not int or repetitions < 1 or repetitions > 20:
        raise DataError("invalid_repetitions")
    if not math.isfinite(stage_timeout_s) or stage_timeout_s <= 0:
        raise DataError("invalid_timeout")
    if not isinstance(profile, str) or not profile:
        raise DataError("missing_profile")
    metadata = {}
    for key in ("name", "version", "source_version"):
        if not isinstance(candidate.get(key), str) or not candidate[key].strip():
            raise DataError("invalid_candidate_metadata")
        metadata[key] = candidate[key]
    metadata["endpoint"] = redact_endpoint(candidate.get("endpoint", ""))
    report = {
        "schema_version": 1, "scenario": SCENARIO, "profile": profile,
        "candidate": metadata, "code_identity": code_identity(),
        "manifest_sha256": canonical_sha256(manifest),
        "dataset": {key: manifest[key] for key in ("network", "genesis_hash", "end_height", "end_hash", "selection_end_height", "records_sha256")},
        "projection": list(FIELDS), "record_count": len(expected),
        "repetitions": repetitions, "stage_timeout_s": stage_timeout_s,
        "timing_boundary": "sequential per-transaction lookup + client normalization into memory on one reused connection; verification and source-anchor checks excluded",
        "preflight": {}, "warmup": {}, "postflight": {}, "runs": [],
        "limitations": [
            "Serving/read benchmark, not fresh indexing or database-ingestion speed.",
            "gRPC returns raw bytes then client decodes; PostgreSQL returns indexed fields. Equivalent final fields do not make transport/backend work identical.",
            "Genesis is indirectly anchored by the independently validated frozen canonical head; pre-Sapling gRPC block reads are not assumed available.",
            "All selected transactions are pre-Overwinter v1 within heights 1..2048; no later protocol or shielded workload coverage.",
            "One verified warmup precedes five default sequential runs; server cache and shared-VPS noise require separate environment evidence.",
        ],
    }

    def anchor():
        deadline = time.monotonic() + stage_timeout_s
        adapter.preflight(manifest, deadline)
        if identity_callback is not None:
            identity_callback(manifest, deadline)

    def read_all():
        deadline = time.monotonic() + stage_timeout_s
        out = []
        for wanted in expected:
            remaining(deadline)
            got = normalize_record(adapter.lookup(wanted["txid"], deadline))
            out.append(got)
        remaining(deadline)
        return out

    def read_stage(number):
        row = {"run": number, "eligible": False}
        begin = clock_ns()
        try:
            actual = _bounded(read_all, stage_timeout_s)
            row["lookup_normalize_ns"] = clock_ns() - begin
            verify_begin = clock_ns()
            row["verification"] = verifier(actual, expected)
            row["verification_ns"] = clock_ns() - verify_begin
            row["status"] = "PASS" if row["verification"]["passed"] else "FAIL"
            row["eligible"] = row["status"] == "PASS"
            if row["eligible"] and row["lookup_normalize_ns"]:
                row["lookups_per_second"] = len(expected) * 1e9 / row["lookup_normalize_ns"]
        except Exception as error:
            row.update(**failure_fields(error), elapsed_until_error_ns=clock_ns() - begin)
        return row

    def anchor_stage():
        begin = clock_ns()
        try:
            _bounded(anchor, stage_timeout_s)
            return {"status": "PASS", "elapsed_ns": clock_ns() - begin}
        except Exception as error:
            return {**failure_fields(error), "elapsed_ns": clock_ns() - begin}

    report["preflight"] = anchor_stage()
    stop = report["preflight"]["status"] != "PASS"
    report["warmup"] = {"status": "NOT_RUN"} if stop else read_stage("warmup")
    stop = stop or report["warmup"]["status"] != "PASS"
    for index in range(repetitions):
        if stop:
            report["runs"].append({"run": index + 1, "status": "NOT_RUN", "eligible": False})
            continue
        row = read_stage(index + 1)
        report["runs"].append(row)
        if row["status"] == "TIMEOUT":
            stop = True
    # Never launch overlapping work after a timed-out adapter thread.
    timed_out = any(row.get("status") == "TIMEOUT" for row in [report["preflight"], report["warmup"], *report["runs"]])
    report["postflight"] = {"status": "NOT_RUN"} if timed_out or report["preflight"]["status"] != "PASS" else anchor_stage()
    passed = (all(row["status"] == "PASS" for row in report["runs"])
              and all(report[phase]["status"] == "PASS" for phase in ("preflight", "warmup", "postflight")))
    durations = [row["lookup_normalize_ns"] for row in report["runs"] if row["status"] == "PASS"]
    report["summary"] = {
        "status": "PASS" if passed else "FAIL",
        "eligible_for_comparison": passed and repetitions >= 5 and len(expected) == 128,
        "successful_runs": len(durations),
        "median_lookup_normalize_ns": statistics.median(durations) if passed else None,
        "min_lookup_normalize_ns": min(durations) if passed else None,
        "max_lookup_normalize_ns": max(durations) if passed else None,
    }
    return report


class GrpcTransactionAdapter:
    def __init__(self, endpoint):
        import grpc
        import service_pb2
        import service_pb2_grpc
        parts = urlsplit(endpoint)
        if parts.scheme not in {"grpc", "grpcs"} or not parts.hostname or not parts.port or parts.username or parts.password or parts.path or parts.query or parts.fragment:
            raise DataError("invalid_grpc_endpoint")
        options = [("grpc.max_receive_message_length", MAX_RAW_BYTES + 65536)]
        self.channel = grpc.secure_channel(parts.netloc, grpc.ssl_channel_credentials(), options=options) if parts.scheme == "grpcs" else grpc.insecure_channel(parts.netloc, options=options)
        self.pb, self.stub = service_pb2, service_pb2_grpc.CompactTxStreamerStub(self.channel)
        self.grpc = grpc

    def _call(self, method, request, deadline):
        try:
            return method(request, timeout=remaining(deadline))
        except self.grpc.RpcError as error:
            if error.code() == self.grpc.StatusCode.DEADLINE_EXCEEDED:
                raise DeadlineError("grpc_deadline_exceeded") from None
            raise DataError("grpc_request_failed") from None

    def preflight(self, manifest, deadline):
        info = self._call(self.stub.GetLightdInfo, self.pb.Empty(), deadline)
        if info.chainName.lower() not in {"main", "mainnet"}:
            raise DataError("source_network_mismatch")
        head = self._call(self.stub.GetLatestBlock, self.pb.ChainSpec(), deadline)
        if head.height != manifest["end_height"] or bytes(head.hash)[::-1].hex() != manifest["end_hash"]:
            raise DataError("source_frozen_head_mismatch")

    def lookup(self, txid, deadline):
        response = self._call(self.stub.GetTransaction, self.pb.TxFilter(hash=bytes.fromhex(txid)[::-1]), deadline)
        result = decode_v1(bytes(response.data), int(response.height))
        if result["txid"] != txid:
            raise DataError("server_returned_wrong_transaction")
        return result

    def close(self):
        self.channel.close()


class PostgresTransactionAdapter:
    def __init__(self, dsn, *, txid_storage="hex", block_hash_column="hash",
                 request_timeout_s=20):
        import psycopg
        from psycopg import sql
        if txid_storage not in {"hex", "bytea"} or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", block_hash_column):
            raise DataError("invalid_postgres_mapping")
        if not math.isfinite(request_timeout_s) or request_timeout_s <= 0:
            raise DataError("invalid_postgres_timeout")
        self.connection = psycopg.connect(dsn, autocommit=True, connect_timeout=max(1, math.ceil(request_timeout_s)), options=f"-c default_transaction_read_only=on -c statement_timeout={math.ceil(request_timeout_s * 1000)}")
        self.txid_storage = txid_storage
        self.sql = sql
        self.block_hash_column = block_hash_column

    @staticmethod
    def _stored_hash(value):
        # bytea is assumed RPC display-byte order, not reversed internal bytes.
        if isinstance(value, (bytes, memoryview)):
            return hexhash(bytes(value).hex())
        return hexhash(value)

    def preflight(self, manifest, deadline):
        remaining(deadline)
        with self.connection.cursor() as cursor:
            cursor.execute("SHOW default_transaction_read_only")
            if cursor.fetchone()[0] != "on":
                raise DataError("postgres_session_not_readonly")
            query = self.sql.SQL("SELECT height, {} FROM blocks WHERE height = %s").format(self.sql.Identifier(self.block_hash_column))
            for block in manifest["blocks"]:
                remaining(deadline)
                cursor.execute(query, (block["height"],))
                rows = cursor.fetchall()
                if len(rows) != 1 or rows[0][0] != block["height"] or self._stored_hash(rows[0][1]) != block["hash"]:
                    raise DataError("postgres_canonical_block_mismatch")
            cursor.execute("SELECT MAX(height) FROM blocks")
            if cursor.fetchone()[0] != manifest["end_height"]:
                raise DataError("postgres_frozen_head_mismatch")

    def lookup(self, txid, deadline):
        remaining(deadline)
        parameter = bytes.fromhex(txid) if self.txid_storage == "bytea" else txid
        with self.connection.cursor() as cursor:
            cursor.execute("SELECT txid, block_height, version, locktime, size, vin_count, vout_count FROM transactions WHERE txid = %s", (parameter,))
            rows = cursor.fetchall()
        remaining(deadline)
        if len(rows) != 1:
            raise DataError("postgres_missing_or_duplicate_transaction")
        row = rows[0]
        result = dict(zip(FIELDS, (self._stored_hash(row[0]), *row[1:])))
        if result["txid"] != txid:
            raise DataError("postgres_wrong_transaction")
        return normalize_record(result)

    def close(self):
        self.connection.close()


def render_markdown(report):
    clean = lambda value: str(value).replace("|", "\\|").replace("\n", " ").replace("\r", " ")
    lines = ["# Frozen transaction lookup benchmark", "", f"Candidate: {clean(report['candidate']['name'])}; profile: {clean(report['profile'])}.", f"Endpoint: {clean(report['candidate']['endpoint'])}.", f"Code SHA-256: `{report['code_identity']['sha256']}`.", f"Manifest SHA-256: `{report['manifest_sha256']}`.", "", report["timing_boundary"], "", f"Status: **{report['summary']['status']}**; comparison eligible: **{report['summary']['eligible_for_comparison']}**.", f"Verified warmup: **{report['warmup']['status']}**.", "", "| Run | Status | Lookup + normalize ms | Verify ms | Lookups/s |", "| --- | --- | ---: | ---: | ---: |"]
    for row in report["runs"]:
        duration = f"{row['lookup_normalize_ns'] / 1e6:.3f}" if "lookup_normalize_ns" in row else "N/A"
        verify = f"{row['verification_ns'] / 1e6:.3f}" if "verification_ns" in row else "N/A"
        throughput = f"{row['lookups_per_second']:.3f}" if row.get("eligible") and "lookups_per_second" in row else "N/A"
        lines.append(f"| {row['run']} | {row['status']} | {duration} | {verify} | {throughput} |")
    lines.extend(["", "Limitations:", "", *(f"- {item}" for item in report["limitations"])])
    return "\n".join(lines) + "\n"


def write_report(report, prefix):
    path = Path(prefix)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.with_suffix(".json").write_text(json.dumps(report, indent=2, sort_keys=True, allow_nan=False) + "\n", encoding="utf-8")
    path.with_suffix(".md").write_text(render_markdown(report), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--adapter", choices=("grpc", "postgres"), required=True)
    parser.add_argument("--endpoint-env", default="ZEER_TX_ENDPOINT")
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--source-version", required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--repetitions", type=int, default=5)
    parser.add_argument("--timeout", type=float, default=120)
    parser.add_argument("--pg-txid-storage", choices=("hex", "bytea"), default="hex")
    parser.add_argument("--pg-block-hash-column", default="hash")
    args = parser.parse_args()
    adapter = None
    try:
        manifest = json.loads(args.manifest.read_text(encoding="utf-8-sig"))
        validate_manifest(manifest)
        endpoint = os.environ[args.endpoint_env]
        adapter = GrpcTransactionAdapter(endpoint) if args.adapter == "grpc" else PostgresTransactionAdapter(endpoint, txid_storage=args.pg_txid_storage, block_hash_column=args.pg_block_hash_column)
        report = run_benchmark(adapter, manifest, candidate={"name": args.candidate, "version": args.version, "source_version": args.source_version, "endpoint": endpoint}, profile=args.profile, repetitions=args.repetitions, stage_timeout_s=args.timeout)
        write_report(report, args.output)
        return 0 if report["summary"]["status"] == "PASS" else 1
    except Exception as error:
        print(json.dumps({**failure_fields(error), "status": "ERROR"}))
        return 2
    finally:
        if adapter is not None:
            adapter.close()


if __name__ == "__main__":
    raise SystemExit(main())
