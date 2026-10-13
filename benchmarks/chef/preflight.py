"""Bounded read-only public-source coverage probe; never a throughput benchmark.

Requires grpcurl in PATH. No historical range download, credentials, wallet
keys, service mutations, container starts, or database connections are used.
"""
import argparse
import base64
import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.request

API = "https://api.mainnet.cipherscan.app/api"
ROOT = Path(__file__).resolve().parents[2]
MAX_BODY = 4 * 1024 * 1024


def http(path):
    url = API + path
    request = urllib.request.Request(url, headers={"User-Agent": "Zeer-bounded-coverage-preflight/1.0"})
    started = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read(MAX_BODY + 1)
            if len(raw) > MAX_BODY:
                raise ValueError("response_exceeds_4MiB")
            value = json.loads(raw)
            fields = ("chain", "blocks", "headers", "bestblockhash", "pruned", "size_on_disk", "build",
                      "height", "hash", "previous_block_hash", "timestamp", "transaction_count")
            return {"url": url, "status": response.status, "bytes": len(raw),
                    "body_sha256": hashlib.sha256(raw).hexdigest(),
                    "fields": {name: value[name] for name in fields if name in value},
                    "response_seconds": time.monotonic() - started}
    except urllib.error.HTTPError as error:
        return {"url": url, "status": error.code, "error": error.reason}
    except Exception as error:
        return {"url": url, "error": type(error).__name__ + ": " + str(error)}


def grpc(endpoint, method, request):
    command = ["grpcurl", "-max-time", "15", "-import-path", str(ROOT / "benchmarks/proto"),
               "-proto", "service.proto", "-d", json.dumps(request), endpoint,
               "cash.z.wallet.sdk.rpc.CompactTxStreamer/" + method]
    started = time.monotonic()
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=20, check=False)
        record = {"endpoint": endpoint, "method": method, "request": request,
                  "response_seconds": time.monotonic() - started, "exit_code": result.returncode}
        if result.returncode:
            record["error"] = result.stderr.strip()
        else:
            value = json.loads(result.stdout)
            if method == "GetLightdInfo":
                record["fields"] = value
            else:
                record["fields"] = {key: value[key] for key in ("height", "time") if key in value}
                for name in ("hash", "prevHash"):
                    if name in value:
                        record["fields"][name] = base64.b64decode(value[name])[::-1].hex()
                record["fields"]["compact_transactions"] = len(value.get("vtx", []))
        return record
    except Exception as error:
        return {"endpoint": endpoint, "method": method, "request": request,
                "error": type(error).__name__ + ": " + str(error)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if args.out.exists():
        raise FileExistsError("refusing to overwrite earlier evidence")
    report = {"schema_version": 1, "started_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "purpose": "bounded-public-source-coverage-not-performance", "http": [], "grpc": []}
    tip = http("/blockchain-info")
    report["http"].append(tip)
    height = tip.get("fields", {}).get("blocks")
    if not isinstance(height, int) or height < 1687104:
        raise RuntimeError("no valid mainnet height; do not guess a latest-block target")
    report["pinned_observed_tip"] = {"height": height, "hash": tip["fields"]["bestblockhash"]}
    for number in (0, 1, height):
        report["http"].append(http("/block/" + str(number)))
    for endpoint in ("zec.rocks:443", "zec.0xrpc.io:443"):
        report["grpc"].append(grpc(endpoint, "GetLightdInfo", {}))
        for number in (0, 1, height):
            report["grpc"].append(grpc(endpoint, "GetBlock", {"height": number}))
    report["finished_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    report["limitations"] = [
        "Single requests are coverage probes; response seconds are not benchmark samples.",
        "Provider node disk use is reported remotely, not a local measurement or all deployments' minimum.",
        "Three sampled heights do not prove absence of historical gaps.",
        "Compact blocks cannot substitute for full public transaction fields.",
        "No genesis-to-tip run or performance extrapolation was performed."]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
