"""Run one real provider on an explicitly frozen compact-projection fixture."""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from benchmarks.adapters.compact_grpc import CompactGrpcAdapter
from benchmarks.runner import run_benchmark, write_report


def client_resources():
    result={}
    for name in ("cpu.max","cpu.stat","memory.max","memory.peak","memory.events"):
        path=Path("/sys/fs/cgroup")/name
        result[name]=path.read_text().strip() if path.exists() else None
    return result


def validate_resource_budget(active, client_cpu, client_memory):
    for container in active:
        if container.get('cpu_quota',0)<=0 or container.get('memory_bytes',0)<=0:
            raise ValueError("Every active benchmark container must have explicit finite limits")
    if sum(c['cpu_quota'] for c in active)+client_cpu>2:
        raise ValueError("Environment plus client exceeds total CPU authorization")
    if sum(c['memory_bytes'] for c in active)+client_memory>4*1024**3:
        raise ValueError("Environment plus client exceeds total memory authorization")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--endpoint", required=True)
    p.add_argument("--manifest", type=Path, required=True)
    p.add_argument("--candidate", required=True)
    p.add_argument("--version", required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--environment", type=Path, required=True)
    p.add_argument("--client-cpus",type=float,choices=(0.25,1.0),default=0.25)
    a = p.parse_args()
    adapter = CompactGrpcAdapter(a.endpoint)
    try:
        manifest = json.loads(a.manifest.read_text())
        if manifest.get("network") != "regtest" or manifest.get("fixture_description",{}).get("kind") != "synthetic-transparent-coinbase-only":
            raise ValueError("This runner requires the declared synthetic coinbase-only regtest fixture")
        environment=json.loads(a.environment.read_text())
        if environment.get("profile") != "shared-vps-bounded-regtest":
            raise ValueError("Missing declared run environment profile")
        resources_before=client_resources()
        quota,period=resources_before["cpu.max"].split()
        if quota=='max' or int(quota)/int(period)!=a.client_cpus or resources_before["memory.max"] != "268435456":
            raise ValueError("Client cgroup does not match the selected bounded profile")
        active=[c for c in environment['containers'] if c['running']]
        validate_resource_budget(active,a.client_cpus,int(resources_before['memory.max']))
        source=manifest["reference_source"]
        candidate = {"name": a.candidate, "version": a.version, "source_version": f'{source["name"]} {source["version"]}', "endpoint": a.endpoint}
        warmup = run_benchmark(adapter, manifest, candidate=candidate, repetitions=1, run_timeout_s=60)
        warmup["phase"] = "full-range warmup and correctness check; excluded from measured distribution"
        write_report(warmup, str(a.output)+"-warmup")
        if warmup["summary"]["status"] != "PASS":
            print(json.dumps({"warmup": warmup["summary"], "preflight": warmup["preflight"]}))
            return 1
        adapter.payload_bytes = 0
        report = run_benchmark(adapter, manifest, candidate=candidate, repetitions=5, run_timeout_s=60)
        report["measured_at_utc"] = datetime.now(timezone.utc).isoformat()
        report["server_info"] = adapter.server_info
        report["protobuf_payload_bytes_total"] = adapter.payload_bytes
        report["environment_profile"] = "shared-vps-bounded-regtest"
        report["client_cpu_quota"] = a.client_cpus
        report["environment"] = environment
        report["client_cgroup_before"] = resources_before
        report["client_cgroup_after"] = client_resources()
        report["warmup"] = {"full_range_verified": True, "runs": 1, "excluded_from_timing": True}
        report["limitations"].extend([
            "Synthetic coinbase-only fixture: zero shielded notes; not a shielded scan/decryption benchmark.",
            "Pre-synced serving after one verified full-range warmup; cache layers are not independently controlled. Not index construction or durable application ingestion.",
            f"Shared VPS; CPU steal and other workloads remain possible. Client is limited to {a.client_cpus} CPU and can dominate these timings.",
        ])
        write_report(report, a.output)
        print(json.dumps({"summary": report["summary"], "preflight": report["preflight"], "server_info": adapter.server_info}))
        return 0 if report["summary"]["status"] == "PASS" else 1
    finally:
        adapter.close()


if __name__ == "__main__":
    raise SystemExit(main())
