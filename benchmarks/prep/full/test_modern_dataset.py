"""Offline checks for capture boundaries and replay publication; no network."""
import copy
import json
import pathlib
import importlib.util
import struct
import subprocess
import tempfile
import unittest
from unittest.mock import patch

if __package__:
    from . import modern_dataset as dataset
else:
    import modern_dataset as dataset


def sample(height=1687106, previous="11" * 32):
    listing = {"height": height, "version": 4, "previous_block_hash": previous,
               "merkle_root": "22" * 32, "final_sapling_root": "33" * 32,
               "timestamp": 1654000000, "bits": "1d00ffff", "nonce": "44" * 32,
               "solution": "abcd", "transaction_count": 1, "size": 147}
    raw_header = (struct.pack("<I", 4) + bytes.fromhex(previous)[::-1] + bytes.fromhex("22" * 32)
                  + bytes.fromhex("33" * 32) + struct.pack("<I", 1654000000)
                  + bytes.fromhex("ffff001d") + bytes.fromhex("44" * 32) + b"\x02\xab\xcd")
    listing["hash"] = dataset.sha256d(raw_header)
    txid = "55" * 32
    listing["transactions"] = [{"txid": txid, "tx_index": 0, "block_height": height, "block_hash": listing["hash"]}]
    decoded = {"txid": txid, "hex": "010203", "blockhash": listing["hash"], "version": 5,
               "locktime": 0, "vin": [{}], "vout": [], "orchard": {"actions": [{}, {}]}}
    return listing, [{"txid": txid, "hex": "010203", "decoded": decoded}]


class DatasetTests(unittest.TestCase):
    def test_reconstruction_checks_committed_header_and_order(self):
        listing, items = sample()
        block = dataset.build_block(listing, items, 1687106)
        self.assertEqual(block["decoded"]["hash"], listing["hash"])
        self.assertEqual(block["decoded"]["blockcommitments"], listing["final_sapling_root"])
        self.assertTrue(block["raw"].endswith("01010203"))
        for key, value in [("timestamp", 1654000001), ("final_sapling_root", "00" * 32)]:
            changed = {**listing, key: value}
            with self.assertRaisesRegex(ValueError, "header hash"):
                dataset.build_block(changed, items, 1687106)
        changed = copy.deepcopy(listing)
        changed["transactions"][0]["tx_index"] = 1
        with self.assertRaisesRegex(ValueError, "order"):
            dataset.build_block(changed, items, 1687106)
        changed_items = copy.deepcopy(items)
        changed_items[0]["decoded"]["hex"] = "00"
        with self.assertRaisesRegex(ValueError, "payload"):
            dataset.build_block(listing, changed_items, 1687106)

    def test_oracle_derives_decoder_counts_and_exact_size(self):
        listing, items = sample()
        block = dataset.build_block(listing, items, 1687106)
        oracle = dataset.oracle([block])
        self.assertEqual(oracle["range"], {"from": 1687106, "to": 1687106})
        self.assertEqual(oracle["transactions"][0]["sizeBytes"], 3)
        self.assertEqual(oracle["transactions"][0]["transparentInputCount"], 1)
        self.assertEqual(dataset.totals([block])["orchard_actions"], 2)

    def test_oracle_matches_scale_loader_and_js_public_fixture(self):
        listing, items = sample()
        block = dataset.build_block(listing, items, 1687106)
        data = dataset.oracle([block])
        repo = pathlib.Path(__file__).resolve().parents[3]
        spec = importlib.util.spec_from_file_location("prep_scale_run", repo / "benchmarks/prep/scale/run.py")
        scale = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(scale)
        with tempfile.TemporaryDirectory() as temporary:
            path = pathlib.Path(temporary) / "oracle.json.gz"
            path.write_bytes(dataset.gzip.compress(dataset.exact_json(data).encode(), mtime=0))
            loaded = scale.load_oracle(path, 1687106, 1687106)
            self.assertEqual(loaded["transactions"][0]["block_height"], 1687106)
        fixture_url = (repo / "benchmarks/chef/query/fixture.mjs").as_uri()
        script = ('import {publicFixture} from ' + json.dumps(fixture_url) + ';'
                  'let input=""; for await (const chunk of process.stdin) input+=chunk;'
                  'const f=publicFixture(JSON.parse(input));'
                  'if(f.transactions[0].minedHeight!==1687106) throw new Error("height type");')
        result = subprocess.run(["node", "--input-type=module", "-e", script], input=json.dumps(data),
                                text=True, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_cache_hash_tamper_rejected_without_network(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            store = dataset.Store(root)
            path = root / "responses" / "blocks" / "1.json"
            store.write(path, b"{}")
            store.write(path.with_suffix(".json.meta.json"), json.dumps({"sha256": "00" * 32, "bytes": 2,
                        "requested_url": dataset.API + "/block/1"}).encode())
            with patch.object(dataset.urllib.request, "urlopen", side_effect=AssertionError("network forbidden")):
                with self.assertRaisesRegex(ValueError, "checksum"):
                    store.fetch("blocks/1.json", "/block/1")

    def test_budget_and_deadline_preserve_existing_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            store = dataset.Store(root)
            path = root / "evidence.json"
            store.write(path, b"original")
            with patch.object(dataset, "MAX_BYTES", store.bytes + 2):
                with self.assertRaisesRegex(ValueError, "budget"):
                    store.write(path, b"replacement")
            self.assertEqual(path.read_bytes(), b"original")
            store.deadline = 0
            with self.assertRaisesRegex(ValueError, "deadline"):
                store.write(root / "absent", b"x")

    def test_replay_enforces_head_offline_and_read_only_methods(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            (root / "blocks").mkdir()
            (root / "capture.json").write_text(json.dumps({"from_block": 1687106, "blocks": 2}))
            first_listing, first_items = sample()
            first = dataset.build_block(first_listing, first_items, 1687106)
            second_listing, second_items = sample(1687107, first["decoded"]["hash"])
            second = dataset.build_block(second_listing, second_items, 1687107)
            for block in (first, second):
                (root / "blocks" / f'{block["decoded"]["height"]}.json').write_text(dataset.exact_json(block))
            control = root / "control.json"
            control.write_text('{"height":1687106,"online":true}')
            call = lambda method, params: dataset.replay_result(root, control, method, params)
            self.assertEqual(call("getblockhash", [1687105]), first_listing["previous_block_hash"])
            self.assertEqual(call("getblockchaininfo", [])["blocks"], 1687106)
            for method, params in [("getblockhash", [1687107]), ("getblockhash", [1687104]),
                                   ("getblock", [second_listing["hash"], 2]), ("sendrawtransaction", ["00"])]:
                with self.assertRaises(ValueError):
                    call(method, params)
            control.write_text('{"height":1687107,"online":true}')
            self.assertEqual(call("getblock", [second_listing["hash"], 0]), second["raw"])
            control.write_text('{"height":1687107,"online":false}')
            with self.assertRaisesRegex(ValueError, "offline"):
                call("getblockchaininfo", [])


if __name__ == "__main__":
    unittest.main()
