"""Fixed-range chain-data reads, normalization and independent verification.

No database ingestion, persistence, shielded decryption, or indexer engine is
implemented or measured here. All input hashes use conventional RPC hex order.
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
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable, Iterable, Protocol

FIELDS = ("height", "hash", "prev_hash", "txids")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
BOUNDARY = "chain-data read + normalization to memory; excludes reference verification and all durable DB ingestion"


class BenchmarkError(ValueError):
    """A classified input, source, or correctness error safe to report."""


class DeadlineExceeded(TimeoutError):
    """The adapter or benchmark exceeded its declared wall-clock budget."""


class Adapter(Protocol):
    def read_blocks(self, start: int, end: int, deadline: float) -> Iterable[dict]:
        """Yield records in ascending height order; observe monotonic deadline."""


def canonical_sha256(value: Any) -> str:
    data = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def _hash(value: Any) -> str:
    if not isinstance(value, str) or not HEX64.fullmatch(value.lower()):
        raise BenchmarkError("invalid_hash")
    return value.lower()


def normalize_record(value: dict) -> dict:
    if not isinstance(value, dict) or any(field not in value for field in FIELDS):
        raise BenchmarkError("missing_record_fields")
    height = value["height"]
    if type(height) is not int or height < 0:
        raise BenchmarkError("invalid_height")
    txids = value["txids"]
    if not isinstance(txids, list):
        raise BenchmarkError("invalid_txids")
    return {
        "height": height,
        "hash": _hash(value["hash"]),
        "prev_hash": _hash(value["prev_hash"]),
        "txids": [_hash(txid) for txid in txids],
    }


def _field_hashes(records: list[dict]) -> dict:
    return {field: canonical_sha256([record[field] for record in records]) for field in FIELDS}


def _nonempty(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise BenchmarkError(f"invalid_{name}")
    return value


def freeze_manifest(
    records: list[dict], *, network: str, genesis_hash: str,
    reference_name: str, reference_version: str, provenance: str,
    projection: str = "full_transactions",
) -> dict:
    """Build a freezeable manifest from independently acquired reference records.

    This helper establishes checksums, not independent ground truth. The caller
    is responsible for provenance, reference validation and preregistration.
    """
    normalized = [normalize_record(record) for record in records]
    if not normalized:
        raise BenchmarkError("empty_reference")
    manifest = {
        "schema_version": 1,
        "scenario": "public-chain-data-read",
        "projection": projection,
        "network": network,
        "genesis_hash": _hash(genesis_hash),
        "start_height": normalized[0]["height"],
        "end_height": normalized[-1]["height"],
        "start_hash": normalized[0]["hash"],
        "end_hash": normalized[-1]["hash"],
        "reference_source": {"name": reference_name, "version": reference_version, "provenance": provenance},
        "records": normalized,
        "records_sha256": canonical_sha256(normalized),
        "field_sha256": _field_hashes(normalized),
    }
    validate_manifest(manifest)
    return manifest


def validate_manifest(manifest: dict) -> list[dict]:
    if not isinstance(manifest, dict) or manifest.get("schema_version") != 1:
        raise BenchmarkError("unsupported_manifest_version")
    if manifest.get("scenario") != "public-chain-data-read":
        raise BenchmarkError("unsupported_scenario")
    if manifest.get("projection") not in ("full_transactions", "shielded_compact"):
        raise BenchmarkError("unsupported_projection")
    if manifest.get("network") not in ("mainnet", "testnet", "regtest"):
        raise BenchmarkError("invalid_network")
    genesis = _hash(manifest.get("genesis_hash"))
    source = manifest.get("reference_source", {})
    if not isinstance(source, dict):
        raise BenchmarkError("invalid_reference_source")
    for field in ("name", "version", "provenance"):
        _nonempty(source.get(field), f"reference_{field}")
    start, end = manifest.get("start_height"), manifest.get("end_height")
    if type(start) is not int or type(end) is not int or start < 0 or end < start:
        raise BenchmarkError("invalid_range")
    raw_records = manifest.get("records")
    if not isinstance(raw_records, list):
        raise BenchmarkError("invalid_reference_records")
    records = [normalize_record(record) for record in raw_records]
    if len(records) != end - start + 1 or any(record["height"] != start + index for index, record in enumerate(records)):
        raise BenchmarkError("reference_incomplete_or_unordered_range")
    if len({record["hash"] for record in records}) != len(records):
        raise BenchmarkError("reference_duplicate_block_hash")
    for index, record in enumerate(records):
        if len(set(record["txids"])) != len(record["txids"]):
            raise BenchmarkError("reference_duplicate_txid")
        if index and record["prev_hash"] != records[index - 1]["hash"]:
            raise BenchmarkError("reference_parent_mismatch")
    if start == 0 and (records[0]["hash"] != genesis or records[0]["prev_hash"] != "0" * 64):
        raise BenchmarkError("reference_genesis_mismatch")
    if records[0]["hash"] != _hash(manifest.get("start_hash")) or records[-1]["hash"] != _hash(manifest.get("end_hash")):
        raise BenchmarkError("reference_boundary_mismatch")
    if canonical_sha256(records) != manifest.get("records_sha256"):
        raise BenchmarkError("reference_checksum_mismatch")
    if _field_hashes(records) != manifest.get("field_sha256"):
        raise BenchmarkError("reference_field_checksum_mismatch")
    return records


def verify_records(actual: list[dict], expected: list[dict]) -> dict:
    """Exact ordered identity equality; count alone is never sufficient."""
    fields = _field_hashes(actual)
    expected_fields = _field_hashes(expected)
    expected_heights = {record["height"] for record in expected}
    actual_heights = [record["height"] for record in actual]
    mismatched = [field for field in FIELDS if fields[field] != expected_fields[field]]
    return {
        "passed": actual == expected,
        "expected_blocks": len(expected),
        "actual_blocks": len(actual),
        "expected_transactions": sum(len(record["txids"]) for record in expected),
        "actual_transactions": sum(len(record["txids"]) for record in actual),
        "missing_heights": sorted(expected_heights - set(actual_heights)),
        "unexpected_heights": sorted(set(actual_heights) - expected_heights),
        "duplicate_height_count": len(actual_heights) - len(set(actual_heights)),
        "mismatched_fields": mismatched,
        "actual_records_sha256": canonical_sha256(actual),
        "actual_field_sha256": fields,
    }


def redact_endpoint(endpoint: str) -> str:
    """Never return userinfo, path, query or fragment; RPC paths can contain keys."""
    try:
        parsed = urllib.parse.urlsplit(endpoint)
        if parsed.scheme not in ("http", "https", "grpc", "grpcs") or not parsed.hostname:
            return "[redacted-endpoint]"
        host = parsed.hostname
        if ":" in host:
            host = f"[{host}]"
        return f"{parsed.scheme}://{host}" + (f":{parsed.port}" if parsed.port else "")
    except (ValueError, TypeError):
        return "[redacted-endpoint]"


def _remaining(deadline: float) -> float:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise DeadlineExceeded("deadline_exceeded")
    return remaining


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise BenchmarkError("rpc_redirect_rejected")


class JsonRpcAdapter:
    """Sequential getblockhash + getblock verbose=1, no retries or cache."""

    def __init__(self, endpoint: str, *, headers: dict[str, str] | None = None,
                 request_timeout_s: float = 20, max_response_bytes: int = 32 * 1024 * 1024):
        parsed = urllib.parse.urlsplit(endpoint)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            raise BenchmarkError("invalid_rpc_endpoint")
        if parsed.username is not None or parsed.password is not None:
            raise BenchmarkError("use_headers_for_rpc_auth")
        if not math.isfinite(request_timeout_s) or request_timeout_s <= 0:
            raise BenchmarkError("invalid_request_timeout")
        self.endpoint = endpoint
        self.headers = headers or {}
        self.request_timeout_s = request_timeout_s
        self.max_response_bytes = max_response_bytes
        self.request_count = 0
        self._opener = urllib.request.build_opener(_NoRedirect())

    def _call(self, method: str, params: list, deadline: float) -> Any:
        self.request_count += 1
        request_id = self.request_count
        body = json.dumps({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}).encode()
        req = urllib.request.Request(self.endpoint, data=body, headers={"Content-Type": "application/json", **self.headers})
        try:
            timeout = min(self.request_timeout_s, _remaining(deadline))
            with self._opener.open(req, timeout=timeout) as response:
                data = response.read(self.max_response_bytes + 1)
            _remaining(deadline)
            if len(data) > self.max_response_bytes:
                raise BenchmarkError("rpc_response_too_large")
            reply = json.loads(data)
        except (TimeoutError, urllib.error.URLError) as exc:
            if isinstance(exc, TimeoutError) or isinstance(getattr(exc, "reason", None), TimeoutError):
                raise DeadlineExceeded("rpc_timeout") from None
            raise BenchmarkError("rpc_transport_error") from None
        except (json.JSONDecodeError, UnicodeError):
            raise BenchmarkError("rpc_invalid_json") from None
        if not isinstance(reply, dict) or reply.get("id") != request_id:
            raise BenchmarkError("rpc_invalid_response_id")
        if reply.get("error") is not None:
            raise BenchmarkError("rpc_method_error")
        if "result" not in reply:
            raise BenchmarkError("rpc_missing_result")
        return reply["result"]

    def check_source(self, manifest: dict, deadline: float) -> None:
        if manifest["projection"] != "full_transactions":
            raise BenchmarkError("rpc_adapter_requires_full_transactions_projection")
        info = self._call("getblockchaininfo", [], deadline)
        if not isinstance(info, dict):
            raise BenchmarkError("rpc_invalid_chain_info")
        # Zebra calls its peerless regtest chain 'test'; genesis validation below
        # distinguishes it from public testnet. Both checks are required.
        networks = {"main": {"mainnet"}, "test": {"testnet", "regtest"}, "regtest": {"regtest"}}
        if manifest["network"] not in networks.get(info.get("chain"), set()):
            raise BenchmarkError("source_network_mismatch")
        if _hash(self._call("getblockhash", [0], deadline)) != manifest["genesis_hash"]:
            raise BenchmarkError("source_genesis_mismatch")

    def read_blocks(self, start: int, end: int, deadline: float) -> Iterable[dict]:
        for height in range(start, end + 1):
            block_hash = _hash(self._call("getblockhash", [height], deadline))
            block = self._call("getblock", [block_hash, 1], deadline)
            if not isinstance(block, dict) or block.get("height") != height or block.get("hash", "").lower() != block_hash:
                raise BenchmarkError("rpc_block_identity_mismatch")
            yield {
                "height": height,
                "hash": block_hash,
                "prev_hash": block.get("previousblockhash", "0" * 64 if height == 0 else None),
                "txids": block.get("tx"),
            }


def _bounded_call(action: Callable[[], Any], timeout: float) -> Any:
    """Bound caller wait. Stop repetitions after timeout: threads cannot be killed.

    Adapters must honor their deadline. A stalled third-party callable may remain
    active until process exit; never schedule another benchmark in this process
    after TIMEOUT. Built-in RPC also uses per-request transport timeouts.
    """
    channel: queue.Queue = queue.Queue(maxsize=1)

    def target():
        try:
            channel.put((True, action()))
        except Exception as exc:
            channel.put((False, exc))

    thread = threading.Thread(target=target, daemon=True, name="benchmark-adapter")
    thread.start()
    try:
        success, result = channel.get(timeout=timeout)
    except queue.Empty:
        raise DeadlineExceeded("run_timeout") from None
    if not success:
        raise result
    return result


def run_benchmark(
    adapter: Adapter, manifest: dict, *, candidate: dict,
    repetitions: int = 5, run_timeout_s: float = 120,
    verifier: Callable[[list[dict], list[dict]], dict] = verify_records,
    clock_ns: Callable[[], int] = time.perf_counter_ns,
) -> dict:
    expected = validate_manifest(manifest)
    if type(repetitions) is not int or repetitions < 1:
        raise BenchmarkError("invalid_repetitions")
    if not math.isfinite(run_timeout_s) or run_timeout_s <= 0:
        raise BenchmarkError("invalid_run_timeout")
    # Allowlist metadata: never persist arbitrary adapter configuration or errors.
    safe_candidate = {key: _nonempty(candidate.get(key), f"candidate_{key}") for key in ("name", "version", "source_version")}
    safe_candidate["endpoint"] = redact_endpoint(candidate.get("endpoint", ""))
    report = {
        "schema_version": 1,
        "scenario": "public-chain-data-read",
        "projection": manifest["projection"],
        "timing_boundary": BOUNDARY,
        "candidate": safe_candidate,
        "dataset": {key: manifest[key] for key in ("network", "genesis_hash", "start_height", "end_height", "start_hash", "end_hash", "records_sha256", "field_sha256")},
        "manifest_sha256": canonical_sha256(manifest),
        "repetitions": repetitions,
        "run_timeout_s": run_timeout_s,
        "preflight": {},
        "runs": [],
        "limitations": [
            "Measures already-available chain data read and normalization into memory, not fresh durable indexing.",
            "Source cache is uncontrolled across repetitions; record environment and warm/cold state externally.",
            "Version strings are declared provenance; this runner does not independently attest binaries.",
            "Reference correctness depends on independently validated provenance; checksums only detect changed input.",
        ],
    }
    preflight_start = clock_ns()
    if manifest["projection"] == "shielded_compact":
        report["limitations"].append("Shielded compact projection only: txids exclude transactions absent from the declared compact projection; this does not prove full transaction completeness.")
    try:
        check = getattr(adapter, "check_source", None)
        if check is None:
            raise BenchmarkError("adapter_missing_source_identity_check")
        deadline = time.monotonic() + run_timeout_s
        _bounded_call(lambda: check(manifest, deadline), run_timeout_s)
        report["preflight"] = {"status": "PASS", "elapsed_ns": clock_ns() - preflight_start}
    except Exception as exc:
        report["preflight"] = {"status": "TIMEOUT" if isinstance(exc, TimeoutError) else "FAIL", "error_type": type(exc).__name__, "elapsed_ns": clock_ns() - preflight_start}
    stop = report["preflight"]["status"] != "PASS"
    for index in range(repetitions):
        if stop:
            report["runs"].append({"run": index + 1, "status": "NOT_RUN", "eligible": False})
            continue
        row: dict = {"run": index + 1, "eligible": False}
        start_ns = clock_ns()
        deadline = time.monotonic() + run_timeout_s
        count_before = getattr(adapter, "request_count", None)

        def collect():
            records = []
            for value in adapter.read_blocks(manifest["start_height"], manifest["end_height"], deadline):
                _remaining(deadline)
                records.append(normalize_record(value))
                if len(records) > len(expected):
                    break  # Retain one excess record to fail verification, bound memory.
            _remaining(deadline)
            return records

        try:
            actual = _bounded_call(collect, run_timeout_s)
            finish_ns = clock_ns()
            row["read_normalize_ns"] = finish_ns - start_ns
            verify_start = clock_ns()
            row["verification"] = verifier(actual, expected)
            row["verification_ns"] = clock_ns() - verify_start
            row["status"] = "PASS" if row["verification"]["passed"] else "FAIL"
            row["eligible"] = row["status"] == "PASS"
            if row["eligible"] and row["read_normalize_ns"] > 0:
                seconds = row["read_normalize_ns"] / 1e9
                row["blocks_per_second"] = len(actual) / seconds
                row["transactions_per_second"] = sum(len(record["txids"]) for record in actual) / seconds
        except Exception as exc:
            row["status"] = "TIMEOUT" if isinstance(exc, TimeoutError) else "FAIL"
            row["error_type"] = type(exc).__name__
            row["elapsed_until_error_ns"] = clock_ns() - start_ns
            # Exception messages may contain endpoint credentials; deliberately omit.
            if row["status"] == "TIMEOUT":
                stop = True
        count_after = getattr(adapter, "request_count", None)
        if type(count_before) is int and type(count_after) is int:
            row["source_requests"] = count_after - count_before
        report["runs"].append(row)
    valid = [row for row in report["runs"] if row["eligible"]]
    all_valid = len(valid) == repetitions and report["preflight"]["status"] == "PASS"
    durations = [row["read_normalize_ns"] for row in valid]
    report["summary"] = {
        "status": "PASS" if all_valid else "FAIL",
        "eligible_for_comparison": all_valid and repetitions >= 5,
        "successful_runs": len(valid),
        "requested_runs": repetitions,
        # Do not hide failed runs behind a successful-runs-only headline median.
        "median_read_normalize_ns": statistics.median(durations) if all_valid else None,
        "min_read_normalize_ns": min(durations) if all_valid else None,
        "max_read_normalize_ns": max(durations) if all_valid else None,
    }
    return report


def render_markdown(report: dict) -> str:
    def cell(value):
        return str(value).replace("|", "\\|").replace("\n", " ").replace("\r", " ")

    lines = [
        "# Public chain-data read benchmark", "",
        f"Candidate: {cell(report['candidate']['name'])} ({cell(report['candidate']['version'])}).",
        f"Source version: {cell(report['candidate']['source_version'])}.",
        f"Endpoint: {cell(report['candidate']['endpoint'])}.", "",
        f"Boundary: {report['timing_boundary']}.", "",
        f"Projection: **{report['projection']}**.", "",
        f"Dataset: {report['dataset']['network']} heights {report['dataset']['start_height']}–{report['dataset']['end_height']}.",
        f"Manifest SHA-256: `{report['manifest_sha256']}`.",
        f"Preflight: **{report['preflight']['status']}**.",
        f"Result: **{report['summary']['status']}**. Eligible for comparison: **{report['summary']['eligible_for_comparison']}**.", "",
        "| Run | Status | Read + normalize (ms) | Verification (ms) | Blocks/s |",
        "| --- | --- | ---: | ---: | ---: |",
    ]
    for row in report["runs"]:
        read = f"{row['read_normalize_ns'] / 1e6:.3f}" if "read_normalize_ns" in row else "N/A"
        verify = f"{row['verification_ns'] / 1e6:.3f}" if "verification_ns" in row else "N/A"
        speed = f"{row['blocks_per_second']:.3f}" if row["eligible"] and "blocks_per_second" in row else "N/A"
        lines.append(f"| {row['run']} | {row['status']} | {read} | {verify} | {speed} |")
    median = report["summary"]["median_read_normalize_ns"]
    lines.extend(["", f"Median read + normalize: {f'{median / 1e6:.3f} ms' if median is not None else 'N/A; incomplete or failed experiment'}.", "", "Limitations:", ""])
    lines.extend(f"- {item}" for item in report["limitations"])
    lines.append("- This report declares no overall winner; compare only candidates with equivalent work and controlled environments.")
    return "\n".join(lines) + "\n"


def write_report(report: dict, output_prefix: str | Path) -> None:
    prefix = Path(output_prefix)
    prefix.parent.mkdir(parents=True, exist_ok=True)
    prefix.with_suffix(".json").write_text(json.dumps(report, indent=2, sort_keys=True, allow_nan=False) + "\n", encoding="utf-8")
    prefix.with_suffix(".md").write_text(render_markdown(report), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--endpoint-env", default="ZEER_BENCH_RPC_URL", help="Read endpoint from this environment variable; never store credentials in command flags")
    parser.add_argument("--auth-header-env", help="Optional environment variable containing Authorization header value")
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--source-version", required=True)
    parser.add_argument("--repetitions", type=int, default=5)
    parser.add_argument("--timeout", type=float, default=120)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        endpoint = os.environ[args.endpoint_env]
        headers = {"Authorization": os.environ[args.auth_header_env]} if args.auth_header_env else None
        manifest = json.loads(args.manifest.read_text(encoding="utf-8-sig"))
        adapter = JsonRpcAdapter(endpoint, headers=headers)
        report = run_benchmark(adapter, manifest, candidate={"name": args.candidate, "version": args.version, "source_version": args.source_version, "endpoint": endpoint}, repetitions=args.repetitions, run_timeout_s=args.timeout)
        write_report(report, args.output)
        return 0 if report["summary"]["status"] == "PASS" else 1
    except Exception as exc:
        print(json.dumps({"status": "ERROR", "error_type": type(exc).__name__}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
