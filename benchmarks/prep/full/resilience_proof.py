"""Ten-minute follow proof with two real, disposable Zebra container outages.

Run on the isolated experiment's Docker host. This stops/restarts exactly the
labelled source container and mines Regtest blocks; it never restarts Prep.
The admission flag, private endpoints, exact genesis, peerless node, labels and
expected initial head must all match before any mutation.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

from reorg_proof import PrivateEndpoint, guard_source, require

LABEL = "prep-proof-20261013"
NODE = "zeer-prep-proof-node"
FOLLOWER = "zeer-prep-proof-follow"


def docker(*args):
    return subprocess.check_output(["docker", *args], text=True, timeout=40).strip()


def container(name):
    value = json.loads(docker("inspect", name))[0]
    require(value["Config"]["Labels"].get("zeer.benchmark") == LABEL,
            "container_is_not_this_disposable_experiment")
    require(not value["HostConfig"]["PortBindings"], "public_ports_forbidden")
    return value


def execute(args):
    require(args.allow_disposable_regtest_mutation, "explicit_mutation_flag_required")
    require(args.duration_seconds == 600, "this_rehearsal_is_exactly_600_seconds")
    require(not args.out.exists() and not args.out.with_suffix(".journal.jsonl").exists(),
            "refusing_existing_evidence")
    source = PrivateEndpoint(args.source)
    api = PrivateEndpoint(args.prep, os.environ.get("PREP_API_TOKEN"))
    initial = guard_source(source, args.expected_head)
    require(args.expected_head == 1024, "fresh_frozen_regtest_copy_required")
    source_container = container(NODE)
    follower = container(FOLLOWER)
    require(source_container["State"]["Running"] and follower["State"]["Running"],
            "source_and_follower_must_be_running")
    # Tie the RPC endpoint to the specific container the harness will stop.
    source_addresses = {entry["IPAddress"] for entry in source_container["NetworkSettings"]["Networks"].values()}
    require(source.host in source_addresses, "source_endpoint_must_be_the_container_ip")
    original_identity = (follower["Id"], follower["State"]["Pid"], follower["State"]["StartedAt"], follower["RestartCount"])
    status, before = api.request("/height")
    require(status == 200 and before["ready"] and before["archive_height"] == args.expected_head,
            "prep_must_have_caught_up_before_rehearsal")
    first_query = {"from_block": 1020, "to_block": 1025, "limit": 1,
                   "field_selection": {"block": ["height", "hash"], "transaction": []}}
    status, first = api.request("/query", first_query)
    require(status == 200 and first["cursor"], "initial_cursor_required")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    journal = args.out.with_suffix(".journal.jsonl")
    start = time.monotonic()
    head = args.expected_head
    next_mine = 0.0
    outages = []
    scheduled = iter([120.0, 360.0])
    next_outage = next(scheduled, None)
    phase = "online"
    active = None
    generated = []
    observations = 0

    def record(stage, **values):
        with journal.open("a", encoding="utf-8") as output:
            output.write(json.dumps({"stage": stage, "elapsed_seconds": time.monotonic()-start, **values})+"\n")

    def same_process():
        current = container(FOLLOWER)
        identity = (current["Id"], current["State"]["Pid"], current["State"]["StartedAt"], current["RestartCount"])
        require(current["State"]["Running"] and identity == original_identity,
                "follower_exited_or_restarted")

    def same_source(running):
        current = container(NODE)
        require(current["Id"] == source_container["Id"] and current["State"]["Running"] == running,
                "source_container_replaced_or_unexpected_running_state")
        if running:
            addresses = {entry["IPAddress"] for entry in current["NetworkSettings"]["Networks"].values()}
            require(source.host in addresses, "source_ip_changed")

    record("start", source_head=head, epoch=before["epoch"], follower_pid=follower["State"]["Pid"])
    try:
        while time.monotonic()-start < args.duration_seconds:
            elapsed = time.monotonic()-start
            same_process()
            if phase == "online" and next_outage is not None and elapsed >= next_outage:
                guard_source(source, head)
                same_source(True)
                active = {"stopped_at_seconds": elapsed, "head": head,
                          "unready_observations": 0, "stopped_observations": 0, "query_503_observed": False}
                record("stop_source", head=head)
                docker("stop", "--signal", "SIGINT", NODE)
                same_source(False)
                active["stop_completed_at_seconds"] = time.monotonic()-start
                phase = "offline"
            if phase == "offline":
                same_source(False)
                active["stopped_observations"] += 1
            if phase == "offline" and time.monotonic()-start >= active["stop_completed_at_seconds"]+30:
                require(active["unready_observations"] > 0 and active["query_503_observed"],
                        "source_failure_did_not_fail_readiness_and_queries_closed")
                docker("start", NODE)
                same_source(True)
                active["restarted_at_seconds"] = time.monotonic()-start
                record("restart_source", head=head)
                phase = "recovering"

            status, meta = api.request("/height")
            require(status == 200 and meta["network"] == "regtest", "metadata_unavailable")
            observations += 1
            if phase == "offline" and not meta["ready"]:
                active["unready_observations"] += 1
                code, error = api.request("/query", first_query)
                require(code == 503 and error.get("error", {}).get("code") == "SOURCE_NOT_READY",
                        "query_did_not_fail_closed_during_outage")
                active["query_503_observed"] = True
                require(meta["archive_height"] == head, "committed_head_changed_during_outage")
            if phase == "recovering":
                require(time.monotonic()-start-active["restarted_at_seconds"] < 90,
                        "recovery_time_bound_exceeded")
                if meta["ready"] and meta["archive_height"] == head:
                    guard_source(source, head)
                    require(meta["epoch"] == before["epoch"], "outage_changed_epoch")
                    active["recovered_at_seconds"] = time.monotonic()-start
                    active["recovery_after_restart_seconds"] = active["recovered_at_seconds"]-active["restarted_at_seconds"]
                    outages.append(active)
                    record("recovered", **active)
                    active = None
                    phase = "online"
                    next_outage = next(scheduled, None)

            elapsed = time.monotonic()-start
            if phase == "online" and elapsed >= next_mine:
                guard_source(source, head)
                hashes = source.rpc("generate", [1])
                require(len(hashes) == 1, "unexpected_mined_count")
                head += 1
                generated.append({"height": head, "hash": hashes[0]})
                next_mine = elapsed+30
                record("mined", height=head, hash=hashes[0])
            record("observation", phase=phase, ready=meta["ready"], indexed_height=meta["archive_height"], source_head=head)
            time.sleep(1)

        require(phase == "online" and len(outages) == 2, "incomplete_outage_cycles")
        deadline = time.monotonic()+20
        while True:
            same_process()
            status, after = api.request("/height")
            if status == 200 and after["ready"] and after["archive_height"] == head:
                break
            require(time.monotonic() < deadline, "final_catchup_failed")
            time.sleep(.5)
        require(after["epoch"] == before["epoch"] and after["lag_blocks"] == 0,
                "unexpected_epoch_or_lag")
        old_cursor = first["cursor"]
        for expected_height in range(1021, 1025):
            status, continued = api.request("/query", {**first_query, "cursor": old_cursor})
            require(status == 200 and continued["to_block"] == 1025 and continued["epoch"] == first["epoch"]
                    and continued["next_block"] == expected_height+1
                    and continued["data"]["blocks"] == [{"height": expected_height, "hash": source.rpc("getblockhash", [expected_height])}],
                    "append_or_outage_corrupted_historical_cursor_continuation")
            old_cursor = continued["cursor"]
            require((old_cursor is None) == (expected_height == 1024), "old_cursor_ended_at_wrong_block")
        selection = {"block": ["height", "hash", "raw"],
                     "transaction": ["txid", "block_height", "index", "raw"]}
        status, complete = api.request("/query", {"from_block": 1020, "to_block": head+1,
                                                  "limit": 100, "field_selection": selection})
        require(status == 200 and complete["cursor"] is None, "final_range_incomplete")
        blocks, transactions = complete["data"]["blocks"], complete["data"]["transactions"]
        require([b["height"] for b in blocks] == list(range(1020, head+1)), "duplicate_or_missing_blocks")
        expected = []
        for block in blocks:
            canonical = source.rpc("getblockhash", [block["height"]])
            require(block["hash"] == canonical and block["raw"] == source.rpc("getblock", [canonical, 0]),
                    "raw_block_or_hash_mismatch")
            decoded = source.rpc("getblock", [canonical, 2])
            expected.extend({"txid": tx["txid"], "block_height": block["height"], "index": index, "raw": tx["hex"]}
                            for index, tx in enumerate(decoded["tx"]))
        require(transactions == expected, "transaction_bytes_or_order_mismatch")
        guard_source(source, head)
        same_process()
        result = {"schema_version": 1, "status": "PASS", "network": "isolated-regtest",
                  "duration_seconds": time.monotonic()-start, "initial_height": initial["blocks"],
                  "final_height": head, "generated_blocks": generated, "outages": outages,
                  "observations": observations, "verified_blocks": len(blocks), "verified_transactions": len(transactions),
                  "follower_same_container_pid_and_start_time": True, "follower_identity": original_identity,
                  "unchanged_epoch": after["epoch"], "old_cursor_still_valid": True,
                  "limits": "Ten-minute peerless Regtest rehearsal with two30-second stopped-node intervals; no long-term public-network production soak."}
        args.out.write_text(json.dumps(result, indent=2)+"\n", encoding="utf-8")
        record("pass", final_height=head)
        print(json.dumps(result, indent=2), flush=True)
    except Exception as error:
        record("failed", error_type=type(error).__name__, error=str(error))
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--prep", required=True)
    parser.add_argument("--expected-head", type=int, required=True)
    parser.add_argument("--duration-seconds", type=int, default=600)
    parser.add_argument("--allow-disposable-regtest-mutation", action="store_true")
    parser.add_argument("--out", type=Path, required=True)
    execute(parser.parse_args())
