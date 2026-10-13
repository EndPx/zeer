"""Small offline checks for public-data capture integrity and exact JSON tokens."""
import hashlib
import struct
import pathlib
import tempfile
import unittest

if __package__:
    from . import modern_capture as capture
else:
    import modern_capture as capture


class CaptureTests(unittest.TestCase):
    def test_predecessor_hash_is_available_but_earlier_history_is_not(self):
        by_height = {1687106: {"decoded": {"hash": "a" * 64, "previousblockhash": "b" * 64}}}
        self.assertEqual(capture.fixture_block_hash(by_height, 1687106), "a" * 64)
        self.assertEqual(capture.fixture_block_hash(by_height, 1687105), "b" * 64)
        with self.assertRaises(KeyError):
            capture.fixture_block_hash(by_height, 1687104)

    def test_existing_proof_output_is_preserved_before_any_network_access(self):
        with tempfile.TemporaryDirectory() as directory:
            output = pathlib.Path(directory) / 'proof.json'
            output.write_text('original evidence', encoding='utf-8')
            with self.assertRaises(FileExistsError):
                capture.verify(pathlib.Path(directory) / 'absent-fixture.json', 'http://unused', output)
            self.assertEqual(output.read_text(encoding='utf-8'), 'original evidence')

    def test_decimal_tokens_survive_rpc_and_projection(self):
        raw = '{"v":1e-6,"n":0.00001000,"int":5,"enabled":true}'
        parsed = capture.parse_json(raw)
        self.assertEqual(capture.exact_json(parsed), raw)
        self.assertEqual(capture.lossless(parsed), {"v": "1e-6", "n": "0.00001000", "int": "5", "enabled": True})

    def test_noncanonical_or_truncated_compact_size_rejected(self):
        for raw in [b'\xfd\x01\x00', b'\xfe\xff\xff\x00\x00', b'\xfd\x01']:
            with self.assertRaises(ValueError):
                capture.compact_size(raw, 0)

    def test_header_extent_excludes_transaction_count_and_bytes(self):
        # Deliberately distinct bytes make reversed hashes and header offsets visible.
        raw = bytearray(range(140)) + b'\x03ABC\x02two-transactions'
        struct.pack_into('<I', raw, 100, 1700000000)
        expected = hashlib.sha256(hashlib.sha256(raw[:144]).digest()).digest()[::-1].hex()
        fields, tx_start = capture.header(raw, 1687106)
        self.assertEqual(fields['hash'], expected)
        self.assertEqual(fields['previousblockhash'], bytes(range(4, 36))[::-1].hex())
        self.assertEqual(fields['time'], 1700000000)
        self.assertEqual(fields['nTx'], 2)
        self.assertEqual(fields['solution'], b'ABC'.hex())
        self.assertEqual(tx_start, 145)


if __name__ == '__main__':
    unittest.main()
