"""Offline synthetic tests; fixtures are not real mainnet evidence."""
import copy
import hashlib
import json
import struct
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace

from benchmarks.transactions.benchmark import (
    DataError, GrpcTransactionAdapter, PostgresTransactionAdapter,
    canonical_sha256, decode_v1, normalize_record, redact_endpoint,
    run_benchmark, validate_manifest, verify_records, write_report,
)


def h(value):
    return f"{value:064x}"


def raw_coinbase(locktime=0):
    # Explicit one-input/one-output v1 envelope; 63 bytes. Script execution and
    # proof of work are not part of this parser test fixture.
    return (b"\x01\x00\x00\x00\x01" + bytes(32) + b"\xff" * 4
            + b"\x02\x01\x01" + b"\xff" * 4 + b"\x01"
            + struct.pack("<Q", 5_000_000_000) + b"\x01\x51"
            + struct.pack("<I", locktime))


def expected_record(index=0):
    raw = raw_coinbase(index)
    # Reference fields are explicit fixture construction facts, not decode_v1.
    return {
        "txid": hashlib.sha256(hashlib.sha256(raw).digest()).digest()[::-1].hex(),
        "mined_height": index + 1, "version": 1, "locktime": index,
        "size_bytes": 63, "transparent_input_count": 1,
        "transparent_output_count": 1, "raw_hex": raw.hex(),
    }


def manifest(count=128):
    records = [expected_record(index) for index in range(count)]
    return {
        "schema_version": 1, "scenario": "transaction-lookup-preoverwinter-v1",
        "network": "mainnet", "genesis_hash": h(9000),
        "end_height": 6764, "end_hash": h(6764), "selection_end_height": 2048,
        "reference_source": {"name": "synthetic-constructor", "version": "1", "provenance": "Offline explicit synthetic construction, not chain evidence"},
        "blocks": [{"height": index + 1, "hash": h(index + 1)} for index in range(count)] + [{"height": 6764, "hash": h(6764)}],
        "records": records, "records_sha256": canonical_sha256(records),
    }


CANDIDATE = {"name": "test", "version": "1", "source_version": "fixture", "endpoint": "postgresql://user:secret@example.com:5432/private?token=secret"}


class FakeAdapter:
    def __init__(self, reference):
        self.records = {record["txid"]: normalize_record(record) for record in reference["records"]}
        self.anchor_calls = 0
        self.lookup_calls = 0

    def preflight(self, reference, deadline):
        self.anchor_calls += 1

    def lookup(self, txid, deadline):
        self.lookup_calls += 1
        return dict(self.records[txid])


class ParserTests(unittest.TestCase):
    def test_coinbase_is_one_input_not_zero(self):
        expected = expected_record()
        self.assertEqual(decode_v1(bytes.fromhex(expected["raw_hex"]), 1), normalize_record(expected))
        self.assertEqual(decode_v1(raw_coinbase(), 1)["transparent_input_count"], 1)

    def test_locktime_and_mined_height(self):
        self.assertEqual(decode_v1(raw_coinbase(42), 9)["locktime"], 42)
        self.assertEqual(decode_v1(raw_coinbase(42), 9)["mined_height"], 9)

    def test_truncated_every_prefix_rejected(self):
        raw = raw_coinbase()
        for end in range(len(raw)):
            with self.subTest(end=end), self.assertRaises(DataError):
                decode_v1(raw[:end], 1)

    def test_trailing_bytes_rejected(self):
        with self.assertRaisesRegex(DataError, "trailing"):
            decode_v1(raw_coinbase() + b"\x00", 1)

    def test_overwinter_and_v2_rejected(self):
        for header in (2, 3, 4, 0x80000001, 0x80000004):
            with self.subTest(header=header), self.assertRaises(DataError):
                decode_v1(struct.pack("<I", header) + raw_coinbase()[4:], 1)

    def test_witness_marker_or_empty_inputs_rejected(self):
        with self.assertRaisesRegex(DataError, "witness_marker"):
            decode_v1(raw_coinbase()[:4] + b"\x00\x01" + raw_coinbase()[5:], 1)

    def test_noncanonical_compact_size(self):
        with self.assertRaisesRegex(DataError, "noncanonical"):
            decode_v1(raw_coinbase()[:4] + b"\xfd\x01\x00" + raw_coinbase()[5:], 1)

    def test_impossible_count(self):
        with self.assertRaisesRegex(DataError, "input_count"):
            decode_v1(raw_coinbase()[:4] + b"\xfc" + raw_coinbase()[5:], 1)

    def test_corrupt_script_length(self):
        raw = bytearray(raw_coinbase())
        raw[41] = 250
        with self.assertRaisesRegex(DataError, "truncated"):
            decode_v1(bytes(raw), 1)


