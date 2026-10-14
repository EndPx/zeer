"""Offline regressions for equivalent prepared-retrieval projections and bounds."""
import copy
import json
import os
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from pathlib import Path
import time
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from benchmarks.prep.full.retrieval import (
    Prep, Rpc, GrpcSparse, CipherScan, Http, decoded_transaction, digest, integer,
    load_dataset, measure, ordered, remaining, transaction,
)

ROOT = Path(__file__).resolve().parents[3]
ORACLE = ROOT / "benchmarks/fixtures/mainnet-public-2048/oracle.json.gz"
MANIFEST = ROOT / "benchmarks/fixtures/mainnet-transactions-v1/manifest.json"
TXID = "a" * 64


class FakeHttp:
    def __init__(self, pages):
        self.pages = iter(pages)
        self.requests, self.response_bytes, self.bodies = 0, 0, []

    def request(self, path, body=None):
        self.requests += 1
        self.response_bytes += 100
        self.bodies.append((path, body))
        return next(self.pages)


def page(next_block, rows, cursor=None, epoch="stable", revision="1"):
    return {"network": "mainnet", "epoch": epoch, "revision": revision,
            "next_block": next_block, "to_block": 2049, "cursor": cursor,
            "data": {"blocks": rows, "transactions": []}}


class RetrievalTests(unittest.TestCase):
    def test_batch_dispatch_reuses_location_verifier_and_requires_one_request(self):
        from benchmarks.prep.full import retrieval
        candidate = MagicMock()
        candidate.preflight.return_value = {'epoch': 'stable'}
        candidate.strategy, candidate.at = 'native batch', {'epoch': 'stable'}
        dataset = {'oracle_sha256': 'oracle', 'manifest_sha256': 'manifest', 'sparse': [{'txid': TXID}]}
        for requests, expected_status in [(1, 'PASS'), (2, 'FAIL')]:
            with tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / 'result.json'
                argv = ['retrieval', '--candidate', 'prep', '--workload', 'sparse', '--endpoint-env', 'TEST_ENDPOINT',
                        '--oracle', str(ORACLE), '--manifest', str(MANIFEST), '--out', str(output), '--round', '1',
                        '--prep-projection', 'metadata', '--prep-access', 'batch']
                measured = {'requests': requests, 'sha256': 'same'}
                with patch('sys.argv', argv), patch.dict(os.environ, TEST_ENDPOINT='http://private:39368'), \
                     patch.object(retrieval, 'load_dataset', return_value=dataset), \
                     patch('benchmarks.prep.full.batch_retrieval.BatchPrep', return_value=candidate), \
                     patch('benchmarks.prep.full.batch_retrieval.oracle_locations', return_value={TXID: (1, 0)}), \
                     patch('benchmarks.prep.full.batch_retrieval.verified_measure', return_value=measured) as verify:
                    self.assertEqual(retrieval.main(), 0 if expected_status == 'PASS' else 1)
                    self.assertEqual(verify.call_count, 2)
                    verify.assert_called_with(candidate, dataset['sparse'], {TXID: (1, 0)})
                result = json.loads(output.read_text())
                self.assertEqual(result['status'], expected_status)
                self.assertEqual(result['prep_access'], 'batch')
                if expected_status == 'FAIL':
                    self.assertEqual(result['failure_code'], 'BATCH_NOT_SINGLE_REQUEST')

    def test_exact_integer_and_projection_validation(self):
        for value in [True, 1.0, Decimal("1"), "01", "1e1", -1, "4294967296", None]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                integer(value)
        self.assertEqual(integer("4294967295"), 4294967295)
        observed = decoded_transaction(TXID, 10, 2, "4294967295", {
            "size": "12", "hex": "00" * 12, "vin": [{}], "vout": [{}, {}],
            "unused_amount": Decimal("0.123456789012345678901234567890"),
        })
        self.assertEqual(observed, transaction([TXID, 10, 2, 4294967295, 12, 1, 2]))
        with self.assertRaisesRegex(ValueError, "SIZE_MISMATCH"):
            decoded_transaction(TXID, 1, 1, 0, {"size": "13", "hex": "00" * 12, "vin": [], "vout": []})
        with self.assertRaisesRegex(ValueError, "MISSING_PUBLIC"):
            decoded_transaction(TXID, 1, 1, 0, {"size": "13", "vin": [], "vout": None})

    def test_retained_independent_oracle_matches_all_manifest_rows(self):
        data = load_dataset(ORACLE, MANIFEST)
        self.assertEqual([len(data[key]) for key in ("headers", "transactions", "sparse")], [2048, 16962, 128])
        self.assertIn(2, {row["version"] for row in data["transactions"]})
        self.assertEqual(digest(data["sparse"]), digest(ordered(data["sparse"][::-1], "sparse")))

    def test_prep_digest_independent_of_native_pagination(self):
        rows = [{"height": 1, "hash": "1" * 64, "time": 1}, {"height": 2048, "hash": "2" * 64, "time": 2}]
        def retrieve(pages):
            prep = Prep.__new__(Prep)
            prep.http, prep.dataset, prep.identity = FakeHttp(pages), {}, {"epoch": "stable", "revision": "1"}
            return prep.retrieve("headers"), prep.http
        first, _ = retrieve([page(2049, rows)])
        second, client = retrieve([page(2, rows[:1], "cursor"), page(2049, rows[1:])])
        self.assertEqual(digest(first), digest(second))
        self.assertEqual(client.bodies[1][1]["cursor"], "cursor")
        self.assertEqual(client.bodies[0][1]["limit"], 128)

    def test_prep_rejects_epoch_revision_truncation_and_nonprogress(self):
        for pages in ([page(2, [], "cursor"), page(2049, [], epoch="changed")],
                      [page(2049, [], revision="2")], [page(2, [])], [page(1, [])]):
            with self.subTest(pages=pages), self.assertRaises(ValueError):
                prep = Prep.__new__(Prep)
                prep.http, prep.dataset, prep.identity = FakeHttp(pages), {}, {"epoch": "stable", "revision": "1"}
                prep.retrieve("headers")

    def test_prep_sparse_uses_fixed_txid_batch_and_same_projection(self):
        row = transaction([TXID, 1, 1, 0, 12, 1, 2])
        p = page(2049, [])
        p["data"]["transactions"] = [{"txid": TXID, "block_height": 1, "version": 1, "locktime": 0,
                                           "decoded": {"size": "12", "vin": [{}], "vout": [{}, {}]}}]
        prep = Prep.__new__(Prep)
        prep.http, prep.dataset, prep.identity = FakeHttp([p]), {"sparse": [row]}, {"epoch": "stable", "revision": "1"}
        self.assertEqual(prep.retrieve("sparse"), [row])
        self.assertEqual(prep.http.bodies[0][1]["transaction_filter"], {"txids": [TXID]})

    def test_rpc_sparse_height_comes_from_source_block_and_membership_is_checked(self):
        rpc = Rpc.__new__(Rpc)
        rpc.executor = ThreadPoolExecutor(max_workers=8)
        self.addCleanup(rpc.executor.shutdown)
        selected = transaction([TXID, 1, 1, 0, 12, 1, 2])
        rpc.dataset = {"sparse": [selected]}
        calls = []
        def call(method, params):
            calls.append((method, params))
            if method == "getrawtransaction":
                return {"txid": TXID, "blockhash": "b" * 64, "version": 1, "locktime": 0, "size": 12, "vin": [{}], "vout": [{}, {}]}
            return {"hash": "b" * 64, "height": 17, "tx": [TXID]}
        rpc.call = call
        observed = rpc.retrieve("sparse")
        self.assertEqual(observed[0]["mined_height"], 17)  # selected expected height deliberately differs.
        self.assertEqual(calls, [("getrawtransaction", [TXID, 1]), ("getblock", ["b" * 64, 1])])
        rpc.call = lambda method, params: call(method, params) if method == "getrawtransaction" else {"hash": "b" * 64, "height": 17, "tx": []}
        with self.assertRaisesRegex(ValueError, "MEMBERSHIP_MISMATCH"):
            rpc.retrieve("sparse")

    def test_direct_metadata_has_same_projection_without_decoded_payload(self):
        expected = transaction([TXID, 1, 1, 0, 12, 1, 2])
        response = page(2049, [])
        response["data"]["transactions"] = [{"txid": TXID, "block_height": 1, "version": 1, "locktime": 0,
            "size_bytes": 12, "transparent_input_count": 1, "transparent_output_count": 2}]
        prep = Prep.__new__(Prep)
        prep.projection = "metadata"
        prep.http, prep.dataset, prep.identity = FakeHttp([response]), {"sparse": [expected]}, {"epoch": "stable", "revision": "1"}
        self.assertEqual(prep.retrieve("sparse"), [expected])
        fields = prep.http.bodies[0][1]["field_selection"]["transaction"]
        self.assertNotIn("decoded", fields)
        self.assertIn("size_bytes", fields)

    def test_measure_verifies_every_row_instead_of_only_counts(self):
        expected = [transaction([TXID, 1, 1, 0, 12, 1, 2])]
        class Adapter:
            count = 0
            def stats(self):
                return {"requests": self.count, "response_bytes": 100 * self.count}
            def retrieve(self, workload):
                self.count += 2
                return copy.deepcopy(expected)
        result = measure(Adapter(), "sparse", expected)
        self.assertEqual((result["status"], result["rows"], result["requests"], result["response_bytes"]), ("PASS", 1, 2, 200))
        self.assertGreater(result["retrieval_normalize_ns"], 0)
        wrong = copy.deepcopy(expected)
        wrong[0]["locktime"] = 1
        with self.assertRaisesRegex(ValueError, "PROJECTION_MISMATCH"):
            measure(Adapter(), "sparse", wrong)

    def test_deadline_and_credential_boundaries(self):
        with self.assertRaisesRegex(ValueError, "GLOBAL_DEADLINE"):
            remaining(time.monotonic() - 1)
        for endpoint in ["http://user:secret@localhost:1", "file:///tmp/a", "http://localhost/path", "http://localhost?token=secret"]:
            with self.subTest(endpoint=endpoint), self.assertRaises(ValueError):
                Http(endpoint)

    def test_grpc_looks_up_once_per_selected_id_and_rejects_full_scan(self):
        row = transaction([TXID, 1, 1, 0, 12, 1, 2])
        grpc = GrpcSparse.__new__(GrpcSparse)
        grpc.dataset, grpc.deadline = {"sparse": [row]}, time.monotonic() + 1
        class Adapter:
            calls = 0
            def lookup(self, txid, deadline):
                self.calls += 1
                return row
        grpc.adapter = Adapter()
        self.assertEqual(grpc.retrieve("sparse"), [row])
        self.assertEqual(grpc.adapter.calls, 1)
        with self.assertRaisesRegex(ValueError, "NOT_APPLICABLE"):
            grpc.retrieve("transactions")

    def test_pg_native_readonly_snapshot_includes_commands_without_fetching_command_results(self):
        commands = []
        class Cursor:
            description = None
            def __enter__(self):
                return self
            def __exit__(self, *_args):
                pass
            def execute(self, sql, params=()):
                commands.append((sql, params))
                self.description = ["fields"] if sql.startswith("SELECT txid") else None
            def fetchall(self):
                self_outer.assertIsNotNone(self.description)
                return [(TXID, 1, 1, 0, 12, 1, 2)]
        class Connection:
            def cursor(self):
                return Cursor()
        self_outer = self
        pg = CipherScan.__new__(CipherScan)
        pg.connection, pg.requests, pg.deadline = Connection(), 0, time.monotonic() + 10
        pg.dataset = {"sparse": [transaction([TXID, 1, 1, 0, 12, 1, 2])]}
        self.assertEqual(pg.retrieve("sparse"), pg.dataset["sparse"])
        queries = [sql for sql, _params in commands if not sql.startswith("SET")]
        self.assertEqual(queries[0], "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        self.assertIn("txid=ANY(%s)", queries[1])
        self.assertEqual(queries[2], "COMMIT")
        self.assertEqual(pg.requests, 6)


if __name__ == "__main__":
    unittest.main()
