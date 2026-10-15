import unittest
from benchmarks.load.run import Verifier, cases, classify, quantiles, run_level, release_writer
from pathlib import Path
from unittest.mock import patch
import json
import os
import tempfile


def fixture():
    return {'headers': [{'height': 1, 'hash': 'a' * 64, 'time': 1}, {'height': 2, 'hash': 'b' * 64, 'time': 2}],
        'transactions': [{'txid': 'c' * 64, 'block_height': 1, 'index': 0, 'version': 1, 'locktime': 0,
            'size_bytes': 100, 'transparent_input_count': 1, 'transparent_output_count': 2},
            {'txid': 'd' * 64, 'block_height': 2, 'index': 0, 'version': 1, 'locktime': 0,
            'size_bytes': 101, 'transparent_input_count': 1, 'transparent_output_count': 2}]}


class LoadTests(unittest.TestCase):
    def test_exclusive_output_race_preserves_other_owner_and_equal_lock_is_rejected(self):
        from benchmarks.load.run import main
        results = Path(__file__).resolve().parents[1] / 'results'
        results.mkdir(exist_ok=True)
        oracle = Path(__file__).resolve().parents[1] / 'fixtures/mainnet-public-2048/oracle.json.gz'
        with tempfile.TemporaryDirectory(dir=results) as temp:
            output = Path(temp) / 'report.json'; lock = Path(temp) / 'load.lock'
            args = ['load', '--profile', 'prep', '--endpoint', 'http://127.0.0.1:39368', '--token-env', 'LOAD_TEST_TOKEN',
                '--oracle', str(oracle), '--out', str(output), '--exclusive-lock', str(lock)]
            original_open = Path.open
            def competing_open(path, mode='r', *positional, **keywords):
                if path == output and mode == 'x':
                    with original_open(path, 'w') as stream: stream.write('other-owner-evidence')
                    raise FileExistsError('competing_output')
                return original_open(path, mode, *positional, **keywords)
            with patch.dict(os.environ, {'LOAD_TEST_TOKEN': 'test-only-token'}), patch('sys.argv', args), patch.object(Path, 'open', competing_open):
                with self.assertRaises(FileExistsError): main()
            self.assertEqual(output.read_text(), 'other-owner-evidence')
            output.unlink()
            args[-1] = str(output)
            with patch.dict(os.environ, {'LOAD_TEST_TOKEN': 'test-only-token'}), patch('sys.argv', args):
                with self.assertRaisesRegex(ValueError, 'LOCK_AND_OUTPUT_MUST_DIFFER'): main()
            self.assertFalse(output.exists())

    def test_snapshot_and_range_numbers_reject_boolean_and_float_encodings(self):
        oracle = fixture(); chef_anchor = {'height': 1, 'hash': 'a' * 64, 'status': 'ready'}
        chef = Verifier('chef', oracle, chef_anchor, 1); chef_case = cases('chef', oracle, 1)[0]
        prep_anchor = {'network': 'mainnet', 'epoch': '1', 'revision': '3', 'archive_height': 1}
        prep = Verifier('prep', oracle, prep_anchor); prep_case = cases('prep', oracle, 1)[0]
        for invalid in [True, 1.0]:
            with self.assertRaisesRegex(ValueError, 'CHECKPOINT_HEIGHT_MUST_BE_INTEGER'):
                chef.verify(chef_case, {'data': {'_meta': {**chef_anchor, 'height': invalid}}})
            body = {**prep_anchor, 'from_block': 1, 'to_block': 2, 'next_block': 2, 'cursor': None}
            with self.assertRaisesRegex(ValueError, 'PREP_HEIGHT_MUST_BE_INTEGER'):
                prep.verify(prep_case, {**body, 'archive_height': invalid})
            for key in ['from_block', 'to_block', 'next_block']:
                with self.assertRaisesRegex(ValueError, 'PREP_RANGE_MUST_BE_INTEGER'):
                    prep.verify(prep_case, {**body, key: invalid})

    def test_writer_release_is_complete_exclusive_and_inside_ignored_results(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'results'
            path = root / 'active' / 'start.json'
            report = root / 'active' / 'client.json'
            value = release_writer(path, root, report)
            self.assertEqual(json.loads(path.read_text()), value)
            self.assertIsInstance(value['unix_ns'], str)
            with self.assertRaises(FileExistsError):
                release_writer(path, root, report)
            self.assertEqual(json.loads(path.read_text()), value)
            with self.assertRaisesRegex(ValueError, 'START_SIGNAL_MUST_BE_NEW_IGNORED_RESULTS_FILE'):
                release_writer(Path(temp) / 'outside.json', root, report)
            self.assertEqual(list(path.parent.glob('.load-signal-*')), [])

    def test_quantile_small_sample_is_observed_max_and_empty_is_null(self):
        self.assertEqual(quantiles([1, 4, 2, 3]), {'n': 4, 'p50': 2, 'p95': 4, 'p99': 4,
            'p99_tail_samples': 0, 'p99_interpretation': 'descriptive observed order statistic; not a tail guarantee'})
        self.assertIsNone(quantiles([])['p99'])

    def test_capacity_and_readiness_are_distinct(self):
        self.assertEqual(classify(429, {'error': {'code': 'QUERY_CAPACITY_EXCEEDED'}}), 'capacity_429')
        self.assertEqual(classify(503, {'errors': [{'message': 'Query capacity reached'}]}), 'capacity_503')
        self.assertEqual(classify(503, {'errors': [{'message': 'Indexer is not ready'}]}), 'unready_503')
        self.assertEqual(classify(503, {'error': {'code': 'SOURCE_NOT_READY'}}), 'unready_503')
        self.assertEqual(classify(503, {'error': {'code': 'ARCHIVE_READ_FAILED'}}), 'unexpected_http_503')

    def test_prep_rows_and_snapshot_are_exact(self):
        oracle = fixture(); anchor = {'network': 'mainnet', 'epoch': '1', 'revision': '3', 'archive_height': 2}
        verifier = Verifier('prep', oracle, anchor); case = cases('prep', oracle, 2)[0]
        body = {**anchor, 'from_block': 1, 'to_block': 2, 'next_block': 2, 'cursor': None,
            'data': {'blocks': [], 'transactions': [{'txid': 'c' * 64, 'block_height': 1}]}}
        self.assertEqual(verifier.verify(case, body)['row_count'], 1)
        body['data']['transactions'][0]['block_height'] = True
        with self.assertRaisesRegex(ValueError, 'EXACT_ORACLE_ROWS'):
            verifier.verify(case, body)
        body['archive_height'] = 1
        with self.assertRaisesRegex(ValueError, 'PREP_SNAPSHOT_CHANGED'):
            verifier.verify(case, body)

    def test_chef_active_prefix_hides_future_rows_and_checks_hash(self):
        oracle = fixture(); anchor = {'height': 1, 'hash': 'a' * 64, 'status': 'ready'}
        verifier = Verifier('chef', oracle, anchor, 1); case = cases('chef', oracle, 1)[1]
        body = {'data': {'_meta': anchor, 'PublicTransactionList': {
            'items': [{'id': 'c' * 64, 'minedHeight': 1}], 'nextCursor': None}}}
        self.assertEqual(verifier.verify(case, body)['row_count'], 1)
        body['data']['PublicTransactionList']['items'].append({'id': 'd' * 64, 'minedHeight': 2})
        with self.assertRaisesRegex(ValueError, 'EXACT_ORACLE_ROWS_OR_CURSOR'):
            verifier.verify(case, body)
        body['data']['_meta'] = {'height': 2, 'hash': 'b' * 64, 'status': 'ready'}
        self.assertEqual(verifier.verify(case, body)['row_count'], 2)
        body['data']['_meta']['hash'] = 'f' * 64
        with self.assertRaisesRegex(ValueError, 'CHECKPOINT_HASH_OR_STATUS'):
            verifier.verify(case, body)

    def test_expected_cache_reuses_values_and_bounds_retained_entries(self):
        verifier = Verifier('prep', fixture(), {})
        calls = []
        def build():
            calls.append(1)
            return {'items': [1, 2]}
        first = verifier.cached_expected(('fixed', 1), build)
        self.assertIs(first, verifier.cached_expected(('fixed', 1), build))
        self.assertEqual(len(calls), 1)
        for height in range(100):
            verifier.cached_expected(('active', height), build)
        self.assertEqual(len(verifier.expected_cache), 64)

    def test_active_prep_rejects_same_revision_with_different_head(self):
        oracle = fixture(); anchor = {'network': 'mainnet', 'epoch': '1', 'revision': '3', 'archive_height': 1}
        verifier = Verifier('prep', oracle, anchor, 1); case = cases('prep', oracle, 1)[0]
        body = {**anchor, 'archive_height': 2, 'from_block': 1, 'to_block': 2, 'next_block': 2, 'cursor': None,
            'data': {'blocks': [], 'transactions': [{'txid': 'c' * 64, 'block_height': 1}]}}
        with self.assertRaisesRegex(ValueError, 'PREP_REVISION_HEIGHT_INCONSISTENCY'):
            verifier.verify(case, body)
        body['revision'] = '4'
        self.assertEqual(verifier.verify(case, body)['checkpoint']['archive_height'], 2)

    def test_closed_loop_records_each_rejection_without_retry(self):
        class RejectingHttp:
            def request(self, path, body):
                return 503, {'errors': [{'message': 'Query capacity reached'}]}, {'elapsed_ns': 1000, 'bytes': 50}
        class NoSuccessfulVerification:
            def verify(self, case, body):
                raise AssertionError('Should never verify rejected responses')
        import time
        level = run_level(RejectingHttp(), NoSuccessfulVerification(), [{'name': 'test', 'path': '/graphql', 'body': {}}],
            8, 4, time.monotonic() + 10)
        self.assertEqual(len(level['samples']), 32)
        self.assertEqual(level['summary']['outcomes'], {'capacity_503': 32})
        self.assertEqual(level['summary']['verified_200_latency_ns']['n'], 0)

    def test_think_pause_applies_to_success_and_rejection_outside_http_timer(self):
        import time
        class MixedHttp:
            calls = 0
            def request(self, path, body):
                self.calls += 1
                return (200, {}, {'elapsed_ns': 1234, 'bytes': 10}) if self.calls % 2 else (
                    503, {'errors': [{'message': 'Query capacity reached'}]}, {'elapsed_ns': 4321, 'bytes': 50})
        class Validating:
            def verify(self, case, body): return {}
        http = MixedHttp()
        workloads = [{'name': 'test', 'path': '/graphql', 'body': {}}]
        with patch('benchmarks.load.run.time.sleep') as pause:
            level = run_level(http, Validating(), workloads, 1, 4, time.monotonic() + 10, think_ms=5)
        self.assertEqual([call.args for call in pause.call_args_list], [(0.005,)] * 4)
        self.assertEqual(http.calls, 4)
        self.assertEqual(level['summary']['outcomes'], {'verified_200': 2, 'capacity_503': 2})
        self.assertEqual([sample['elapsed_ns'] for sample in level['samples']], [1234, 4321, 1234, 4321])
        with patch('benchmarks.load.run.time.sleep') as pause:
            run_level(http, Validating(), workloads, 1, 4, time.monotonic() + 10)
        pause.assert_not_called()


if __name__ == '__main__':
    unittest.main()
