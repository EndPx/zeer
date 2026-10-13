"""Create a bounded disposable chain and freeze independently read RPC facts."""
import argparse
import json
import time
import urllib.request
from pathlib import Path

from benchmarks.runner import freeze_manifest


def call(endpoint, method, params, deadline):
    remaining = deadline-time.monotonic()
    if remaining <= 0:
        raise TimeoutError("Fixture preparation deadline exceeded")
    data = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(endpoint, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=min(120,remaining)) as response:
        obj = json.load(response)
    if obj.get("error"):
        raise RuntimeError(f"RPC method failed: {method}")
    return obj["result"]


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--endpoint", required=True)
    p.add_argument("--end", type=int, default=1024)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--timeout", type=float, default=1200)
    a = p.parse_args()
    if not 1 <= a.end <= 2048:
        raise ValueError("This smoke-fixture generator is bounded to 2048 blocks")
    if not 1 <= a.timeout <= 3600:
        raise ValueError("Preparation timeout must be between 1 and 3600 seconds")
    deadline=time.monotonic()+a.timeout
    rpc=lambda method,params: call(a.endpoint,method,params,deadline)
    genesis = rpc("getblockhash", [0])
    expected_genesis = "029f11d80ef9765602235e1bc9727e3eb6ba20839319f761fee920d63401e327"
    if genesis != expected_genesis:
        raise ValueError("Refusing to generate blocks on an unrecognized chain")
    info = rpc("getblockchaininfo", [])
    while info["blocks"] < a.end:
        before=info["blocks"]
        rpc("generate", [min(64, a.end-before)])
        info = rpc("getblockchaininfo", [])
        if info["blocks"] <= before:
            raise RuntimeError("Block generation did not advance; preparation aborted")
        print("generated_height", info["blocks"], flush=True)
    full = []
    compact = []
    shielded_outputs = 0
    # This first dataset must remain an explicit transparent-coinbase-only fixture.
    for h in range(1, a.end + 1):
        block_hash = rpc("getblockhash", [h])
        block = rpc("getblock", [block_hash, 1])
        ids = block["tx"]
        if len(ids) != 1:
            raise ValueError("Unexpected non-coinbase transaction in controlled fixture")
        tx = rpc("getrawtransaction", [ids[0], 1])
        if not tx.get("vin") or "coinbase" not in tx["vin"][0]:
            raise ValueError("Fixture transaction is not coinbase")
        count = len(tx.get("vShieldedOutput", [])) + len(tx.get("vShieldedSpend", []))
        for pool in ("orchard", "ironwood"):
            count += len((tx.get(pool) or {}).get("actions", []))
        shielded_outputs += count
        if count:
            raise ValueError("Unexpected shielded action: update fixture contract before measuring")
        record = {"height": h, "hash": block_hash, "prev_hash": block["previousblockhash"], "txids": ids}
        full.append(record)
        compact.append({**record, "txids": []})
    provenance = "Zebra 6.2.3 validated peerless regtest; each block/coinbase read independently via JSON-RPC. Shielded fields checked empty; compact projection excludes transparent-only transactions."
    for projection, records in [("full_transactions", full), ("shielded_compact", compact)]:
        manifest = freeze_manifest(records, network="regtest", genesis_hash=genesis, reference_name="Zebra", reference_version="6.2.3", provenance=provenance, projection=projection)
        manifest["fixture_description"] = {"kind": "synthetic-transparent-coinbase-only", "full_transaction_count": len(full), "shielded_action_count": shielded_outputs, "upgrade_schedule": "Canopy at 1, NU5 through NU6.3 at 2"}
        a.output.mkdir(parents=True, exist_ok=True)
        (a.output/f"regtest-{projection}.json").write_text(json.dumps(manifest, indent=2)+"\n")
    print("frozen", len(full), "blocks", flush=True)


if __name__ == "__main__":
    main()
