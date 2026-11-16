#!/usr/bin/env python3
"""Read-only capacity diagnostics. Never edits source readiness or financial state."""
import argparse
import datetime
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

GIB = 1024**3
ROOT = Path('/opt/zeer-testnet')


def warnings(sample, plan):
    result = []
    allocation = plan['allocation']
    growth_per_day = plan['forecastGrowthBytes']['total'] / plan['forecastDays']
    archive_per_day = plan['forecastGrowthBytes']['archive'] / plan['forecastDays']
    physical_margin = sample['physicalFreeBytes'] - allocation['minimumPhysicalFreeGiBUnchanged'] * GIB
    aggregate_margin = (allocation['aggregateStopGiB'] * GIB - sample['aggregateBytes']) if sample['aggregateBytes'] is not None else None
    archive_margin = (allocation['prepArchiveGiB'] * GIB - sample['archiveBytes'] - 256 * 1024**2) if sample['archiveBytes'] is not None else None
    for label, margin, daily in [('physical_disk', physical_margin, growth_per_day),
                                  ('aggregate_storage', aggregate_margin, growth_per_day),
                                  ('archive_storage', archive_margin, archive_per_day)]:
        if margin is None:
            result.append(label + '_unknown')
        elif margin <= 0:
            result.append(label + '_at_safety_boundary')
        elif margin / daily < 14:
            result.append(label + '_below_14_days_at_planned_growth')
    if sample['availableMemoryBytes'] < 4 * GIB:
        result.append('host_memory_below_4GiB_warning')
    if sample['nodeRssBytes'] is not None and sample['nodeRssBytes'] >= 6 * GIB:
        result.append('node_memory_at_or_above_6GiB_warning')
    if not sample['nodeRunning']:
        result.append('source_node_not_running')
    if sample['nodeOomKilled']:
        result.append('source_node_oom_recorded')
    if sample['writerState'] != 'active':
        result.append('archive_writer_not_active')
    if not sample['writerReady']:
        result.append('archive_writer_not_ready')
    if not sample['followerRunning']:
        result.append('chef_follower_not_running')
    if sample['guardAgeSeconds'] is None or not 0 <= sample['guardAgeSeconds'] <= 600:
        result.append('resource_guard_observation_unknown_or_stale')
    if sample['halted']:
        result.append('operator_halt_latched')
    if sample['writerObservationAgeSeconds'] is None or not 0 <= sample['writerObservationAgeSeconds'] <= 120:
        result.append('writer_source_observation_unknown_or_stale')
    if sample['atUnix'] > plan['current']['atUnix'] + plan['forecastDays'] * 86400:
        result.append('capacity_plan_horizon_elapsed_recalculate')
    return sorted(result)


def regular_bytes(root):
    # A disappearing pending manifest makes this observation unknown, not empty.
    total, count = 0, 0
    for parent, directories, files in os.walk(root, followlinks=False):
        for name in directories + files:
            if (Path(parent) / name).is_symlink():
                raise ValueError('Archive symlink encountered')
        for name in files:
            count += 1
            if count > 500_000:
                raise ValueError('Archive diagnostic file bound exceeded')
            total += os.stat(Path(parent) / name).st_size
    return total


def command(args):
    return subprocess.check_output(args, text=True, timeout=20).strip()


def collect():
    try:
        archive = regular_bytes(ROOT / 'storage-v3-20261018/archives/full')
    except (OSError, ValueError):
        archive = None
    # Sample clocks and process states after slow I/O, not before it.
    guard = json.loads((ROOT / 'guard-status.json').read_text())
    writer = json.loads((ROOT / 'storage-v3-20261018/archives/full/status.json').read_text())
    node = json.loads(command(['docker', 'inspect', '--format', '{{json .State}}', 'zeer-testnet-zebra']))
    follower = json.loads(command(['docker', 'inspect', '--format', '{{json .State}}', 'zeeswap-chef-primary-r1-follower-1']))
    rss = None
    if node['Running']:
        try:
            rss = int(next(line.split()[1] for line in Path('/proc', str(node['Pid']), 'status').read_text().splitlines() if line.startswith('VmRSS:'))) * 1024
        except (OSError, StopIteration):
            pass
    memory = int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))) * 1024
    try:
        checked = datetime.datetime.fromisoformat(guard['checked_at_utc']).timestamp()
    except (KeyError, ValueError, TypeError):
        checked = None
    source_at = writer.get('updated_at_unix') if writer.get('ready') is True else None
    restarts = int(command(['docker', 'inspect', '--format', '{{.RestartCount}}', 'zeeswap-chef-primary-r1-follower-1']))
    writer_state = command(['systemctl', 'show', 'zeer-testnet-prep-follow.service', '-p', 'ActiveState', '--value'])
    # Measure age after the potentially slow archive walk; sampling is not a new source observation.
    now = time.time()
    # This is a diagnostic sampling clock; never replace updated_at_unix with it.
    return {'atUnix': now, 'physicalFreeBytes': shutil.disk_usage(ROOT).free,
            'availableMemoryBytes': memory, 'aggregateBytes': guard.get('zeer_bytes'),
            'archiveBytes': archive, 'nodeRunning': node['Running'], 'nodeOomKilled': node['OOMKilled'],
            'nodeRssBytes': rss, 'followerRunning': follower['Running'],
            'followerRestartCount': restarts, 'writerState': writer_state,
            'writerReady': writer.get('ready') is True, 'writerStatusUpdatedAt': writer.get('updated_at_unix'),
            'writerIndexedHeight': writer.get('indexed_height'), 'writerSourceHeight': writer.get('source_height'),
            'writerSourceObservedAt': source_at,
            'writerObservationAgeSeconds': None if source_at is None else now - source_at,
            'guardAgeSeconds': None if checked is None else now - checked,
            'halted': (ROOT / 'HALTED').exists()}


def save(directory, sample):
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = directory / 'capacity-status.next.json'
    with temporary.open('w') as output:
        output.write(json.dumps(sample, indent=2) + '\n')
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, directory / 'capacity-status.json')
    history = directory / 'capacity-history.jsonl'
    line = (json.dumps(sample, separators=(',', ':')) + '\n').encode('utf-8')
    if len(line) > 64 * 1024:
        raise ValueError('Diagnostic record exceeds bound')
    # Keep at most three 4-MiB history files; no unbounded logging.
    if history.exists() and history.stat().st_size + len(line) > 4 * 1024**2:
        oldest = directory / 'capacity-history.2.jsonl'
        if oldest.exists():
            oldest.unlink()
        previous = directory / 'capacity-history.1.jsonl'
        if previous.exists():
            previous.replace(oldest)
        history.replace(previous)
    with history.open('ab') as output:
        output.write(line)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--state-dir', type=Path, required=True)
    args = parser.parse_args()
    plan = json.loads(args.plan.read_text())
    sample = collect()
    sample['warnings'] = warnings(sample, plan)
    sample['status'] = 'WARNING' if sample['warnings'] else 'WITHIN_PLANNED_ENVELOPE'
    sample['scope'] = 'Capacity observation only; not source, consensus, settlement or uptime authority.'
    save(args.state_dir, sample)
    print(json.dumps({'status': sample['status'], 'warnings': sample['warnings']}))


if __name__ == '__main__':
    main()
