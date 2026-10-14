"""Offline checks for complete equivalent batch retrieval and independent positions."""
import copy
from pathlib import Path
import unittest
from unittest.mock import patch

from benchmarks.prep.full.batch_retrieval import BatchPrep, BATCH_FIELDS, oracle_locations, verified_measure
from benchmarks.prep.full.retrieval import load_dataset, transaction, TO

ROOT = Path(__file__).resolve().parents[3]
A, B = "a" * 64, "b" * 64


def fixture():
    selected = [transaction([A, 1, 1, 0, 12, 1, 2]), transaction([B, 2, 1, 1, 20, 1, 1])]
    headers = [{"height": TO, "hash": "c" * 64, "time": 1}]
    identity = {"network": "mainnet", "start_block": 1, "archive_height": TO, "epoch": "3", "revision": "4"}
    snapshot = {"network": "mainnet", "archive_start": 1, "to_block": TO + 1, "epoch": "3", "boundary_hash": "c" * 64}
    rows = [dict(zip(BATCH_FIELDS, [A, 1, 0, 1, 0, 12, 1, 2])), dict(zip(BATCH_FIELDS, [B, 2, 0, 1, 1, 20, 1, 1]))]
    response = {"network": "mainnet", "epoch": "3", "revision": "4", "archive_height": TO, "from_block": 1,
                "to_block": TO + 1, "snapshot": snapshot, "complete": True, "transactions": rows, "missing_txids": []}
    return {"sparse": selected, "headers": headers}, identity, response


class FakeHttp:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.requests, self.response_bytes, self.bodies = 0, 0, []
    def request(self, path, body=None):
        self.bodies.append((path, copy.deepcopy(body)))
        self.requests += 1
        self.response_bytes += 100
        return copy.deepcopy(next(self.responses))


def adapter(responses):
    dataset, identity, _response = fixture()
    result = BatchPrep.__new__(BatchPrep)
    result.dataset, result.identity, result.http = dataset, identity, FakeHttp(responses)
    result.at, result.last_locations = None, {}
    return result


class BatchRetrievalTests(unittest.TestCase):
    def test_preflight_requires_advertised_route_id_limit_and_projection_support(self):
        caps = {"api_version": 1, "routes": ["/transactions"], "transactions": {"max_ids": 128, "max_range_blocks": 10000, "max_records": 4096, "max_response_bytes": 4194304}, "query": {"transaction_fields": BATCH_FIELDS}}
        for mutate in [None, lambda value: value.update(routes=[]), lambda value: value["transactions"].update(max_ids=127), lambda value: value["query"].update(transaction_fields=["txid"])]:
            current = copy.deepcopy(caps)
            if mutate: mutate(current)
            candidate = adapter([current])
            with patch("benchmarks.prep.full.batch_retrieval.Prep.preflight", return_value=candidate.identity):
                if mutate is None:
                    self.assertEqual(candidate.preflight(), candidate.identity)
                    self.assertEqual(candidate.http.bodies, [("/capabilities", None)])
                else:
                    with self.assertRaises(ValueError): candidate.preflight()

    def test_verified_warmup_binds_timed_request_and_returns_one_request_metrics(self):
        dataset, _identity, response = fixture()
        candidate = adapter([response, response])
        positions = {A: (1, 0), B: (2, 0)}
        warm = verified_measure(candidate, dataset["sparse"], positions)
        measured = verified_measure(candidate, dataset["sparse"], positions)
        self.assertEqual(warm["sha256"], measured["sha256"])
        self.assertEqual((measured["rows"], measured["requests"], measured["response_bytes"]), (2, 1, 100))
        self.assertNotIn("at", candidate.http.bodies[0][1])
        self.assertEqual(candidate.http.bodies[1][1]["at"], response["snapshot"])
        self.assertEqual(candidate.http.bodies[1][1]["fields"], BATCH_FIELDS)

    def test_partial_missing_unrequested_duplicate_or_unordered_rows_are_rejected(self):
        _dataset, _identity, response = fixture()
        mutators = [lambda value: value.update(complete=False), lambda value: value.update(missing_txids=[A]),
                    lambda value: value["transactions"].pop(), lambda value: value["transactions"][0].update(txid="d" * 64),
                    lambda value: value["transactions"].append(copy.deepcopy(value["transactions"][0])),
                    lambda value: value["transactions"].reverse(), lambda value: value["transactions"][0].update(index="0"),
                    lambda value: value["transactions"][0].pop("size_bytes")]
        for mutate in mutators:
            changed = copy.deepcopy(response); mutate(changed)
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                adapter([changed]).retrieve("sparse")

    def test_snapshot_epoch_boundary_range_or_archive_changes_are_rejected(self):
        _dataset, _identity, response = fixture()
        for mutate in [lambda value: value.update(epoch="4"), lambda value: value.update(to_block=2048),
                       lambda value: value.update(archive_height=2049), lambda value: value["snapshot"].update(boundary_hash="d" * 64),
                       lambda value: value["snapshot"].update(archive_start=0)]:
            changed = copy.deepcopy(response); mutate(changed)
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                adapter([changed]).retrieve("sparse")

    def test_wrong_index_position_passes_schema_but_fails_independent_oracle_check(self):
        dataset, _identity, response = fixture()
        response["transactions"][0]["index"] = 5
        with self.assertRaisesRegex(ValueError, "ORACLE_LOCATION_MISMATCH"):
            verified_measure(adapter([response]), dataset["sparse"], {A: (1, 0), B: (2, 0)})

    def test_measured_payload_values_are_not_populated_from_expected_oracle(self):
        dataset, _identity, response = fixture()
        response["transactions"][0]["locktime"] = 123
        candidate = adapter([response])
        self.assertEqual(candidate.retrieve("sparse")[0]["locktime"], 123)
        with self.assertRaisesRegex(ValueError, "PROJECTION_MISMATCH"):
            verified_measure(adapter([response]), dataset["sparse"], {A: (1, 0), B: (2, 0)})

    def test_retained_oracle_positions_follow_node_order_not_sorted_txid_order(self):
        dataset = load_dataset(ROOT / "benchmarks/results/raw/2026-10-14-chef/indexing-oracle.json.gz",
                               ROOT / "benchmarks/fixtures/mainnet-transactions-v1/manifest.json")
        positions = oracle_locations(dataset)
        self.assertEqual(len(positions), 16962)
        self.assertTrue(all(row["txid"] in positions for row in dataset["sparse"]))
        synthetic = {"oracle": {"blocks": [{"id": "1", "transactionCount": 2}],
            "transactions": [{"id": B, "minedHeight": 1}, {"id": A, "minedHeight": 1}]}}
        self.assertEqual(oracle_locations(synthetic), {B: (1, 0), A: (1, 1)})
        synthetic["oracle"]["blocks"][0]["transactionCount"] = 3
        with self.assertRaisesRegex(ValueError, "COUNT_MISMATCH"):
            oracle_locations(synthetic)


if __name__ == "__main__":
    unittest.main()
