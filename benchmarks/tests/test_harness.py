"""Offline correctness tests; synthetic identities are not real chain evidence."""

import copy
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from benchmarks.runner.harness import (
    BenchmarkError, JsonRpcAdapter, canonical_sha256, freeze_manifest,
    normalize_record, redact_endpoint, render_markdown, run_benchmark,
    validate_manifest, verify_records, write_report,
)


def hexid(value):
    return f"{value:064x}"


def fixture():
    records = [
        {"height": 10, "hash": hexid(10), "prev_hash": hexid(9), "txids": [hexid(100), hexid(101)]},
        {"height": 11, "hash": hexid(11), "prev_hash": hexid(10), "txids": [hexid(102)]},
        {"height": 12, "hash": hexid(12), "prev_hash": hexid(11), "txids": [hexid(103)]},
    ]
    return freeze_manifest(records, network="testnet", genesis_hash=hexid(1), reference_name="synthetic-test", reference_version="fixture-v1", provenance="Unit-test constructed identities; not chain data")


CANDIDATE = {"name": "fixture-reader", "version": "test-v1", "source_version": "fixture-v1", "endpoint": "https://host.example:443/private-key?token=secret"}


class FakeAdapter:
    def __init__(self, records):
        self.records = records
        self.calls = 0

    def check_source(self, manifest, deadline):
        if manifest["network"] != "testnet" or manifest["genesis_hash"] != hexid(1):
            raise BenchmarkError("source_identity_mismatch")

    def read_blocks(self, start, end, deadline):
        self.calls += 1
        yield from copy.deepcopy(self.records)


class ManifestTests(unittest.TestCase):
    def test_canonical_hash_is_key_order_independent(self):
        self.assertEqual(canonical_sha256({"a": 1, "b": 2}), canonical_sha256({"b": 2, "a": 1}))

    def test_valid_reference_exact_projection(self):
        manifest = fixture()
        self.assertEqual(validate_manifest(manifest), manifest["records"])

    def test_tampered_record_checksum_rejected(self):
        manifest = fixture()
        manifest["records"][0]["txids"][0] = hexid(999)
        with self.assertRaisesRegex(BenchmarkError, "checksum"):
            validate_manifest(manifest)

    def test_field_checksum_rejected(self):
        manifest = fixture()
        manifest["field_sha256"]["txids"] = hexid(999)
        with self.assertRaisesRegex(BenchmarkError, "field_checksum"):
            validate_manifest(manifest)

    def test_metadata_and_boundary_enforced(self):
        for key, value in (("network", "unknown"), ("start_hash", hexid(999)), ("end_height", 14), ("genesis_hash", "")):
            with self.subTest(key=key):
                manifest = fixture()
                manifest[key] = value
                with self.assertRaises(BenchmarkError):
                    validate_manifest(manifest)
        manifest = fixture()
        del manifest["reference_source"]["version"]
        with self.assertRaises(BenchmarkError):
            validate_manifest(manifest)

    def test_partial_and_duplicate_reference_ranges_rejected(self):
        records = fixture()["records"]
        for changed in ([records[0], records[2]], [records[0], records[0], records[2]]):
            with self.assertRaises(BenchmarkError):
                freeze_manifest(changed, network="testnet", genesis_hash=hexid(1), reference_name="test", reference_version="1", provenance="synthetic")

    def test_wrong_parent_rejected(self):
        records = fixture()["records"]
        records[1]["prev_hash"] = hexid(999)
        with self.assertRaisesRegex(BenchmarkError, "parent"):
            freeze_manifest(records, network="testnet", genesis_hash=hexid(1), reference_name="test", reference_version="1", provenance="synthetic")

    def test_genesis_special_case(self):
        record = {"height": 0, "hash": hexid(1), "prev_hash": hexid(0), "txids": []}
        manifest = freeze_manifest([record], network="testnet", genesis_hash=hexid(1), reference_name="test", reference_version="1", provenance="synthetic")
        self.assertEqual(validate_manifest(manifest), [record])

    def test_invalid_record_fields(self):
        for record in ({"height": 1}, {"height": True, "hash": hexid(1), "prev_hash": hexid(0), "txids": []}):
            with self.assertRaises(BenchmarkError):
                normalize_record(record)

    def test_projection_is_explicit_and_validated(self):
        manifest = fixture()
        self.assertEqual(manifest["projection"], "full_transactions")
        manifest["projection"] = "all-whatever"
        with self.assertRaisesRegex(BenchmarkError, "projection"):
            validate_manifest(manifest)


