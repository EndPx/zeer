"""Measure one bounded native Prep archive preparation without a timing proxy."""
import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import resource
import signal
import subprocess
import sys
import time
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from benchmarks.prep.rpc.compare import require, write_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--source-env", default="BENCH_RPC_URL")
    parser.add_argument("--rpc-cookie-file", type=Path)
    parser.add_argument("--from-block", type=int, required=True)
    parser.add_argument("--to-block", type=int, required=True, help="Exclusive end")
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    require(0 < args.from_block < args.to_block and args.to_block - args.from_block <= 1024, "BOUNDED_RANGE_REQUIRED")
    require(args.binary.is_file() and not args.archive.exists() and not args.out.exists(), "NEW_ARCHIVE_AND_OUTPUT_REQUIRED")
    source = os.environ[args.source_env]
    parsed = urlsplit(source)
    require(parsed.scheme in ("http", "https") and not parsed.username and not parsed.password and not parsed.query and not parsed.fragment, "CREDENTIAL_FREE_SOURCE_URL_REQUIRED")
    env = {key: os.environ[key] for key in ("PATH", "SystemRoot", "PREP_SOURCE_USER", "PREP_SOURCE_PASSWORD") if key in os.environ}
    if args.rpc_cookie_file:
        require(ipaddress.ip_address(parsed.hostname).is_private, "PRIVATE_AUTHENTICATED_SOURCE_REQUIRED")
        user, password = args.rpc_cookie_file.read_text().strip().split(":", 1)
        env.update(PREP_SOURCE_USER=user, PREP_SOURCE_PASSWORD=password)
    before = resource.getrusage(resource.RUSAGE_CHILDREN)
    peak_rss = 0
    result = {"status": "RUNNING", "from_block": args.from_block, "to_block": args.to_block,
              "source": "Direct already-synchronized Zebra RPC; source discovery and full-node initial sync excluded.",
              "repetitions": 1, "cache": "Warm source; no cache clearing.",
              "rpc_request_accounting": "Not instrumented in this direct timing; no reverse-proxy overhead.",
              "timer": "Native process spawn through observed successful exit; includes fetching, normalization, compression and persistence; archive verification excluded.",
              "rss_sample_interval_seconds": 0.02,
              "prep_binary_sha256": hashlib.sha256(args.binary.read_bytes()).hexdigest()}
    log = args.out.with_suffix(".log")
    with log.open("x") as output:
        started = time.perf_counter()
        child = subprocess.Popen([str(args.binary), "sync", "--source", source, "--network", "testnet",
             "--archive", str(args.archive), "--from", str(args.from_block), "--to", str(args.to_block - 1),
             "--segment-blocks", "256", "--confirmations", "1", "--max-disk-gib", "1",
             "--deadline-seconds", "180", "--allow-insecure", "--compress"], env=env, stdout=output, stderr=output)
        try:
            while child.poll() is None:
                require(time.perf_counter() - started < 195, "PREPARATION_DEADLINE")
                try:
                    for line in Path(f"/proc/{child.pid}/status").read_text().splitlines():
                        if line.startswith("VmRSS:"):
                            peak_rss = max(peak_rss, int(line.split()[1]) * 1024)
                except FileNotFoundError:
                    pass
                time.sleep(0.02)
            result["elapsed_seconds"] = time.perf_counter() - started
            require(child.returncode == 0, "PREPARATION_FAILED")
            after = resource.getrusage(resource.RUSAGE_CHILDREN)
            result["prep_process_cpu_seconds"] = after.ru_utime + after.ru_stime - before.ru_utime - before.ru_stime
            result["sampled_peak_rss_bytes"] = peak_rss
            result["archive_file_bytes"] = sum(path.stat().st_size for path in args.archive.rglob("*") if path.is_file())
            verified = time.perf_counter()
            check = subprocess.run([str(args.binary), "archive-inspect", "--archive", str(args.archive)], env=env, stdout=subprocess.DEVNULL, stderr=output, timeout=60)
            require(check.returncode == 0, "ARCHIVE_VERIFICATION_FAILED")
            catalog = json.loads((args.archive / "catalog.json").read_text())
            require(catalog["network"] == "testnet" and catalog["start_height"] == args.from_block
                    and catalog["segments"][-1]["end_height"] == args.to_block - 1, "ARCHIVE_RANGE_MISMATCH")
            result.update(status="PASS", end_hash=catalog["segments"][-1]["end_hash"], verification_seconds=time.perf_counter() - verified)
        except BaseException as error:
            result.update(status="FAIL", error_type=type(error).__name__)
            if child.poll() is None:
                child.send_signal(signal.SIGINT)
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill(); child.wait()
            raise
        finally:
            write_json(args.out, result)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