class ManifestTests(unittest.TestCase):
    def test_large_frozen_head_small_selection(self):
        self.assertEqual(len(validate_manifest(manifest())), 128)

    def test_bad_reference_checksum(self):
        value = manifest(2)
        value["records"][0]["locktime"] = 100
        with self.assertRaisesRegex(DataError, "checksum"):
            validate_manifest(value)

    def test_reference_fields_not_generated_by_timed_parser(self):
        value = manifest(1)
        # RPC can be wrong; loading admits a hash-bound oracle, then independent
        # timed decoding detects the mismatch. No self-generated expected count.
        value["records"][0]["locktime"] = 100
        value["records_sha256"] = canonical_sha256(value["records"])
        expected = validate_manifest(value)
        self.assertFalse(verify_records([decode_v1(raw_coinbase(), 1)], expected)["passed"])

    def test_duplicate_reference_txid(self):
        value = manifest(2)
        value["records"][1] = dict(value["records"][0])
        value["records_sha256"] = canonical_sha256(value["records"])
        with self.assertRaisesRegex(DataError, "duplicate_reference"):
            validate_manifest(value)

    def test_missing_block_membership(self):
        value = manifest(2)
        value["blocks"] = [value["blocks"][0], value["blocks"][-1]]
        with self.assertRaisesRegex(DataError, "membership"):
            validate_manifest(value)

    def test_bad_raw_bytes_even_if_manifest_checksum_updated(self):
        value = manifest(1)
        value["records"][0]["raw_hex"] = "00" * 63
        value["records_sha256"] = canonical_sha256(value["records"])
        with self.assertRaisesRegex(DataError, "identity"):
            validate_manifest(value)


class RunnerTests(unittest.TestCase):
    def execute(self, adapter, reference, **kwargs):
        return run_benchmark(adapter, reference, candidate=CANDIDATE, profile="offline-test", **kwargs)

    def test_one_verified_warmup_then_five_full_runs(self):
        reference = manifest()
        adapter = FakeAdapter(reference)
        report = self.execute(adapter, reference)
        self.assertEqual(adapter.lookup_calls, 128 * 6)
        self.assertEqual(adapter.anchor_calls, 2)
        self.assertEqual(report["warmup"]["status"], "PASS")
        self.assertTrue(report["summary"]["eligible_for_comparison"])
        self.assertEqual(len(report["code_identity"]["sha256"]), 64)

    def test_wrong_warmup_data_prevents_timed_runs(self):
        reference = manifest(2)
        adapter = FakeAdapter(reference)
        adapter.records[reference["records"][0]["txid"]]["locktime"] = 42
        report = self.execute(adapter, reference)
        self.assertEqual(report["warmup"]["status"], "FAIL")
        self.assertTrue(all(row["status"] == "NOT_RUN" for row in report["runs"]))
        self.assertFalse(report["summary"]["eligible_for_comparison"])

    def test_single_wrong_timed_run_no_headline_median(self):
        reference = manifest(1)
        class OnceWrong(FakeAdapter):
            def lookup(self, txid, deadline):
                row = super().lookup(txid, deadline)
                if self.lookup_calls == 3:
                    row["locktime"] += 1
                return row
        report = self.execute(OnceWrong(reference), reference)
        self.assertEqual(report["summary"]["successful_runs"], 4)
        self.assertIsNone(report["summary"]["median_lookup_normalize_ns"])

    def test_duplicate_or_unmatched_output(self):
        reference = manifest(2)
        class Duplicate(FakeAdapter):
            def lookup(self, txid, deadline):
                return normalize_record(reference["records"][0])
        report = self.execute(Duplicate(reference), reference)
        self.assertEqual(report["warmup"]["verification"]["duplicate_txids"], 1)
        self.assertFalse(report["summary"]["eligible_for_comparison"])

    def test_missing_lookup_data_error(self):
        reference = manifest(1)
        class Missing(FakeAdapter):
            def lookup(self, txid, deadline):
                return None
        report = self.execute(Missing(reference), reference)
        self.assertEqual(report["warmup"]["error_type"], "DataError")

    def test_changed_head_invalidates_successful_reads(self):
        reference = manifest(2)
        class Reorg(FakeAdapter):
            def preflight(self, reference, deadline):
                super().preflight(reference, deadline)
                if self.anchor_calls == 2:
                    raise DataError("head_changed")
        report = self.execute(Reorg(reference), reference)
        self.assertEqual(report["postflight"]["status"], "FAIL")
        self.assertIsNone(report["summary"]["median_lookup_normalize_ns"])

    def test_timeout_stops_followup_work(self):
        reference = manifest(1)
        class Slow(FakeAdapter):
            def lookup(self, txid, deadline):
                time.sleep(0.1)
                return super().lookup(txid, deadline)
        report = self.execute(Slow(reference), reference, stage_timeout_s=0.03)
        self.assertEqual(report["warmup"]["status"], "TIMEOUT")
        self.assertEqual(report["postflight"]["status"], "NOT_RUN")
        self.assertTrue(all(row["status"] == "NOT_RUN" for row in report["runs"]))

    def test_verification_cost_is_separate(self):
        reference = manifest(1)
        virtual = [0]
        def clock():
            virtual[0] += 100
            return virtual[0]
        def verify(actual, expected):
            virtual[0] += 1_000_000
            return verify_records(actual, expected)
        report = self.execute(FakeAdapter(reference), reference, repetitions=1, clock_ns=clock, verifier=verify)
        self.assertEqual(report["runs"][0]["lookup_normalize_ns"], 100)
        self.assertEqual(report["runs"][0]["verification_ns"], 1_000_100)

    def test_secret_redaction_and_reproducible_output(self):
        reference = manifest(1)
        def run():
            ticks = iter(range(100))
            return self.execute(FakeAdapter(reference), reference, repetitions=1, clock_ns=lambda: next(ticks))
        first, second = run(), run()
        self.assertEqual(first, second)
        encoded = json.dumps(first)
        self.assertNotIn("user:secret", encoded)
        self.assertNotIn("token=secret", encoded)
        with tempfile.TemporaryDirectory() as directory:
            prefix = Path(directory) / "report"
            write_report(first, prefix)
            self.assertEqual(json.loads(prefix.with_suffix(".json").read_text()), first)


