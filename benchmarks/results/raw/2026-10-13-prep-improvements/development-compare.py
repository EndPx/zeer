"""Compare two Prep binaries serving the same frozen archive, without modifying it.

Uses only Python's standard library. Preparation and output equality checks are
outside timing. Results describe warm HTTP reads, not ingestion or consensus.
"""

import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import statistics
import time
from urllib.parse import urlsplit


class Client:
    def __init__(self, url):
        parsed = urlsplit(url)
        if (parsed.scheme != "http" or not parsed.hostname or parsed.username
                or parsed.password or parsed.query or parsed.fragment
                or parsed.path not in ("", "/")):
            raise ValueError("Use a credential-free private HTTP benchmark endpoint")
        self.connection = http.client.HTTPConnection(
            parsed.hostname, parsed.port or 80, timeout=60
        )
        self.token = os.environ.get("PREP_API_TOKEN")

    def request(self, path, body=None):
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        self.connection.request(
            "GET" if body is None else "POST", path,
            None if body is None else json.dumps(body), headers,
        )
        response = self.connection.getresponse()
        raw = response.read(32 * 1024 * 1024 + 1)
        if response.status != 200 or len(raw) > 32 * 1024 * 1024:
            raise ValueError(f"HTTP status/size failure: {response.status}")
        return json.loads(raw), len(raw)

    def scan(self, request):
        pages, size, elapsed = 0, 0, 0
        counts = {name: 0 for name in ("blocks", "transactions")}
        hashes = {name: hashlib.sha256() for name in counts}
        cursor, previous = None, request["from_block"]
        epoch = None
        while True:
            body = dict(request)
            if cursor:
                body["cursor"] = cursor
            begin = time.perf_counter_ns()
            page, count = self.request("/query", body)
            elapsed += time.perf_counter_ns() - begin
            if epoch is None:
                epoch = page["epoch"]
            if (page["epoch"] != epoch
                    or not previous < page["next_block"] <= request["to_block"]
                    or page["to_block"] != request["to_block"]):
                raise ValueError("Unstable epoch or nonadvancing range")
            previous = page["next_block"]
            # Hash one page at a time outside the timed request. The digest is
            # independent of pagination, and memory does not grow with the range.
            for name in counts:
                for item in page["data"][name]:
                    hashes[name].update(json.dumps(
                        item, sort_keys=True, separators=(",", ":"), ensure_ascii=True
                    ).encode())
                    hashes[name].update(b"\n")
                    counts[name] += 1
            pages += 1
            size += count
            cursor = page["cursor"]
            if cursor is None:
                if previous != request["to_block"]:
                    raise ValueError("Truncated scan")
                return {**counts, "sha256": {name: value.hexdigest() for name, value in hashes.items()}}, pages, size, elapsed

    def close(self):
        self.connection.close()


def workloads(start, end, txid):
    common = {"from_block": start, "to_block": end, "limit": 128}
    definitions = [
        ("headers", ["height", "hash", "time"], [], {}),
        ("raw_blocks", ["height", "hash", "raw"], [], {}),
        ("transaction_metadata", [], ["txid", "block_height", "index", "version", "locktime"], {}),
        ("full_projection", ["height", "hash", "previous_hash", "time", "raw", "decoded"],
         ["txid", "block_height", "index", "version", "locktime", "raw", "vin", "vout", "decoded"], {}),
        ("txid_filter", [], ["txid", "block_height", "raw"], {"txids": [txid]}),
        ("no_match_scan", [], ["txid", "block_height"], {"versions": [4294967295]}),
    ]
    return [(name, {**common, "field_selection": {"block": block, "transaction": tx},
                    "transaction_filter": filters}) for name, block, tx, filters in definitions]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--before", required=True)
    parser.add_argument("--after", required=True)
    parser.add_argument("--from-block", type=int, default=1000)
    parser.add_argument("--to-block", type=int, default=2024)
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if not (1 <= args.from_block < args.to_block <= args.from_block + 10000
            and 3 <= args.runs <= 10):
        parser.error("Range must contain 1..10000 blocks; runs must be 3..10")
    # Never overwrite an earlier measurement, including a failed partial run.
    with args.out.open("x", encoding="utf-8") as output:
        report = {"schema_version": 1, "status": "RUNNING", "started_at_unix": int(time.time()),
                  "range": {"from": args.from_block, "to_exclusive": args.to_block},
                  "workloads": [], "limitations": [
                      "Prepared immutable archive; warm caches; no ingestion included.",
                      "Shared VPS, one CPU per server and one CPU for the client; not dedicated hardware.",
                      "Sequential requests, persistent connections, alternating binary order.",
                      "Timing sums each HTTP request through JSON decoding; per-page hashing/equality is excluded and pauses between requests are not timed.",
                      "One decoded page retained at a time; dataset size does not accumulate in client memory.",
                      "Before/after equivalence is a regression oracle, not independent consensus validation.",
                      "Early mainnet range; no modern shielded or million-block performance claim.",
                  ]}
        clients = {"before": Client(args.before), "after": Client(args.after)}
        try:
            initial = {name: client.request("/height")[0] for name, client in clients.items()}
            identity = ("network", "start_block", "archive_height", "epoch", "revision", "payload_kind")
            if any(not meta["ready"] for meta in initial.values()) or any(
                    initial["before"][key] != initial["after"][key] for key in identity):
                raise ValueError("Endpoints must serve the same ready archive identity")
            report["archive"] = {key: initial["before"][key] for key in identity}
            sample, _ = clients["before"].request("/query", {
                "from_block": args.from_block, "to_block": args.from_block + 1,
                "limit": 1, "field_selection": {"block": [], "transaction": ["txid"]},
            })
            txid = sample["data"]["transactions"][0]["txid"]
            for name, request in workloads(args.from_block, args.to_block, txid):
                expected = clients["before"].scan(request)[0]
                if clients["after"].scan(request)[0] != expected:
                    raise ValueError(f"Warmup output mismatch: {name}")
                if name == "no_match_scan" and expected["transactions"]:
                    raise ValueError("Unexpected transaction version in no-match fixture")
                result = {"name": name, "request": request, "expected_sha256": expected["sha256"],
                          "blocks": expected["blocks"], "transactions": expected["transactions"],
                          "runs": {"before": [], "after": []}}
                report["workloads"].append(result)
                for index in range(args.runs):
                    for version in (["before", "after"] if index % 2 == 0 else ["after", "before"]):
                        observed, pages, size, elapsed = clients[version].scan(request)
                        equal = observed == expected
                        result["runs"][version].append({"run": index + 1, "elapsed_ns": elapsed,
                                                        "pages": pages, "response_bytes": size,
                                                        "status": "PASS" if equal else "FAIL"})
                        if not equal:
                            raise ValueError(f"Output mismatch: {name}/{version}/{index + 1}")
                result["median_ms"] = {
                    version: statistics.median(run["elapsed_ns"] for run in runs) / 1e6
                    for version, runs in result["runs"].items()
                }
                print(json.dumps({"name": name, "median_ms": result["median_ms"]}), flush=True)
            for name, client in clients.items():
                final, _ = client.request("/height")
                if not final["ready"] or any(final[key] != initial[name][key] for key in identity):
                    raise ValueError("Archive changed during comparison")
            report["status"] = "PASS"
        except Exception as error:
            report["status"] = "FAIL"
            report["failure_type"] = type(error).__name__
            raise
        finally:
            for client in clients.values():
                client.close()
            report["finished_at_unix"] = int(time.time())
            json.dump(report, output, indent=2)
            output.write("\n")


if __name__ == "__main__":
    main()
