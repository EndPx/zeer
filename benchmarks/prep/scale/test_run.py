import argparse
import json
from pathlib import Path
import tempfile
import unittest

from benchmarks.prep.scale.run import archive_identity, load_oracle, private_subnet, query, sha


class ScaleContractTests(unittest.TestCase):
    def test_explicit_subnet_is_small_canonical_rfc1918_ipv4(self):
        for cidr in ['10.250.64.0/24', '172.31.1.0/28', '192.168.64.0/26']:
            self.assertEqual(private_subnet(cidr), cidr)
        for cidr in ['8.8.8.0/24', '172.32.1.0/24', '10.0.0.0/8', '10.250.64.0/29',
                     '10.250.64.1/24', 'fc00::/24', '10.250.64/24']:
            with self.subTest(cidr=cidr), self.assertRaises(argparse.ArgumentTypeError):
                private_subnet(cidr)

    def test_independent_committed_oracle_keeps_all_transaction_positions(self):
        root = Path(__file__).resolve().parents[2]
        data = load_oracle(root / 'fixtures/mainnet-public-2048/oracle.json.gz', 1, 2048)
        self.assertEqual(len(data['headers']), 2048)
        self.assertEqual(len(data['transactions']), 16962)
        self.assertEqual(data['transactions'][0]['block_height'], 1)
        self.assertEqual(data['transactions'][0]['index'], 0)
        self.assertEqual(sum(row['index'] == 0 for row in data['transactions']), 2048)
        with self.assertRaisesRegex(ValueError, 'ORACLE_RANGE'):
            load_oracle(root / 'fixtures/mainnet-public-2048/oracle.json.gz', 1, 8192)

    def test_final_payload_validation_rejects_same_length_mutation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); folder = root / 'segments/a'; folder.mkdir(parents=True)
            payload = b'independent fixed bytes'
            (folder / 'segment.bin').write_bytes(payload)
            manifest = {'segment_bytes': len(payload), 'segment_sha256': sha(payload)}
            raw = json.dumps(manifest).encode(); (folder / 'manifest.json').write_bytes(raw)
            catalog = {'payload_kind': 'full-v1', 'segments': [{'directory': 'segments/a', 'manifest_sha256': sha(raw), 'start_height': 1, 'end_height': 1}]}
            (root / 'catalog.json').write_text(json.dumps(catalog))
            before = archive_identity(root)
            self.assertEqual(archive_identity(root, verify_payload=True), before)
            (folder / 'segment.bin').write_bytes(b'X' + payload[1:])
            with self.assertRaisesRegex(ValueError, 'SEGMENT_CHECKSUM'):
                archive_identity(root, verify_payload=True)

    def test_query_rejects_epoch_change_between_pages(self):
        meta = {'network': 'mainnet', 'epoch': '1', 'revision': '1', 'archive_height': 2}
        class Endpoint:
            calls = 0
            def request(self, path, body):
                self.calls += 1
                return {**meta, 'epoch': '1' if self.calls == 1 else '2', 'from_block': 1, 'to_block': 3,
                    'next_block': self.calls + 1, 'cursor': 'page2' if self.calls == 1 else None,
                    'data': {'blocks': [{'height': self.calls}], 'transactions': []}}
        with self.assertRaisesRegex(ValueError, 'QUERY_IDENTITY'):
            query(Endpoint(), 1, 2, 'headers', meta)

    def test_two_cursor_pages_preserve_request_bounds_and_monotonic_next_block(self):
        meta = {'network': 'mainnet', 'epoch': '1', 'revision': '1', 'archive_height': 2}
        class Endpoint:
            calls = 0
            def request(self, path, body):
                self.calls += 1
                self_test.assertEqual((body['from_block'], body['to_block']), (1, 3))
                if self.calls == 2: self_test.assertEqual(body['cursor'], 'page2')
                return {**meta, 'from_block': 1, 'to_block': 3, 'next_block': self.calls + 1,
                    'cursor': 'page2' if self.calls == 1 else None,
                    'data': {'blocks': [{'height': self.calls}], 'transactions': []}}
        self_test = self
        self.assertEqual(query(Endpoint(), 1, 2, 'headers', meta), [{'height': 1}, {'height': 2}])

    def test_cursor_pages_reject_changed_bounds_and_nonadvancing_or_overshooting_next_block(self):
        meta = {'network': 'mainnet', 'epoch': '1', 'revision': '1', 'archive_height': 2}
        for change, code in [({'from_block': 2}, 'QUERY_RANGE'), ({'to_block': 4}, 'QUERY_RANGE'),
                             ({'next_block': 1}, 'QUERY_PROGRESS'), ({'next_block': 2}, 'QUERY_PROGRESS'),
                             ({'next_block': 4}, 'QUERY_PROGRESS')]:
            with self.subTest(change=change):
                class Endpoint:
                    calls = 0
                    def request(self, path, body):
                        self.calls += 1
                        return {**meta, 'from_block': 1, 'to_block': 3, 'next_block': self.calls + 1,
                            'cursor': 'page2' if self.calls == 1 else None,
                            'data': {'blocks': [{'height': self.calls}], 'transactions': []},
                            **(change if self.calls == 2 else {})}
                with self.assertRaisesRegex(ValueError, code):
                    query(Endpoint(), 1, 2, 'headers', meta)


if __name__ == '__main__': unittest.main()