class AdapterTests(unittest.TestCase):
    def fake_grpc(self, returned_raw=None):
        adapter = GrpcTransactionAdapter.__new__(GrpcTransactionAdapter)
        adapter.pb = SimpleNamespace(Empty=lambda: None, ChainSpec=lambda: None, TxFilter=lambda **kwargs: kwargs)
        raw = raw_coinbase() if returned_raw is None else returned_raw
        adapter.stub = SimpleNamespace(
            GetLightdInfo=lambda request, timeout: SimpleNamespace(chainName="main"),
            GetLatestBlock=lambda request, timeout: SimpleNamespace(height=6764, hash=bytes.fromhex(h(6764))[::-1]),
            GetTransaction=lambda request, timeout: SimpleNamespace(data=raw, height=1),
        )
        adapter._call = lambda method, request, deadline: method(request, timeout=deadline-time.monotonic())
        return adapter

    def test_grpc_preflight_never_uses_getblock(self):
        adapter = self.fake_grpc()
        # Stub intentionally has no GetBlock method; early mainnet unsupported.
        adapter.preflight(manifest(1), time.monotonic()+1)

    def test_grpc_returned_wrong_raw_txid_rejected(self):
        adapter = self.fake_grpc(raw_coinbase(99))
        with self.assertRaisesRegex(DataError, "wrong_transaction"):
            adapter.lookup(expected_record()["txid"], time.monotonic()+1)

    def test_grpc_correct_raw_and_height(self):
        self.assertEqual(self.fake_grpc().lookup(expected_record()["txid"], time.monotonic()+1), normalize_record(expected_record()))

    def test_postgres_unmatched_and_duplicate_rows(self):
        class Cursor:
            def __init__(self, rows): self.rows = rows
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def execute(self, query, params): pass
            def fetchall(self): return self.rows
        expected = normalize_record(expected_record())
        row = tuple(expected[key] for key in ("txid", "mined_height", "version", "locktime", "size_bytes", "transparent_input_count", "transparent_output_count"))
        for rows in ([], [row, row]):
            adapter = PostgresTransactionAdapter.__new__(PostgresTransactionAdapter)
            adapter.txid_storage = "hex"
            adapter.connection = SimpleNamespace(cursor=lambda: Cursor(rows))
            with self.assertRaisesRegex(DataError, "missing_or_duplicate"):
                adapter.lookup(expected["txid"], time.monotonic()+1)

    def test_endpoint_redaction(self):
        self.assertEqual(redact_endpoint("postgresql://user:pass@localhost:5432/database?token=secret"), "postgresql://localhost:5432")


if __name__ == "__main__":
    unittest.main()
