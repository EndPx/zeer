"""Same 128 independent public records: Prep pages, one bound batch, native SQL.

One verified warmup and one measured pass per visit; root alternates visits.
No source preparation/indexing is timed. Endpoints are supplied via env names.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import re
import sys
import os
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from benchmarks.prep.full.retrieval import FROM, TO, Prep, CipherScan, load_dataset, transaction, ordered, measure, integer, require

BATCH_FIELDS = ["txid", "block_height", "index", "version", "locktime", "size_bytes", "transparent_input_count", "transparent_output_count"]


def oracle_locations(dataset):
    """Retained oracle insertion order is node block.tx order, not txid sort order."""
    counts = {int(block["id"]): block["transactionCount"] for block in dataset["oracle"]["blocks"]}
    positions, observed_counts, previous = {}, {}, FROM
    for row in dataset["oracle"]["transactions"]:
        height = integer(row["minedHeight"])
        require(height >= previous and height in counts and row["id"] not in positions, "ORACLE_LOCATION_ORDER_INVALID")
        index = observed_counts.get(height, 0)
        positions[row["id"]] = (height, index)
        observed_counts[height], previous = index + 1, height
    require(counts == observed_counts, "ORACLE_LOCATION_COUNT_MISMATCH")
    return positions


class BatchPrep(Prep):
    strategy = "One POST /transactions for all128 fixed IDs; eight public metadata fields; verified warmup snapshot bound with at on measured request."

    def __init__(self, endpoint, dataset, deadline=None):
        super().__init__(endpoint, dataset, deadline, projection="metadata")
        self.strategy = type(self).strategy
        self.at, self.last_locations = None, {}

    def preflight(self):
        identity = super().preflight()
        caps = self.http.request("/capabilities")
        require(caps.get("api_version") == 1 and "/transactions" in caps.get("routes", []), "BATCH_ROUTE_UNSUPPORTED")
        limits = caps.get("transactions", {})
        require(integer(limits.get("max_ids")) >= 128 and integer(limits.get("max_range_blocks")) >= TO - FROM + 1
                and integer(limits.get("max_records")) >= 128 and integer(limits.get("max_response_bytes")) >= 1
                and all(field in caps.get("query", {}).get("transaction_fields", []) for field in BATCH_FIELDS), "BATCH_CAPABILITY_LIMIT_OR_FIELDS")
        return identity

    def retrieve(self, workload):
        require(workload == "sparse", "BATCH_WORKLOAD_REQUIRES_SPARSE")
        ids = [row["txid"] for row in self.dataset["sparse"]]
        request = {"from_block": FROM, "to_block": TO + 1, "txids": ids, "fields": BATCH_FIELDS}
        if self.at is not None:
            request["at"] = copy.deepcopy(self.at)
        before_bytes = self.http.response_bytes
        response = self.http.request("/transactions", request)
        require(self.http.response_bytes - before_bytes <= 4194304, "BATCH_RESPONSE_TOO_LARGE")
        require(response.get("complete") is True and response.get("network") == self.identity["network"]
                and response.get("epoch") == self.identity["epoch"] and response.get("revision") == self.identity["revision"]
                and response.get("archive_height") == self.identity["archive_height"]
                and response.get("from_block") == FROM and response.get("to_block") == TO + 1
                and response.get("missing_txids") == [], "BATCH_PARTIAL_OR_IDENTITY_CHANGED")
        expected_snapshot = {"network": self.identity["network"], "archive_start": self.identity["start_block"],
                             "to_block": TO + 1, "epoch": self.identity["epoch"], "boundary_hash": self.dataset["headers"][-1]["hash"]}
        snapshot = response.get("snapshot")
        require(snapshot == expected_snapshot and (self.at is None or snapshot == self.at), "BATCH_SNAPSHOT_CHANGED")
        rows = response.get("transactions")
        require(isinstance(rows, list) and len(rows) <= 4096, "BATCH_RECORD_LIMIT")
        normalized, found, locations, previous = [], set(), {}, (FROM - 1, -1)
        for row in rows:
            require(isinstance(row, dict) and set(row) == set(BATCH_FIELDS) and row["txid"] in ids, "BATCH_UNREQUESTED_OR_MISSING_FIELDS")
            require(all(type(row[field]) is int for field in BATCH_FIELDS if field != "txid"), "BATCH_METADATA_NOT_INTEGER")
            location = (integer(row["block_height"]), integer(row["index"]))
            require(FROM <= location[0] <= TO and location > previous and row["txid"] not in locations, "BATCH_DUPLICATE_OR_UNSORTED_LOCATION")
            previous = location
            locations[row["txid"]] = location
            found.add(row["txid"])
            normalized.append(transaction((row["txid"], row["block_height"], row["version"], row["locktime"], row["size_bytes"], row["transparent_input_count"], row["transparent_output_count"])))
        require(found == set(ids) and len(rows) == len(set(ids)), "BATCH_ID_COMPLETENESS_MISMATCH")
        self.at, self.last_locations = copy.deepcopy(snapshot), locations
        return ordered(normalized, "sparse")


def verified_measure(adapter, expected, positions):
    run = measure(adapter, "sparse", expected)
    if isinstance(adapter, BatchPrep):
        begin = time.perf_counter_ns()
        require(adapter.last_locations == {row["txid"]: positions[row["txid"]] for row in expected}, "BATCH_ORACLE_LOCATION_MISMATCH")
        run["verification_ns"] += time.perf_counter_ns() - begin
    return run


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", choices=("query", "batch", "sql"), required=True)
    parser.add_argument("--endpoint-env", required=True)
    parser.add_argument("--oracle", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--round", type=int, required=True)
    parser.add_argument("--timeout-seconds", type=int, default=180)
    args = parser.parse_args()
    require(re.fullmatch(r"[A-Z][A-Z0-9_]{0,63}", args.endpoint_env) and 1 <= args.round <= 5 and 1 <= args.timeout_seconds <= 900, "INVALID_ARGUMENT")
    endpoint = os.environ.get(args.endpoint_env)
    require(endpoint, "ENDPOINT_ENV_REQUIRED")
    dataset = load_dataset(args.oracle, args.manifest)
    positions = oracle_locations(dataset)
    report = {"format": "prep-common-batch-retrieval-v1", "status": "RUNNING", "candidate": args.case, "workload": "sparse", "round": args.round,
              "range": {"from": FROM, "to_inclusive": TO}, "oracle_sha256": dataset["oracle_sha256"], "manifest_sha256": dataset["manifest_sha256"],
              "runner_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "timeout_seconds": args.timeout_seconds,
              "timing_boundary": "First request through decode, protocol validation, normalization and ordering; independent row digest/equality and oracle location verification excluded. SQL read-only transaction/timeout commands included.",
              "limitations": ["Prepared warm sources; no ingestion, source synchronization or archive preparation included.",
                              "Same128 frozen early-mainnet v1 public records. Query pages use128 scanned blocks; batch usesone complete HTTP request; SQL usesnative ANY filter.",
                              "Batch timed request binds the verified warmup snapshot. Canonical index positions independently reconstructed from retained node block.tx insertion order and block transaction counts.",
                              "HTTP byte totals exclude headers. SQL byte totals unavailable; its requests include transaction/timeout commands. Native paths differ, not an isolated engine ranking."]}
    adapter = None
    with args.out.open("x", encoding="utf-8") as output:
        try:
            deadline = time.monotonic() + args.timeout_seconds
            adapter = Prep(endpoint, dataset, deadline, projection="metadata") if args.case == "query" else BatchPrep(endpoint, dataset, deadline) if args.case == "batch" else CipherScan(endpoint, dataset, deadline)
            report["strategy"] = adapter.strategy
            report["initial_source"] = adapter.preflight()
            report["warmup"] = verified_measure(adapter, dataset["sparse"], positions)
            if isinstance(adapter, BatchPrep):
                report["bound_snapshot"] = copy.deepcopy(adapter.at)
            report["run"] = verified_measure(adapter, dataset["sparse"], positions)
            if args.case == "batch":
                require(report["run"]["requests"] == 1, "BATCH_NOT_SINGLE_REQUEST")
            report["final_source"] = adapter.preflight()
            require(report["initial_source"] == report["final_source"], "SOURCE_CHANGED")
            report["status"] = "PASS"
        except Exception as error:
            report["status"] = "FAIL"
            report["failure_code"] = str(error) if isinstance(error, ValueError) and re.fullmatch(r"[A-Z_]+", str(error)) else "BATCH_RETRIEVAL_FAILED"
        finally:
            if adapter:
                try:
                    adapter.close()
                except Exception:
                    report["status"], report["failure_code"] = "FAIL", "ADAPTER_CLOSE_FAILED"
            json.dump(report, output, indent=2)
            output.write("\n")
    print(json.dumps({"status": report["status"], "candidate": args.case, "round": args.round, "run": report.get("run"), "failure_code": report.get("failure_code")}))
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
