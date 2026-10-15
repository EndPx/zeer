import gzip
import json
from pathlib import Path
import tempfile
import unittest

from benchmarks.prep.profile.make_cases import canonical_bytes, make_cases, publish, sha
from benchmarks.prep.scale.run import FIELDS


def fixture(root):
    archive = root / 'archive'
    archive.mkdir()
    ref = {'directory': 'segments/a', 'dataset_id': 'a' * 64, 'start_height': 1,
           'end_height': 384, 'predecessor_hash': 'b' * 64, 'end_hash': f'{384:064x}',
           'manifest_sha256': 'c' * 64}
    catalog = {'schema_version': 1, 'network': 'mainnet', 'payload_kind': 'full-v1',
               'start_height': 1, 'epoch': 0, 'revision': 1, 'segments': [ref]}
    catalog['catalog_sha256'] = sha(canonical_bytes(['zeer-prep-catalog-v1', 1, 'mainnet',
        'full-v1', 1, 0, 1, [ref]]))
    (archive / 'catalog.json').write_text(json.dumps(catalog))
    blocks = [{'id': str(height), 'hash': f'{height:064x}', 'time': str(height),
               'transactionCount': 2} for height in range(1, 385)]
    transactions = [{'id': f'{10000 - 2 * height - position:064x}', 'minedHeight': height,
                     'version': 1, 'locktime': '4294967295', 'sizeBytes': 129,
                     'transparentInputCount': 1, 'transparentOutputCount': 2}
                    for height in range(1, 385) for position in range(2)]
    # Later captured source height is valid; frozen oracle range still ends at 384.
    oracle = {'range': {'from': 1, 'to': 384}, 'source': {'height': 999, 'hash': 'd' * 64},
              'blocks': blocks, 'transactions': transactions}
    path = root / 'oracle.json.gz'
    path.write_bytes(gzip.compress(canonical_bytes(oracle), mtime=0))
    return archive, path, oracle


class MakeCaseTests(unittest.TestCase):
    def test_six_cases_preserve_source_positions_numeric_metadata_and_exclusive_output(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            archive, oracle_path, _ = fixture(root)
            output = make_cases(archive, oracle_path)
            self.assertEqual(output['format'], 'prep-admission-query-cases-v1')
            self.assertEqual(output['oracle_sha256'], sha(oracle_path.read_bytes()))
            self.assertEqual(type(output['archive']['epoch']), int)
            self.assertEqual(type(output['archive']['revision']), int)
            self.assertEqual([case['request']['from_block'] for case in output['cases']],
                             [1, 1, 193, 193, 257, 257])
            for case in output['cases']:
                self.assertEqual(case['request']['to_block'] - case['request']['from_block'], 128)
                self.assertEqual(case['request']['field_selection']['transaction'], FIELDS)
                rows = case['expected']['transactions']
                self.assertTrue(rows)
                self.assertEqual(type(rows[0]['locktime']), int)
                if case['name'].endswith('_metadata'):
                    self.assertEqual(len(rows), 256)
                    self.assertEqual([row['index'] for row in rows[:4]], [0, 1, 0, 1])
                    self.assertGreater(rows[0]['txid'], rows[1]['txid'])
                else:
                    self.assertEqual(len(rows), 1)
                    self.assertEqual(rows[0]['block_height'], case['request']['from_block'] + 64)
            results = root / 'results'
            out = results / 'cases.json'
            evidence = publish(output, out, results, archive, oracle_path)
            original = out.read_bytes()
            self.assertEqual(evidence['cases_sha256'], sha(original))
            with self.assertRaises(FileExistsError):
                publish(output, out, results, archive, oracle_path)
            self.assertEqual(out.read_bytes(), original)
            with self.assertRaisesRegex(ValueError, 'OUTPUT_MUST_BE_IGNORED_RESULTS'):
                publish(output, root / 'outside.json', results, archive, oracle_path)
            with self.assertRaisesRegex(ValueError, 'OUTPUT_MUST_NOT_CHANGE_INPUTS'):
                publish(output, archive / 'cases.json', root, archive, oracle_path)

    def test_rejects_mismatched_range_head_source_order_and_catalog_identity(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            archive, oracle_path, original = fixture(root)
            for mutation, error in [
                (lambda o: o['range'].update(to=383), 'ORACLE_RANGE'),
                (lambda o: o['blocks'][-1].update(hash='f' * 64), 'ORACLE_HEAD_HASH'),
                (lambda o: o['transactions'].reverse(), 'ORACLE_TRANSACTION_ORDER'),
                (lambda o: o['source'].update(height=383), 'ORACLE_SOURCE_HEIGHT'),
            ]:
                oracle = json.loads(json.dumps(original))
                mutation(oracle)
                oracle_path.write_bytes(gzip.compress(canonical_bytes(oracle), mtime=0))
                with self.subTest(error=error), self.assertRaisesRegex(ValueError, error):
                    make_cases(archive, oracle_path)
            oracle_path.write_bytes(gzip.compress(canonical_bytes(original), mtime=0))
            catalog_path = archive / 'catalog.json'
            catalog = json.loads(catalog_path.read_text())
            catalog['revision'] = 2
            catalog_path.write_text(json.dumps(catalog))
            with self.assertRaisesRegex(ValueError, 'CATALOG_CHECKSUM'):
                make_cases(archive, oracle_path)


if __name__ == '__main__':
    unittest.main()