class VerificationTests(unittest.TestCase):
    def setUp(self):
        self.expected = fixture()["records"]

    def test_missing_record(self):
        result = verify_records(self.expected[:2], self.expected)
        self.assertFalse(result["passed"])
        self.assertEqual(result["missing_heights"], [12])

    def test_duplicate_record(self):
        result = verify_records(self.expected + [self.expected[0]], self.expected)
        self.assertFalse(result["passed"])
        self.assertEqual(result["duplicate_height_count"], 1)

    def test_wrong_hash_and_tx_order(self):
        for field in ("hash", "txids"):
            actual = copy.deepcopy(self.expected)
            actual[0][field] = hexid(999) if field == "hash" else list(reversed(actual[0]["txids"]))
            result = verify_records(actual, self.expected)
            self.assertFalse(result["passed"])
            self.assertIn(field, result["mismatched_fields"])

    def test_unordered_output_is_not_silently_sorted(self):
        self.assertFalse(verify_records(list(reversed(self.expected)), self.expected)["passed"])


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.manifest = fixture()

    def run_adapter(self, adapter, **kwargs):
        return run_benchmark(adapter, self.manifest, candidate=CANDIDATE, **kwargs)

    def test_five_sequential_runs(self):
        adapter = FakeAdapter(self.manifest["records"])
        report = self.run_adapter(adapter)
        self.assertEqual(adapter.calls, 5)
        self.assertEqual([run["status"] for run in report["runs"]], ["PASS"] * 5)
        self.assertTrue(report["summary"]["eligible_for_comparison"])
        self.assertIn("not fresh durable indexing", report["limitations"][0])

    def test_failed_results_have_no_winner_or_headline_median(self):
        report = self.run_adapter(FakeAdapter(self.manifest["records"][:1]))
        self.assertFalse(report["summary"]["eligible_for_comparison"])
        self.assertIsNone(report["summary"]["median_read_normalize_ns"])
        self.assertTrue(all("blocks_per_second" not in row for row in report["runs"]))
        self.assertIn("no overall winner", render_markdown(report))

    def test_single_failed_run_disqualifies_experiment(self):
        class Intermittent(FakeAdapter):
            def read_blocks(self, start, end, deadline):
                self.calls += 1
                yield from self.records[:1] if self.calls == 3 else self.records
        report = self.run_adapter(Intermittent(self.manifest["records"]))
        self.assertEqual(report["summary"]["successful_runs"], 4)
        self.assertIsNone(report["summary"]["median_read_normalize_ns"])

    def test_partial_or_extra_output_fails(self):
        for records in ([], self.manifest["records"][:-1], self.manifest["records"] * 2):
            report = self.run_adapter(FakeAdapter(records), repetitions=1)
            self.assertEqual(report["runs"][0]["status"], "FAIL")

    def test_short_rehearsal_not_comparison_eligible(self):
        report = self.run_adapter(FakeAdapter(self.manifest["records"]), repetitions=1)
        self.assertEqual(report["summary"]["status"], "PASS")
        self.assertFalse(report["summary"]["eligible_for_comparison"])

    def test_compact_projection_report_disclaims_full_completeness(self):
        self.manifest["projection"] = "shielded_compact"
        report = self.run_adapter(FakeAdapter(self.manifest["records"]), repetitions=1)
        self.assertEqual(report["projection"], "shielded_compact")
        self.assertIn("does not prove full transaction completeness", render_markdown(report))

    def test_preflight_failure_prevents_read(self):
        adapter = FakeAdapter(self.manifest["records"])
        self.manifest["genesis_hash"] = hexid(999)
        report = self.run_adapter(adapter)
        self.assertEqual(adapter.calls, 0)
        self.assertEqual(report["preflight"]["status"], "FAIL")
        self.assertTrue(all(row["status"] == "NOT_RUN" for row in report["runs"]))

    def test_timeout_aborts_remaining_runs(self):
        class Stalled(FakeAdapter):
            def read_blocks(self, start, end, deadline):
                self.calls += 1
                time.sleep(0.10)
                yield from self.records
        adapter = Stalled(self.manifest["records"])
        report = self.run_adapter(adapter, run_timeout_s=0.025)
        self.assertEqual(report["runs"][0]["status"], "TIMEOUT")
        self.assertEqual(adapter.calls, 1)
        self.assertTrue(all(row["status"] == "NOT_RUN" for row in report["runs"][1:]))
        self.assertFalse(report["summary"]["eligible_for_comparison"])

    def test_verification_cost_never_in_read_timing(self):
        # Virtual clock makes timing assertion deterministic, not scheduler-dependent.
        ticks = iter([0, 5, 10, 110, 111, 1_000_111])
        report = self.run_adapter(FakeAdapter(self.manifest["records"]), repetitions=1, clock_ns=lambda: next(ticks))
        self.assertEqual(report["runs"][0]["read_normalize_ns"], 100)
        self.assertEqual(report["runs"][0]["verification_ns"], 1_000_000)

    def test_deterministic_serialization_given_fixed_measurements(self):
        def execute():
            ticks = iter(range(100))
            return self.run_adapter(FakeAdapter(self.manifest["records"]), clock_ns=lambda: next(ticks))
        first, second = execute(), execute()
        self.assertEqual(first, second)
        self.assertEqual(render_markdown(first), render_markdown(second))
        with tempfile.TemporaryDirectory() as directory:
            prefix = Path(directory) / "run"
            write_report(first, prefix)
            self.assertEqual(json.loads(prefix.with_suffix(".json").read_text()), first)

    def test_endpoint_and_exception_messages_do_not_leak(self):
        class Broken(FakeAdapter):
            def read_blocks(self, start, end, deadline):
                raise RuntimeError("https://user:password@host.example/api-secret?token=secret")
        report = self.run_adapter(Broken([]))
        encoded = json.dumps(report)
        self.assertNotIn("private-key", encoded)
        self.assertNotIn("password", encoded)
        self.assertNotIn("token=", encoded)
        self.assertEqual(report["candidate"]["endpoint"], "https://host.example:443")


