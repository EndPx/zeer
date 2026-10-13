"""One verified lookup visit in a five-candidate rotated session; never a ranking alone.

Run from repository root: python -m benchmarks.chef.session_lookup ...
Root schedules candidates and resource limits; this driver starts no service.
"""
import argparse
import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import time

from benchmarks.chef.lookup import ChefTransactionAdapter
from benchmarks.transactions.benchmark import (
    DataError, DeadlineError, GrpcTransactionAdapter, PostgresTransactionAdapter,
    _bounded, canonical_sha256, failure_fields, run_benchmark, validate_manifest,
    write_report,
)

NAMES = {"chef": "Zeer Chef", "cipherscan": "CipherScan", "zinder": "Zinder",
         "zaino": "Zaino", "lightwalletd": "lightwalletd"}
TRANSIENT_CODES = {"grpc_request_failed", "http_non_success", "chef_not_ready", "source_rpc_failed"}


class ReadinessFailure(Exception):
    def __init__(self, observations):
        super().__init__("readiness_failed")
        self.observations = observations


def await_readiness(factory, manifest, *, seconds=60, clock=time.monotonic,
                    pause=time.sleep, bounded=_bounded):
    """Retry transient startup failures only; stop after a timed-out worker."""
    deadline = clock() + seconds
    observations = {"status": "FAIL", "budget_seconds": seconds, "attempts": []}
    started = clock()
    while clock() < deadline:
        adapter = None
        attempt = {"attempt": len(observations["attempts"]) + 1}
        attempt_started = clock()
        try:
            # Constructors have their own bounded connect time. Each attempt is
            # bounded again so a faulty readiness method cannot occupy the visit.
            adapter = bounded(factory, max(0.001, deadline - clock()))
            attempt_deadline = min(deadline, clock() + 5)
            bounded(lambda: adapter.preflight(manifest, attempt_deadline),
                    max(0.001, attempt_deadline - clock()))
            attempt.update(status="PASS", elapsed_seconds=clock() - attempt_started)
            observations["attempts"].append(attempt)
            observations.update(status="PASS", elapsed_seconds=clock() - started)
            return adapter, observations
        except Exception as error:
            attempt.update(failure_fields(error), elapsed_seconds=clock() - attempt_started)
            observations["attempts"].append(attempt)
            if adapter is not None:
                try:
                    adapter.close()
                except Exception:
                    pass
            # A timeout can leave the underlying daemon worker alive. Do not
            # launch overlapping readiness or measurements after that condition.
            permanent = isinstance(error, DataError) and str(error) not in TRANSIENT_CODES
            if isinstance(error, TimeoutError) or permanent:
                break
            pause(min(1.0, max(0.0, deadline - clock())))
    observations["elapsed_seconds"] = clock() - started
    raise ReadinessFailure(observations)


