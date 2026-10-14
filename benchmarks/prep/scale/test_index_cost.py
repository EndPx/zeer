import unittest
from benchmarks.prep.scale.index_cost import check_profile


class IndexCostContractTests(unittest.TestCase):
    def setUp(self):
        self.catalog = {'network': 'mainnet', 'payload_kind': 'full-v1', 'start_height': 1,
            'epoch': 0, 'revision': 2, 'segments': [{'end_height': 2, 'end_hash': 'a'*64}]}
        self.profile = {'network': 'mainnet', 'payload_kind': 'full-v1', 'start_height': 1,
            'head': 2, 'head_hash': 'a'*64, 'epoch': 0, 'revision': 2, 'segments': 1,
            'indexed_blocks': 2, 'fallback_blocks': 0, 'indexed_transactions': 7,
            'transaction_index_allocated_bytes': 1024}

    def test_normal_and_zero_allocations_match_same_checked_identity(self):
        check_profile(self.profile, self.catalog, 'baseline')
        zero = {**self.profile, 'indexed_blocks': 0, 'fallback_blocks': 2,
            'indexed_transactions': 0, 'transaction_index_allocated_bytes': 0,
            'transaction_index_budget_bytes': 64*1024**2}
        # The example's literal reference cap does not establish the variant's allocator budget.
        check_profile(zero, self.catalog, 'zero_index')
        with self.assertRaisesRegex(ValueError, 'ZERO_INDEX_EXPECTATION'):
            check_profile(self.profile, self.catalog, 'zero_index')

    def test_head_epoch_changes_and_partial_fallback_cannot_pass(self):
        for change in [{'head_hash': 'b'*64}, {'epoch': 1}, {'revision': 3}]:
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, 'PROFILE_IDENTITY'):
                check_profile({**self.profile, **change}, self.catalog, 'baseline')
        with self.assertRaisesRegex(ValueError, 'BASELINE_INDEX_EXPECTATION'):
            check_profile({**self.profile, 'indexed_blocks': 1, 'fallback_blocks': 1}, self.catalog, 'baseline')


if __name__ == '__main__': unittest.main()
