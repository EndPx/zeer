import copy
import gzip
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from benchmarks.prep.scale.capture import GENESIS, capture, project_block


class FrozenNode:
    def __init__(self, changed_pin=False):
        self.methods = []; self.pins = 0; self.changed_pin = changed_pin

    def rpc(self, method, params):
        self.methods.append(method)
        if method == 'getblockchaininfo':
            self.pins += 1
            return {'chain': 'main', 'blocks': 2, 'bestblockhash': ('e' if self.changed_pin and self.pins > 1 else '2')*64}
        if method == 'getblockhash': return GENESIS if params[0] == 0 else str(params[0])*64
        if method == 'getblock':
            height = int(params[0][0])
            return block(height)
        raise AssertionError('Unexpected RPC method')


def block(height):
    return {'height': height, 'hash': str(height)*64, 'previousblockhash': GENESIS if height == 1 else '1'*64,
        'time': 1477671595 + height, 'tx': [{'txid': txid*64, 'hex': '0102', 'size': 2,
            'version': 2, 'locktime': 4294967295, 'vin': [{}], 'vout': [{}, {}]}
            for txid in (['b', 'a'] if height == 1 else ['c'])]}


class CaptureContractTests(unittest.TestCase):
    def test_frozen_capture_publishes_complete_gzip_and_retains_canonical_node_order(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp)/'oracle.json.gz'; node = FrozenNode()
            record = capture(node, 2, '2'*64, 2, out)
            oracle = json.loads(gzip.decompress(out.read_bytes()))
            self.assertEqual(record['status'], 'PASS')
            self.assertEqual(record['transactions'], 3)
            self.assertEqual(oracle['range'], {'from': 1, 'to': 2})
            self.assertEqual([row['id'] for row in oracle['transactions']], ['b'*64, 'a'*64, 'c'*64])
            self.assertEqual(oracle['transactions'][0]['locktime'], '4294967295')
            self.assertEqual(oracle['transactions'][0]['sizeBytes'], 2)
            self.assertEqual(set(node.methods), {'getblockchaininfo', 'getblockhash', 'getblock'})

    def test_pin_change_and_row_cap_leave_no_published_oracle(self):
        for changed, cap, code in [(True, 500000, 'SOURCE_PIN_CHANGED'), (False, 1, 'TRANSACTION_ROW_CAP')]:
            with self.subTest(code=code), tempfile.TemporaryDirectory() as temp:
                out = Path(temp)/'oracle.json.gz'
                with patch('benchmarks.prep.scale.capture.MAX_ROWS', cap), self.assertRaisesRegex(ValueError, code):
                    capture(FrozenNode(changed), 2, '2'*64, 2, out)
                self.assertFalse(out.exists())
                records = list(Path(temp).glob('*.staging-*/capture.json'))
                self.assertEqual(len(records), 1)
                self.assertEqual(json.loads(records[0].read_text())['status'], 'FAIL')

    def test_existing_output_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp)/'oracle.json.gz'; out.write_bytes(b'preserved')
            with self.assertRaisesRegex(ValueError, 'NEW_GZIP_OUTPUT_REQUIRED'):
                capture(FrozenNode(), 2, '2'*64, 2, out)
            self.assertEqual(out.read_bytes(), b'preserved')

    def test_exact_metadata_rejects_boolean_float_overflow_and_raw_size_mismatch(self):
        for change in [{'version': True}, {'locktime': 1.5}, {'locktime': 4294967296},
                       {'hex': '012'}, {'hex': 'xx'}, {'size': 3}, {'vin': [1]}]:
            candidate = copy.deepcopy(block(1)); candidate['tx'][0].update(change)
            with self.subTest(change=change), self.assertRaises(ValueError):
                project_block(candidate, 1, '1'*64, GENESIS)


if __name__ == '__main__': unittest.main()
