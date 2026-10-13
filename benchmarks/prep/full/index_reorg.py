"""Independent compact metadata/index proof around an explicit disposable Regtest reorg.

Mutation authorization and private/peerless/genesis guards are inherited from
reorg_proof.execute. This wrapper also checks indexed metadata and txid locations.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from benchmarks.prep.full import reorg_proof

require = reorg_proof.require
FIELDS = ["txid", "block_height", "index", "version", "locktime", "size_bytes", "transparent_input_count", "transparent_output_count"]
SELECTION = {"block": ["height", "hash", "time"], "transaction": FIELDS}


def uint(value):
    require(type(value) is int and 0 <= value <= 0xffffffff, "invalid_public_integer")
    return value


def metadata(tx, height, index):
    raw = tx.get("hex")
    require(isinstance(raw, str) and len(raw) > 0 and len(raw) % 2 == 0 and re.fullmatch(r"[0-9a-fA-F]+", raw), "invalid_public_raw_hex")
    require(isinstance(tx.get("txid"), str) and re.fullmatch(r"[0-9a-f]{64}", tx["txid"]), "invalid_public_txid")
    require(isinstance(tx.get("vin"), list) and isinstance(tx.get("vout"), list), "missing_public_arrays")
    size = uint(len(raw) // 2)
    require("size" not in tx or uint(tx["size"]) == size, "public_size_mismatch")
    return dict(zip(FIELDS, [tx["txid"], uint(height), uint(index), uint(tx["version"]), uint(tx["locktime"]), size, uint(len(tx["vin"])), uint(len(tx["vout"]))]))


def canonical(source, start, end):
    blocks, transactions = [], []
    for height in range(start, end + 1):
        blockhash = source.rpc("getblockhash", [height])
        block = source.rpc("getblock", [blockhash, 2])
        require(block.get("hash") == blockhash and uint(block["height"]) == height and isinstance(block.get("tx"), list) and block["tx"], "canonical_block_mismatch")
        blocks.append({"height": height, "hash": blockhash, "time": uint(block["time"])})
        transactions.extend(metadata(tx, height, index) for index, tx in enumerate(block["tx"]))
    return {"blocks": blocks, "transactions": transactions}


def scan(prep, query, epoch):
    rows = {"blocks": [], "transactions": []}
    cursor, previous = None, query["from_block"]
    for _ in range(40):
        status, page = prep.request("/query", {**query, **({"cursor": cursor} if cursor else {})})
        require(status == 200 and page.get("network") == "regtest" and page.get("epoch") == epoch and page.get("to_block") == query["to_block"] and previous < page["next_block"] <= query["to_block"], "unstable_or_nonadvancing_metadata_page")
        for key in rows:
            rows[key].extend(page["data"][key])
        previous, cursor = page["next_block"], page["cursor"]
        if cursor is None:
            require(previous == query["to_block"], "incomplete_metadata_range")
            return rows
    raise ValueError("metadata_page_bound")


def verify(prep, query, epoch, expected, ids=None):
    request = query if ids is None else {**query, "transaction_filter": {"txids": ids}}
    observed = scan(prep, request, epoch)
    wanted = expected if ids is None else {"blocks": expected["blocks"], "transactions": [row for row in expected["transactions"] if row["txid"] in set(ids)]}
    require(observed == wanted, "compact_metadata_or_location_mismatch")
    locations = [(row["block_height"], row["index"]) for row in observed["transactions"]]
    require(len(locations) == len(set(locations)), "duplicate_metadata_location")
    return {"rows": len(locations), "sha256": hashlib.sha256(json.dumps(observed, sort_keys=True, separators=(",", ":")).encode()).hexdigest()}


def execute(args):
    require(args.allow_disposable_regtest_mutation, "explicit_disposable_mutation_flag_required")
    require(not args.out.exists(), "refusing_existing_result")
    require(1 <= args.depth <= 5 and 1 <= args.from_block < args.expected_head - args.depth and args.expected_head - args.from_block <= 30 and 5 <= args.timeout <= 300, "bounded_surviving_range_required")
    require(args.confirmations in (0, 1, 2) and max(args.confirmations - 1, 0) < args.depth, "invalid_confirmation_lag")
    source = reorg_proof.PrivateEndpoint(args.source)
    prep = reorg_proof.PrivateEndpoint(args.prep, os.environ.get("PREP_API_TOKEN"))
    reorg_proof.guard_source(source, args.expected_head)
    initial_indexed = args.expected_head - max(args.confirmations - 1, 0)
    before = canonical(source, args.from_block, initial_indexed)
    status, before_meta = prep.request("/height")
    require(status == 200 and before_meta.get("ready") and before_meta.get("network") == "regtest" and before_meta.get("archive_height") == initial_indexed, "prep_initial_head_mismatch")
    old_query = {"from_block": args.from_block, "to_block": initial_indexed + 1, "limit": 1, "field_selection": SELECTION}
    status, old_page = prep.request("/query", old_query)
    require(status == 200 and old_page.get("cursor") and old_page.get("epoch") == before_meta["epoch"], "old_metadata_cursor_required")
    before_checks = {"all": verify(prep, old_query, before_meta["epoch"], before), "tip_txids": verify(prep, old_query, before_meta["epoch"], before, [row["txid"] for row in before["transactions"] if row["block_height"] == initial_indexed])}
    base_path = args.out.with_name(args.out.stem + ".raw-reorg.json")
    base_args = argparse.Namespace(**{**vars(args), "out": base_path})
    reorg_proof.execute(base_args)
    base = json.loads(base_path.read_text(encoding="utf-8"))
    reorg_proof.guard_source(source, args.expected_head + 1)
    after = canonical(source, args.from_block, base["final_indexed_height"])
    status, after_meta = prep.request("/height")
    require(status == 200 and after_meta.get("ready") and after_meta.get("archive_height") == base["final_indexed_height"] and int(after_meta["epoch"]) > int(before_meta["epoch"]), "prep_replacement_not_ready")
    query = {**old_query, "to_block": base["final_indexed_height"] + 1, "limit": 2}
    checks = {"all": verify(prep, query, after_meta["epoch"], after), "canonical_id_chunks": [], "old_id_chunks": []}
    old_ids = sorted({row["txid"] for row in before["transactions"]})
    new_ids = sorted({row["txid"] for row in after["transactions"]})
    for name, ids in (("canonical_id_chunks", new_ids), ("old_id_chunks", old_ids)):
        # Deliberately repeat each ID; 64 unique IDs become at most 128 filter entries.
        for offset in range(0, len(ids), 64):
            batch = ids[offset:offset + 64]
            checks[name].append(verify(prep, query, after_meta["epoch"], after, batch + batch))
    status, stale = prep.request("/query", {**old_query, "cursor": old_page["cursor"]})
    require(status == 409 and stale.get("error", {}).get("code") == "REORG", "old_metadata_cursor_not_rejected")
    removed_ids = set(old_ids) - set(new_ids)
    require(not any(row["txid"] in removed_ids for row in after["transactions"]), "orphan_id_still_canonical")
    reorg_proof.guard_source(source, args.expected_head + 1)
    require(source.rpc("getblockhash", [base["final_indexed_height"]]) == after["blocks"][-1]["hash"], "source_changed_during_metadata_proof")
    result = {"schema_version": 1, "status": "PASS", "network": "disposable-peerless-regtest", "raw_reorg_proof": str(base_path), "before": before, "after": after, "before_checks": before_checks, "after_checks": checks, "old_epoch": before_meta["epoch"], "new_epoch": after_meta["epoch"], "old_metadata_cursor_status": status, "old_metadata_cursor_error": stale["error"]["code"], "removed_unique_txid_count": len(removed_ids), "retained_old_txid_count": len(set(old_ids) & set(new_ids)), "appended_metadata": [row for row in after["transactions"] if row["block_height"] > initial_indexed], "limitations": "Administrative Regtest branch replacement, not natural P2P/mainnet/deep-reorg proof. Reused coinbase txids are checked at all canonical locations; only noncanonical old IDs are required absent."}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("x", encoding="utf-8") as output:
        json.dump(result, output, indent=2)
        output.write("\n")
    print(json.dumps({"status": result["status"], "removed_unique_txid_count": len(removed_ids), "old_epoch": result["old_epoch"], "new_epoch": result["new_epoch"]}))


def self_test():
    import unittest
    class MetadataTests(unittest.TestCase):
        def test_version6_public_projection_ignores_float_economic_fields(self):
            tx = {"txid": "a" * 64, "version": 6, "locktime": 4294967295, "hex": "00" * 129, "vin": [{}, {}], "vout": [{"value": 0.1}], "size": 129}
            self.assertEqual(metadata(tx, 1044, 3), dict(zip(FIELDS, ["a" * 64, 1044, 3, 6, 4294967295, 129, 2, 1])))
            for override in ({"version": 6.0}, {"size": 128}, {"vin": None}, {"hex": "0"}, {"locktime": True}):
                with self.subTest(override=override), self.assertRaises(ValueError):
                    metadata({**tx, **override}, 1044, 3)
        def test_authorization_required_before_endpoint_or_mutation(self):
            with self.assertRaisesRegex(ValueError, "explicit_disposable"):
                execute(argparse.Namespace(allow_disposable_regtest_mutation=False))
        def test_duplicate_ids_preserve_all_canonical_locations_and_headers(self):
            tx = {"txid": "a" * 64, "version": 6, "locktime": 0, "hex": "0011", "vin": [{}], "vout": []}
            expected = {"blocks": [{"height": 1043, "hash": "b" * 64, "time": 1}, {"height": 1044, "hash": "c" * 64, "time": 2}], "transactions": [metadata(tx, height, 0) for height in (1043, 1044)]}
            class Prep:
                def request(self, path, body):
                    ids = body["transaction_filter"]["txids"]
                    return 200, {"network": "regtest", "epoch": "2", "to_block": 1045, "next_block": 1045, "cursor": None, "data": {"blocks": expected["blocks"], "transactions": [row for row in expected["transactions"] if row["txid"] in ids]}}
            query = {"from_block": 1043, "to_block": 1045}
            self.assertEqual(verify(Prep(), query, "2", expected, [tx["txid"], tx["txid"]])["rows"], 2)
            self.assertEqual(verify(Prep(), query, "2", expected, ["d" * 64])["rows"], 0)
    return unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(MetadataTests)).wasSuccessful()


def main():
    if sys.argv[1:] == ["--self-test"]:
        return 0 if self_test() else 1
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("source", "prep"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--expected-head", type=int, required=True)
    parser.add_argument("--from-block", type=int, required=True)
    parser.add_argument("--depth", type=int, default=2)
    parser.add_argument("--confirmations", type=int, choices=(0, 1, 2), default=1)
    parser.add_argument("--timeout", type=float, default=90)
    parser.add_argument("--allow-disposable-regtest-mutation", action="store_true")
    parser.add_argument("--out", type=Path, required=True)
    execute(parser.parse_args())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
