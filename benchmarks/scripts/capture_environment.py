"""Read-only, sanitized Linux/Docker evidence for the authorized benchmark."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform
import subprocess


def docker(*args):
    return subprocess.check_output(["docker",*args],text=True,timeout=30)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--output",type=Path,required=True)
    a=p.parse_args()
    containers=[]
    ids=docker("ps","-aq","--filter","label=zeer.benchmark=20261013").split()
    for cid in ids:
        c=json.loads(docker("inspect",cid))[0]
        im=json.loads(docker("image","inspect",c["Image"]))[0]
        h=c["HostConfig"]
        containers.append({
            "name":c["Name"].lstrip('/'),"running":c["State"]["Running"],"oom_killed":c["State"]["OOMKilled"],
            "image_id":c["Image"],"image_digests":im.get("RepoDigests",[]),
            "declared_source_revision":(im["Config"].get("Labels") or {}).get("org.opencontainers.image.revision"),
            "cpu_quota":h["NanoCpus"]/1e9,"memory_bytes":h["Memory"],"memory_swap_bytes":h["MemorySwap"],
            "ports":h.get("PortBindings",{}),
        })
    active=[c for c in containers if c["running"]]
    if sum(c["cpu_quota"] for c in active)>2 or sum(c["memory_bytes"] for c in active)>4*1024**3:
        raise RuntimeError("Active benchmark container quotas exceed authorization")
    mem={line.split(':')[0]:line.split(':')[1].strip() for line in Path('/proc/meminfo').read_text().splitlines()}
    cpu=next((line.split(':',1)[1].strip() for line in Path('/proc/cpuinfo').read_text().splitlines() if line.startswith('model name')),'unknown')
    data={"schema_version":1,"profile":"shared-vps-bounded-regtest","captured_at_utc":datetime.now(timezone.utc).isoformat(),
          "os":platform.platform(),"cpu_model":cpu,"logical_cpus":os.cpu_count(),"load_average":os.getloadavg(),
          "host_mem_total":mem.get('MemTotal'),"host_mem_available":mem.get('MemAvailable'),
          "host_swap_free":mem.get('SwapFree'),"docker_version":docker('version','--format','{{.Server.Version}}').strip(),
          "containers":containers,"limits":{"total_cpu":2,"total_memory_bytes":4*1024**3,"operational_disk_bytes":10*1024**3},
          "isolation":"shared VPS; no existing application stopped; CPU quotas are not dedicated cores"}
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(data,indent=2)+'\n')
    print('environment_written',a.output)


if __name__=='__main__':
    main()
