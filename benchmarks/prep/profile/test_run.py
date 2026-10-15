import copy
import unittest
from benchmarks.prep.profile.run import CAP, SEGMENT_CAP, check, check_fixture


class ProfileContracts(unittest.TestCase):
    def setUp(self):
        self.catalog = {'catalog_sha256': 'a' * 64, 'segments': [
            {'directory': 'segments/a', 'start_height': 1, 'end_height': 2, 'end_hash': 'b' * 64}]}
        self.profile = {'format': 'prep-admission-phases-v1', 'catalog_sha256': 'a' * 64,
                        'head': 2, 'head_hash': 'b' * 64, 'transaction_index_allocated_bytes': 1024,
                        'indexed_blocks': 2, 'fallback_blocks': 0,
                        'profile': {'archive_budget_bytes': CAP, 'segment_budget_bytes': SEGMENT_CAP,
                                    'admission_ns': 100, 'phases': {'io': {'ns': 50, 'calls': 2}},
                                    'segments': [{'directory': 'segments/a', 'start_height': 1,
                                                  'end_height': 2, 'available_archive_bytes': CAP,
                                                  'allocated_index_bytes': 1024}]}}

    def test_default_and_zero_budget_contract(self):
        check(self.profile, self.catalog, None)
        profile = copy.deepcopy(self.profile)
        profile.update(transaction_index_allocated_bytes=0, indexed_blocks=0, fallback_blocks=2)
        profile['profile']['archive_budget_bytes'] = 0
        profile['profile']['segments'][0].update(available_archive_bytes=0, allocated_index_bytes=0)
        check(profile, self.catalog, 0)

    def test_identity_caps_and_disjoint_timing_fail_closed(self):
        for edit, error in [
            (lambda p: p.update(catalog_sha256='c' * 64), 'CATALOG_IDENTITY'),
            (lambda p: p['profile']['segments'][0].update(allocated_index_bytes=CAP), 'CAP_EXCEEDED'),
            (lambda p: p['profile']['segments'][0].update(available_archive_bytes=123), 'REMAINING_BUDGET'),
            (lambda p: p['profile']['phases']['io'].update(ns=101), 'PHASE_OVERLAP'),
            (lambda p: p.update(fallback_blocks=1), 'RETAINED_INDEX_ACCOUNTING'),
        ]:
            profile = copy.deepcopy(self.profile)
            edit(profile)
            with self.subTest(error=error), self.assertRaisesRegex(ValueError, error):
                check(profile, self.catalog, None)

    def test_archive_cap_requires_four_indexes_then_fallback(self):
        profile = copy.deepcopy(self.profile)
        profile.update(segment_transaction_counts=[220_000] * 5, transactions=1_100_000)
        profile['profile'].update(native_metadata_row_bytes=72, native_secondary_entry_bytes=4,
                                  native_offset_bytes=8, native_index_fixed_bytes=96)
        profile['profile']['segments'] = [{'allocated_index_bytes': 16_720_112,
                                          'available_archive_bytes': CAP - i * 16_720_112,
                                          'start_height': i + 1, 'end_height': i + 1}
                                         for i in range(5)]
        profile['profile']['segments'][4]['allocated_index_bytes'] = 0
        check_fixture(profile, 'archive-cap')
        profile['profile']['segments'][3]['allocated_index_bytes'] = 0
        with self.assertRaisesRegex(ValueError, 'DEFAULT_ARCHIVE_CAP_NOT_OBSERVED'):
            check_fixture(profile, 'archive-cap')

    def test_segment_cap_requires_sufficient_archive_remainder(self):
        profile = copy.deepcopy(self.profile)
        profile.update(segment_transaction_counts=[220_000, 221_000], transactions=441_000)
        profile['profile'].update(native_metadata_row_bytes=72, native_secondary_entry_bytes=4,
                                  native_offset_bytes=8, native_index_fixed_bytes=96)
        profile['profile']['segments'] = [
            {'allocated_index_bytes': 16_720_112, 'available_archive_bytes': CAP, 'start_height': 1, 'end_height': 1},
            {'allocated_index_bytes': 0, 'available_archive_bytes': CAP - 16_720_112, 'start_height': 2, 'end_height': 2}]
        check_fixture(profile, 'segment-cap')
        for edit, expected_error in [
            (lambda p: p.update(segment_transaction_counts=[220_000, 1]), 'SYNTHETIC_ROW_COUNTS'),
            (lambda p: p.update(transactions=1), 'SYNTHETIC_ROW_COUNTS'),
            (lambda p: p['profile'].update(native_metadata_row_bytes=64), 'SYNTHETIC_X86_64_LAYOUT'),
            (lambda p: p['profile']['segments'][1].update(end_height=3), 'SYNTHETIC_ONE_BLOCK_SEGMENTS'),
        ]:
            changed = copy.deepcopy(profile)
            edit(changed)
            with self.subTest(expected_error=expected_error), self.assertRaisesRegex(ValueError, expected_error):
                check_fixture(changed, 'segment-cap')
        profile['profile']['segments'][1]['available_archive_bytes'] = 1
        with self.assertRaisesRegex(ValueError, 'ARCHIVE_BUDGET_CONFOUNDS_SEGMENT_CAP'):
            check_fixture(profile, 'segment-cap')


if __name__ == '__main__':
    unittest.main()