class RpcTests(unittest.TestCase):
    def test_redaction_ipv6_and_credentials(self):
        self.assertEqual(redact_endpoint("https://user:pass@[::1]:9999/token?key=secret"), "https://[::1]:9999")
        self.assertEqual(redact_endpoint("not a url"), "[redacted-endpoint]")
        with self.assertRaises(BenchmarkError):
            JsonRpcAdapter("https://user:pass@example.com")

    def test_rpc_parameters_source_identity_and_mapping(self):
        manifest = fixture()
        calls = []
        adapter = JsonRpcAdapter("http://127.0.0.1:18232")

        def call(method, params, deadline):
            calls.append((method, params))
            if method == "getblockchaininfo":
                return {"chain": "test"}
            if method == "getblockhash":
                return hexid(1) if params == [0] else hexid(params[0])
            self.assertEqual(method, "getblock")
            self.assertEqual(params[1], 1)
            height = int(params[0], 16)
            record = manifest["records"][height - 10]
            return {"height": height, "hash": record["hash"], "previousblockhash": record["prev_hash"], "tx": record["txids"]}

        with patch.object(adapter, "_call", side_effect=call):
            adapter.check_source(manifest, time.monotonic() + 10)
            actual = [normalize_record(row) for row in adapter.read_blocks(10, 12, time.monotonic() + 10)]
        self.assertEqual(actual, manifest["records"])
        self.assertEqual(len(calls), 8)

    def test_rpc_rejects_wrong_block_height(self):
        adapter = JsonRpcAdapter("http://127.0.0.1:18232")
        with patch.object(adapter, "_call", side_effect=[hexid(10), {"height": 11, "hash": hexid(10)}]):
            with self.assertRaisesRegex(BenchmarkError, "identity"):
                list(adapter.read_blocks(10, 10, time.monotonic() + 1))

    def test_rpc_rejects_response_id_mismatch(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, count): return b'{"id":999,"result":"anything"}'
        adapter = JsonRpcAdapter("http://127.0.0.1:18232")
        with patch.object(adapter._opener, "open", return_value=Response()):
            with self.assertRaisesRegex(BenchmarkError, "response_id"):
                adapter._call("getblockhash", [0], time.monotonic() + 1)


if __name__ == "__main__":
    unittest.main()
