"""Read-only public-chain fixture capture; expected fields come from node RPC.

No transaction decoder from the timed benchmark is imported or used here.
Requires an already frozen Zakura 1.5.0 source; never changes node state.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, Request, build_opener

FROZEN_HEIGHT = 6764
FROZEN_HASH = "0000000160e11c9403141d7c2a16b07a2459919fc774795da3f687628c5ece54"
SELECTION_END = 2048
RECORD_COUNT = 128
MAX_RESPONSE_BYTES = 32 * 1024 * 1024
MAX_TRANSACTION_BYTES = 2_000_000
HASH_PATTERN = re.compile(r"^[0-9a-f]{64}$")
SOURCE_COMMIT = "7632c2e15a8f46fb1485f44dd290c7b7ee08afed"
READ_METHODS = frozenset(("getinfo", "getblockchaininfo", "getblockhash", "getblock", "getrawtransaction"))


class CaptureError(ValueError):
    pass


def canonical_sha256(value):
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def checked_hash(value):
    if not isinstance(value, str) or HASH_PATTERN.fullmatch(value) is None:
        raise CaptureError("invalid_hash")
    return value


def checked_int(value, name, minimum=0, maximum=0xFFFFFFFF):
    if type(value) is not int or not minimum <= value <= maximum:
        raise CaptureError("invalid_" + name)
    return value


def selected_heights():
    return [1 + (i * (SELECTION_END - 1)) // (RECORD_COUNT - 1) for i in range(RECORD_COUNT)]


class Rpc:
    def __init__(self, endpoint, timeout_s, deadline_s):
        parts = urlsplit(endpoint)
        if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password or parts.query or parts.fragment:
            raise CaptureError("invalid_rpc_endpoint")
        if not math.isfinite(timeout_s) or not 0 < timeout_s <= 120:
            raise CaptureError("invalid_rpc_timeout")
        if not math.isfinite(deadline_s) or not 0 < deadline_s <= 3600:
            raise CaptureError("invalid_total_deadline")
        self.endpoint = endpoint
        self.timeout_s = timeout_s
        self.deadline = time.monotonic() + deadline_s
        self.request_id = 0
        # Isolated local benchmark transport should not inherit an HTTP proxy.
        self.opener = build_opener(ProxyHandler({}))

    def __call__(self, method, params=None):
        if method not in READ_METHODS:
            raise CaptureError("rpc_method_not_readonly_allowlisted")
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("capture_deadline_exceeded")
        self.request_id += 1
        body = json.dumps({"jsonrpc": "1.0", "id": self.request_id, "method": method, "params": params or []}).encode("utf-8")
        request = Request(self.endpoint, data=body, headers={"Content-Type": "application/json"}, method="POST")
        try:
            with self.opener.open(request, timeout=min(self.timeout_s, remaining)) as response:
                payload = response.read(MAX_RESPONSE_BYTES + 1)
        except (HTTPError, URLError) as error:
            raise CaptureError("rpc_transport_failure_" + method) from error
        if len(payload) > MAX_RESPONSE_BYTES:
            raise CaptureError("rpc_response_too_large")
        if time.monotonic() > self.deadline:
            raise TimeoutError("capture_deadline_exceeded")
        try:
            reply = json.loads(payload)
        except (ValueError, UnicodeError):
            raise CaptureError("invalid_rpc_json") from None
        if not isinstance(reply, dict) or reply.get("id") != self.request_id or reply.get("error") is not None or "result" not in reply:
            raise CaptureError("rpc_result_failure_" + method)
        return reply["result"]


def assert_frozen(rpc):
    info = rpc("getblockchaininfo")
    if not isinstance(info, dict) or info.get("chain") not in ("main", "mainnet"):
        raise CaptureError("mainnet_source_required")
    if info.get("blocks") != FROZEN_HEIGHT or info.get("bestblockhash") != FROZEN_HASH:
        raise CaptureError("frozen_head_mismatch")
    if rpc("getblockhash", [FROZEN_HEIGHT]) != FROZEN_HASH:
        raise CaptureError("frozen_boundary_hash_mismatch")
    return {"height": FROZEN_HEIGHT, "hash": FROZEN_HASH}


def raw_v1(value):
    if not isinstance(value, str) or not 20 <= len(value) <= 2 * MAX_TRANSACTION_BYTES or len(value) % 2:
        raise CaptureError("invalid_raw_hex_size")
    if re.fullmatch(r"[0-9a-fA-F]+", value) is None:
        raise CaptureError("invalid_raw_hex")
    raw = bytes.fromhex(value)
    if int.from_bytes(raw[:4], "little") != 1:
        return None
    return raw


def inspect_candidate(rpc, txid, height, block_hash):
    verbose = rpc("getrawtransaction", [txid, 1])
    if not isinstance(verbose, dict) or verbose.get("txid") != txid:
        raise CaptureError("verbose_transaction_identity_mismatch")
    if verbose.get("blockhash") != block_hash or verbose.get("height") != height:
        raise CaptureError("verbose_transaction_inclusion_mismatch")
    version = checked_int(verbose.get("version"), "transaction_version", maximum=0xFFFFFFFF)
    raw = raw_v1(verbose.get("hex"))
    if version != 1:
        if raw is not None:
            raise CaptureError("verbose_raw_version_disagreement")
        return None
    if raw is None or verbose.get("overwintered") not in (None, False):
        raise CaptureError("verbose_raw_version_disagreement")
    if hashlib.sha256(hashlib.sha256(raw).digest()).digest()[::-1].hex() != txid:
        raise CaptureError("raw_txid_mismatch")
    inputs, outputs = verbose.get("vin"), verbose.get("vout")
    if not isinstance(inputs, list) or not inputs or not all(isinstance(item, dict) for item in inputs):
        raise CaptureError("invalid_verbose_inputs")
    if not isinstance(outputs, list) or not outputs or not all(isinstance(item, dict) for item in outputs):
        raise CaptureError("invalid_verbose_outputs")
    if "size" in verbose and verbose["size"] != len(raw):
        raise CaptureError("verbose_raw_size_disagreement")
    record = {
        "txid": txid,
        "mined_height": height,
        "version": version,
        "locktime": checked_int(verbose.get("locktime"), "locktime"),
        "size_bytes": len(raw),
        "transparent_input_count": len(inputs),
        "transparent_output_count": len(outputs),
        "raw_hex": raw.hex(),
    }
    is_coinbase = any("coinbase" in item for item in inputs)
    return record, is_coinbase


def capture(rpc):
    before = assert_frozen(rpc)
    version_info = rpc("getinfo")
    if not isinstance(version_info, dict) or not isinstance(version_info.get("subversion"), str):
        raise CaptureError("missing_node_version")
    subversion = version_info["subversion"]
    if re.search(r"/Zakura:1\.5\.0(?:/|\(|\))", subversion) is None:
        raise CaptureError("zakura_1_5_0_required")
    genesis_hash = checked_hash(rpc("getblockhash", [0]))
    records, membership, selections = [], [], []
    blocks = {FROZEN_HEIGHT: FROZEN_HASH}
    examined_versions = {}
    for height in selected_heights():
        block_hash = checked_hash(rpc("getblockhash", [height]))
        block = rpc("getblock", [block_hash, 1])
        if not isinstance(block, dict) or block.get("hash") != block_hash or block.get("height") != height:
            raise CaptureError("block_identity_mismatch")
        txids = block.get("tx")
        if not isinstance(txids, list) or not 1 <= len(txids) <= 100000:
            raise CaptureError("invalid_block_transaction_list")
        txids = [checked_hash(txid) for txid in txids]
        if len(set(txids)) != len(txids):
            raise CaptureError("duplicate_block_transaction_id")
        fallback = None
        selected = None
        for tx_index, txid in enumerate(txids):
            candidate = inspect_candidate(rpc, txid, height, block_hash)
            if candidate is None:
                examined_versions["non_v1"] = examined_versions.get("non_v1", 0) + 1
                continue
            examined_versions["v1"] = examined_versions.get("v1", 0) + 1
            record, is_coinbase = candidate
            if is_coinbase:
                if fallback is None:
                    fallback = (record, is_coinbase, tx_index)
            else:
                selected = (record, is_coinbase, tx_index)
                break
        selected = selected or fallback
        if selected is None:
            raise CaptureError("selected_height_has_no_version1_transaction")
        record, is_coinbase, tx_index = selected
        # Check the selected bytes through the non-verbose RPC route as well.
        raw = raw_v1(rpc("getrawtransaction", [record["txid"], 0]))
        if raw is None or raw.hex() != record["raw_hex"]:
            raise CaptureError("raw_verbose_route_disagreement")
        records.append(record)
        blocks[height] = block_hash
        membership.append({"height": height, "hash": block_hash, "ordered_txids": txids})
        selections.append({"height": height, "txid": record["txid"], "tx_index": tx_index, "is_coinbase": is_coinbase})
    if len(records) != RECORD_COUNT or len({record["txid"] for record in records}) != RECORD_COUNT:
        raise CaptureError("selected_records_not_unique_128")
    after = assert_frozen(rpc)
    coinbases = sum(item["is_coinbase"] for item in selections)
    manifest = {
        "schema_version": 1,
        "scenario": "transaction-lookup-preoverwinter-v1",
        "network": "mainnet",
        "genesis_hash": genesis_hash,
        "end_height": FROZEN_HEIGHT,
        "end_hash": FROZEN_HASH,
        "selection_end_height": SELECTION_END,
        "reference_source": {
            "name": "Zakura frozen Mainnet JSON-RPC",
            "version": "1.5.0",
            "provenance": "Official zakuracore/zakura:1.5.0; source commit " + SOURCE_COMMIT + "; expected fields from getrawtransaction verbose, block membership from getblock, identity verified with raw SHA256d; capture outside benchmark timing.",
            "node_subversion": subversion,
            "node_build": version_info.get("build"),
            "source_commit": SOURCE_COMMIT,
            "image_manifest_digest": "sha256:17894f48b51ee4249a6555692a07881a305085f25b5c7b0bed5887a73e2ad85a",
        },
        "blocks": [{"height": height, "hash": block_hash} for height, block_hash in sorted(blocks.items())],
        "records": records,
        "records_sha256": canonical_sha256(records),
        "selection": {
            "rule": "128 heights: 1 + floor(i*2047/127), i=0..127; earliest transaction in block order with exact raw/verbose version 1 and no coinbase input; otherwise earliest v1 coinbase.",
            "heights": selected_heights(),
            "selected_transactions": selections,
            "selected_version_distribution": {"1": len(records)},
            "selected_coinbase_count": coinbases,
            "selected_non_coinbase_count": len(records) - coinbases,
            "examined_version_categories": examined_versions,
        },
        "raw_block_membership": membership,
        "raw_block_membership_sha256": canonical_sha256(membership),
        "capture": {
            "utc": datetime.now(timezone.utc).isoformat(),
            "head_before": before,
            "head_after": after,
            "script_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            "frozen_height_reason": "Bootstrap configuration was initially omitted and the node passed the intended 2048 cap; it was stopped and isolated at the actual observed validated head 6764. The selected query range remains 1..2048.",
            "methods": sorted(READ_METHODS),
            "expected_field_source": "verbose node RPC; not the benchmark's timed decoder",
        },
    }
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--endpoint-env", default="ZEER_REFERENCE_RPC")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--rpc-timeout", type=float, default=15)
    parser.add_argument("--deadline", type=float, default=600)
    args = parser.parse_args()
    try:
        if args.output.exists():
            raise CaptureError("output_already_exists")
        rpc = Rpc(os.environ[args.endpoint_env], args.rpc_timeout, args.deadline)
        manifest = capture(rpc)
        # Schema admission only: this validator does not compute expected counts
        # or locktime using the benchmark transaction decoder.
        sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
        from benchmarks.transactions.benchmark import validate_manifest
        validate_manifest(manifest)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("x", encoding="utf-8") as output:
            output.write(json.dumps(manifest, indent=2, sort_keys=True, allow_nan=False) + "\n")
        print(json.dumps({"status": "PASS", "record_count": len(manifest["records"]), "records_sha256": manifest["records_sha256"], "coinbase_count": manifest["selection"]["selected_coinbase_count"], "non_coinbase_count": manifest["selection"]["selected_non_coinbase_count"]}))
        return 0
    except Exception as error:
        # No endpoint, full RPC error body, or environment contents in output.
        print(json.dumps({"status": "FAIL", "error_type": type(error).__name__, "code": str(error) if isinstance(error, CaptureError) else "capture_failed"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