def adapter_factory(candidate, endpoint, source_url, token):
    if candidate == "chef":
        if not source_url:
            raise DataError("chef_source_url_required")
        return lambda: ChefTransactionAdapter(endpoint, source_url, token=token)
    if candidate == "cipherscan":
        return lambda: PostgresTransactionAdapter(endpoint, request_timeout_s=5)
    return lambda: GrpcTransactionAdapter(endpoint)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", type=str.lower, choices=NAMES, required=True)
    parser.add_argument("--endpoint-env", default="ZEER_TX_ENDPOINT")
    parser.add_argument("--source-url")
    parser.add_argument("--token-env", default="CHEF_API_TOKEN")
    parser.add_argument("--out", type=Path, required=True, help="Report prefix, without .json/.md")
    parser.add_argument("--round", type=int, choices=range(1, 6), required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--source-version", default="Zakura1.5.0")
    parser.add_argument("--profile", default="shared-vps-five-rotated-session-v1")
    parser.add_argument("--timeout", type=float, default=120)
    parser.add_argument("--readiness-seconds", type=int, default=60)
    args = parser.parse_args(argv)
    adapter, reserved, readiness = None, False, None
    started_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    try:
        if not 1 <= args.readiness_seconds <= 300:
            raise DataError("invalid_readiness_budget")
        if not math.isfinite(args.timeout) or args.timeout <= 0 or args.timeout > 300:
            raise DataError("invalid_stage_timeout")
        if any(args.out.with_suffix(suffix).exists() for suffix in (".json", ".md")):
            raise DataError("report_already_exists")
        manifest_bytes = args.manifest.read_bytes()
        manifest = json.loads(manifest_bytes.decode("utf-8-sig"))
        validate_manifest(manifest)
        endpoint = os.environ.get(args.endpoint_env)
        if not endpoint:
            raise DataError("endpoint_environment_missing")
        factory = adapter_factory(args.candidate, endpoint, args.source_url, os.environ.get(args.token_env))
        args.out.parent.mkdir(parents=True, exist_ok=True)
        with args.out.with_suffix(".json").open("x", encoding="utf-8") as output:
            json.dump({"status": "RUNNING", "candidate": NAMES[args.candidate], "round": args.round, "started_at": started_at}, output)
        reserved = True
        adapter, readiness = await_readiness(factory, manifest, seconds=args.readiness_seconds)
        report = run_benchmark(adapter, manifest,
                               candidate={"name": NAMES[args.candidate], "version": args.version,
                                          "source_version": args.source_version, "endpoint": endpoint},
                               profile=args.profile, repetitions=1, stage_timeout_s=args.timeout)
        report["started_at"] = started_at
        report["finished_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        report["readiness"] = readiness
        report["session_visit"] = {"round": args.round, "candidate_key": args.candidate,
                                   "eligible_for_comparison": False,
                                   "required_aggregation": "Five PASS visits per candidate in the same rotated session with equal manifest, records, field hashes, versions and resource profile."}
        files = [Path(__file__), Path(__file__).with_name("lookup.py"),
                 Path(__file__).resolve().parents[1] / "transactions" / "benchmark.py"]
        report["session_driver_identity"] = {file.name: hashlib.sha256(file.read_bytes()).hexdigest() for file in files}
        report["session_driver_sha256"] = canonical_sha256(report["session_driver_identity"])
        report["manifest_file_sha256"] = hashlib.sha256(manifest_bytes).hexdigest()
        report["limitations"] = [entry for entry in report["limitations"] if not entry.startswith("One verified warmup precedes")]
        report["limitations"].extend([
            "This visit has one verified 128-record warmup and exactly one measured sequential 128-record read; it is not independently eligible for ranking.",
            "The scheduler must rotate candidate order for five rounds and capture equal source/candidate/client cgroup allocations and actual resource evidence separately.",
            "Prepared-serving comparison only; source preparation and native application ingestion remain separate experiments.",
        ])
        if args.candidate == "chef":
            report["source_observations"] = adapter.source_observations
            report["response_bytes_including_warmup_and_anchors"] = adapter.chef.response_bytes
            report["limitations"].append("Chef application boundary is 2048; the frozen source and other native services are anchored at 6764.")
        write_report(report, args.out)
        print(json.dumps({"candidate": args.candidate, "round": args.round, **report["summary"]}))
        return 0 if report["summary"]["status"] == "PASS" else 1
    except Exception as error:
        failure = {**failure_fields(error), "status": "ERROR", "candidate": args.candidate,
                   "round": args.round, "started_at": started_at,
                   "finished_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                   "eligible_for_comparison": False}
        if isinstance(error, ReadinessFailure):
            failure["readiness"] = error.observations
        elif readiness:
            failure["readiness"] = readiness
        if reserved:
            args.out.with_suffix(".json").write_text(json.dumps(failure, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(failure))
        return 2
    finally:
        if adapter is not None:
            try:
                adapter.close()
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
