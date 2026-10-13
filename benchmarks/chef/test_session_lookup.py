"""Synthetic scheduling/admission checks; these are not provider measurements."""
import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from benchmarks.chef.session_lookup import await_readiness, ReadinessFailure, main
from benchmarks.transactions.benchmark import DataError, DeadlineError

MANIFEST_PATH = Path(__file__).resolve().parents[1] / 'fixtures/mainnet-transactions-v1/manifest.json'
MANIFEST = json.loads(MANIFEST_PATH.read_text())


class Adapter:
    def __init__(self, error=None):
        self.error, self.closed, self.reads = error, False, []
    def preflight(self, manifest, deadline):
        if self.error:
            raise self.error
    def close(self):
        self.closed = True
    def lookup(self, txid, deadline):
        self.reads.append(txid)
        return next(row for row in MANIFEST['records'] if row['txid'] == txid)


class SessionTests(unittest.TestCase):
    def test_transient_readiness_retries_with_closed_old_adapter(self):
        failed, ready = Adapter(DataError('grpc_request_failed')), Adapter()
        adapters = iter([failed, ready])
        result, observations = await_readiness(lambda: next(adapters), MANIFEST, pause=lambda _: None)
        self.assertIs(result, ready)
        self.assertTrue(failed.closed)
        self.assertEqual([row['status'] for row in observations['attempts']], ['FAIL', 'PASS'])

    def test_wrong_anchor_is_terminal(self):
        adapter = Adapter(DataError('source_frozen_head_mismatch'))
        with self.assertRaises(ReadinessFailure) as failure:
            await_readiness(lambda: adapter, MANIFEST, pause=lambda _: self.fail('must not retry'))
        self.assertEqual(len(failure.exception.observations['attempts']), 1)
        self.assertTrue(adapter.closed)

    def test_timeout_is_terminal_to_avoid_overlapping_worker(self):
        adapter = Adapter(DeadlineError('stage_timeout'))
        with self.assertRaises(ReadinessFailure) as failure:
            await_readiness(lambda: adapter, MANIFEST, pause=lambda _: self.fail('must not retry'))
        self.assertEqual(failure.exception.observations['attempts'][0]['status'], 'TIMEOUT')

    def test_one_visit_has_exactly_warmup_plus_one_128_read_and_no_dsn(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / 'visit'
            adapter = Adapter()
            with patch.dict(os.environ, ZEER_TX_ENDPOINT='postgres://user:super-secret@127.0.0.1:39460/db'), \
                    patch('benchmarks.chef.session_lookup.adapter_factory', return_value=lambda: adapter), \
                    contextlib.redirect_stdout(io.StringIO()):
                result = main(['--candidate', 'cipherscan', '--manifest', str(MANIFEST_PATH), '--out', str(out), '--round', '2', '--version', 'test-only', '--readiness-seconds', '180'])
            report_text = out.with_suffix('.json').read_text()
            report = json.loads(report_text)
            self.assertEqual(result, 0)
            self.assertEqual(len(adapter.reads), 256)
            self.assertEqual(report['summary']['status'], 'PASS')
            self.assertFalse(report['summary']['eligible_for_comparison'])
            self.assertFalse(report['session_visit']['eligible_for_comparison'])
            self.assertEqual(report['repetitions'], 1)
            self.assertEqual(len(report['runs']), 1)
            self.assertEqual(report['session_visit']['round'], 2)
            self.assertEqual(report['readiness']['budget_seconds'], 180)
            self.assertNotIn('super-secret', report_text)
            self.assertTrue(adapter.closed)
            # Repeated output path is rejected and the original evidence stays identical.
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(main(['--candidate', 'cipherscan', '--manifest', str(MANIFEST_PATH), '--out', str(out), '--round', '2', '--version', 'test-only']), 2)
            self.assertEqual(out.with_suffix('.json').read_text(), report_text)


if __name__ == '__main__':
    unittest.main()
