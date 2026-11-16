import copy
import datetime
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
import zeer_capacity_monitor as monitor
from zeer_capacity_monitor import GIB, regular_bytes, save, warnings


class CapacityTests(unittest.TestCase):
    def setUp(self):
        self.plan = {'allocation': {'minimumPhysicalFreeGiBUnchanged': 25, 'aggregateStopGiB': 83, 'prepArchiveGiB': 40},
                     'forecastDays': 30, 'forecastGrowthBytes': {'total': 20 * GIB, 'archive': 12 * GIB},
                     'current': {'atUnix': 1_800_000_000}}
        self.sample = {'atUnix': 1_800_000_100, 'physicalFreeBytes': 50 * GIB, 'aggregateBytes': 60 * GIB,
                       'archiveBytes': 24 * GIB, 'availableMemoryBytes': 5 * GIB, 'nodeRssBytes': 5 * GIB,
                       'nodeRunning': True, 'nodeOomKilled': False, 'writerState': 'active', 'writerReady': True,
                       'followerRunning': True, 'guardAgeSeconds': 15, 'halted': False,
                       'writerObservationAgeSeconds': 12}

    def test_healthy_envelope_does_not_claim_source_readiness(self):
        self.assertEqual(warnings(self.sample, self.plan), [])
        self.assertNotIn('ready', self.sample)

    def test_warning_precedes_hard_archive_boundary(self):
        self.sample['archiveBytes'] = 36 * GIB
        self.assertIn('archive_storage_below_14_days_at_planned_growth', warnings(self.sample, self.plan))
        self.sample['archiveBytes'] = 40 * GIB - 256 * 1024**2
        self.assertIn('archive_storage_at_safety_boundary', warnings(self.sample, self.plan))

    def test_unknown_stale_and_oom_are_not_healthy(self):
        self.sample.update(archiveBytes=None, aggregateBytes=None, guardAgeSeconds=601,
                           writerObservationAgeSeconds=None, nodeRunning=False, nodeOomKilled=True)
        found = warnings(self.sample, self.plan)
        for code in ['archive_storage_unknown', 'aggregate_storage_unknown', 'resource_guard_observation_unknown_or_stale',
                     'writer_source_observation_unknown_or_stale', 'source_node_not_running', 'source_node_oom_recorded']:
            self.assertIn(code, found)

    def test_plan_expiry_and_memory_warning(self):
        self.sample.update(atUnix=1_800_000_000 + 31 * 86400, nodeRssBytes=6 * GIB, availableMemoryBytes=3 * GIB)
        found = warnings(self.sample, self.plan)
        self.assertIn('capacity_plan_horizon_elapsed_recalculate', found)
        self.assertIn('host_memory_below_4GiB_warning', found)
        self.assertIn('node_memory_at_or_above_6GiB_warning', found)

    def test_recent_error_status_does_not_establish_source_readiness(self):
        self.sample.update(writerReady=False, writerObservationAgeSeconds=None)
        found = warnings(self.sample, self.plan)
        self.assertIn('archive_writer_not_ready', found)
        self.assertIn('writer_source_observation_unknown_or_stale', found)

    def test_diagnostics_never_rewrite_original_source_clock(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / 'source-status.json'
            source.write_text('{"updated_at_unix": 100, "ready": false}')
            original = source.read_bytes()
            archive = root / 'archive'
            archive.mkdir()
            (archive / 'payload').write_bytes(b'abc')
            self.assertEqual(regular_bytes(archive), 3)
            sample = copy.deepcopy(self.sample)
            sample['writerSourceObservedAt'] = 100
            save(root / 'diagnostics', sample)
            self.assertEqual(source.read_bytes(), original)
            self.assertTrue((root / 'diagnostics/capacity-status.json').exists())

    def test_source_observation_is_read_after_slow_archive_measurement(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            status = root / 'storage-v3-20261018/archives/full/status.json'
            status.parent.mkdir(parents=True)
            status.write_text('{"ready": false, "updated_at_unix": 1}')
            guard = root / 'guard-status.json'
            guard.write_text('{}')

            def archive_measurement(_):
                # Model the real writer publishing while archive I/O was in progress.
                status.write_text(json.dumps({'ready': True, 'updated_at_unix': int(time.time()), 'indexed_height': 222}))
                guard.write_text(json.dumps({'checked_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'zeer_bytes': 60 * GIB}))
                return 24 * GIB

            original_read = Path.read_text
            def read(path, *args, **kwargs):
                if str(path).replace('\\', '/') == '/proc/meminfo':
                    return 'MemAvailable: 8388608 kB\n'
                return original_read(path, *args, **kwargs)

            def command(args):
                if args[0] == 'systemctl':
                    return 'active'
                if args[3] == '{{.RestartCount}}':
                    return '0'
                return '{"Running": false, "OOMKilled": false}'

            with patch.object(monitor, 'ROOT', root), patch.object(monitor, 'regular_bytes', archive_measurement), \
                    patch.object(monitor, 'command', command), patch.object(Path, 'read_text', read):
                result = monitor.collect()
            self.assertTrue(result['writerReady'])
            self.assertEqual(result['writerIndexedHeight'], 222)
            self.assertLess(result['writerObservationAgeSeconds'], 5)

    def test_rotation_is_bounded_and_preserves_unrelated_files(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'capacity-history.jsonl').write_bytes(b'A' * (4 * 1024**2))
            (root / 'capacity-history.1.jsonl').write_bytes(b'previous')
            (root / 'capacity-history.2.jsonl').write_bytes(b'oldest')
            sentinel = root / 'keep.data'
            sentinel.write_bytes(b'untouched')
            save(root, self.sample)
            self.assertEqual((root / 'capacity-history.2.jsonl').read_bytes(), b'previous')
            self.assertEqual((root / 'capacity-history.1.jsonl').stat().st_size, 4 * 1024**2)
            self.assertLess(sum(path.stat().st_size for path in root.glob('capacity-history*')), 12 * 1024**2)
            self.assertEqual(sentinel.read_bytes(), b'untouched')


if __name__ == '__main__':
    unittest.main()
