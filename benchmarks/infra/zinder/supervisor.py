"""Linux-only four-process supervisor for an isolated Zinder benchmark container.

Custom packaging; does not modify Zinder source or bypass its readiness checks.
"""
from __future__ import annotations

import os
import secrets
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

BIN = Path("/opt/zinder-release/bin")
CONFIG = Path("/etc/zeer-zinder")
STATE = Path("/var/lib/zinder")
SECRET = Path("/run/zeer-zinder")
SERVICES = (
    ("ingest", "zinder-ingest", 9105, 1000),
    ("projector", "zinder-projector", 9110, 1000),
    ("query", "zinder-query", 9106, 1001),
    ("compat-lightwalletd", "zinder-compat-lightwalletd", 9107, 1001),
)
CHILDREN: list[subprocess.Popen] = []
STOP = False


def ready(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/readyz", timeout=1) as response:
            return response.status == 200
    except Exception:
        return False


def prepare():
    if os.geteuid() != 0:
        raise RuntimeError("supervisor_requires_root_to_prepare_and_drop_child_privileges")
    os.umask(0o007)
    for relative in ("", "checkpoints", "projector", "projector/canonical-secondary", "query", "query/canonical-secondary", "query/wallet-secondary", "compat", "compat/canonical-secondary", "compat/wallet-secondary"):
        path = STATE / relative
        path.mkdir(parents=True, exist_ok=True)
        os.chown(path, 1000, 1000)
        os.chmod(path, 0o2770)
    SECRET.mkdir(parents=True, exist_ok=True)
    os.chown(SECRET, 0, 1000)
    os.chmod(SECRET, 0o750)
    # Files are ephemeral in tmpfs and never logged. Readers have group 1000;
    # only writer processes receive supplementary group 1002.
    for filename, group in (("ingest.token", 1000), ("checkpoint.token", 1002)):
        path = SECRET / filename
        path.write_text(secrets.token_hex(32), encoding="ascii")
        os.chown(path, 0, group)
        os.chmod(path, 0o440)


def credentials(uid: int):
    os.setgroups([1002] if uid == 1000 else [])
    os.setgid(1000)
    os.setuid(uid)


def command(name: str, binary: str, *extra: str) -> list[str]:
    return [str(BIN / binary), "--config", str(CONFIG / f"{name}.toml"), *extra]


def ensure_alive():
    for process in CHILDREN:
        if process.poll() is not None:
            raise RuntimeError(f"child_exited_pid_{process.pid}_status_{process.returncode}")
    if STOP:
        raise InterruptedError("container_stopping")


def start_service(name: str, binary: str, port: int, uid: int):
    process = subprocess.Popen(command(name, binary), preexec_fn=lambda: credentials(uid), start_new_session=True)
    CHILDREN.append(process)
    print(f"Started {name}; waiting for /readyz on {port}", flush=True)
    deadline = time.monotonic() + float(os.environ.get("ZEER_ZINDER_READY_TIMEOUT", "600"))
    while not ready(port):
        ensure_alive()
        if time.monotonic() > deadline:
            raise TimeoutError(f"readiness_timeout_{name}")
        time.sleep(1)
    ensure_alive()
    print(f"Ready: {name}", flush=True)


def stop_children():
    # Readers first, then projector, then ingest. No restart loops or state deletion.
    for process in reversed(CHILDREN):
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
    deadline = time.monotonic() + 15
    for process in reversed(CHILDREN):
        try:
            process.wait(timeout=max(0.1, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=3)


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "health":
        return 0 if all(ready(port) for _, _, port, _ in SERVICES) else 1

    def signal_stop(signum, frame):
        global STOP
        STOP = True

    signal.signal(signal.SIGTERM, signal_stop)
    signal.signal(signal.SIGINT, signal_stop)
    prepare()
    if len(sys.argv) > 1 and sys.argv[1] == "config-check":
        for name, binary, _, uid in SERVICES:
            print(f"Resolved config: {name}", flush=True)
            subprocess.run(command(name, binary, "--print-config"), check=True, preexec_fn=lambda: credentials(uid))
        return 0
    try:
        for service in SERVICES:
            start_service(*service)
        print("All four Zinder processes ready; benchmark traffic may begin.", flush=True)
        while True:
            ensure_alive()
            time.sleep(1)
    except InterruptedError:
        return 0
    except Exception as exc:
        print(f"Supervisor stopped: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
        return 1
    finally:
        stop_children()


if __name__ == "__main__":
    raise SystemExit(main())
