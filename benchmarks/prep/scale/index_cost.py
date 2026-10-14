"""Paired read-only admission diagnostics: ordinary and zero-index builds.

The caller supplies two archive_profile binaries built from the same source except
for ARCHIVE_INDEX_BYTES=0 in a disposable measurement clone. No engine is edited
here. Both binaries retain mandatory archive integrity checks.
"""
import argparse
import datetime
import json
from pathlib import Path
import re
import signal
import statistics
import subprocess
import time

from benchmarks.prep.scale.run import archive_identity, call, controller_limits, counters, host_health, inspect, require, sha


def check_profile(profile, catalog, variant):
    expected = {'network': catalog['network'], 'payload_kind': catalog['payload_kind'],
        'start_height': catalog['start_height'], 'head': catalog['segments'][-1]['end_height'],
        'head_hash': catalog['segments'][-1]['end_hash'], 'epoch': catalog['epoch'],
        'revision': catalog['revision'], 'segments': len(catalog['segments'])}
    require(all(profile[key] == value for key, value in expected.items()), 'PROFILE_IDENTITY')
    blocks = expected['head'] - expected['start_height'] + 1
    require(profile['indexed_blocks'] + profile['fallback_blocks'] == blocks, 'PROFILE_BLOCK_COUNT')
    if variant == 'baseline':
        require(0 < profile['transaction_index_allocated_bytes'] <= 64 * 1024**2
            and profile['fallback_blocks'] == 0 and profile['indexed_blocks'] == blocks, 'BASELINE_INDEX_EXPECTATION')
    else:
        require(profile['transaction_index_allocated_bytes'] == 0 and profile['indexed_blocks'] == 0
            and profile['fallback_blocks'] == blocks and profile['indexed_transactions'] == 0, 'ZERO_INDEX_EXPECTATION')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['archive', 'baseline-binary', 'zero-index-binary', 'out']:
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--runtime-image', required=True)
    parser.add_argument('--name', required=True)
    parser.add_argument('--timeout', type=int, default=600)
    args = parser.parse_args()
    require(re.fullmatch(r'zeer-index-cost-[a-z0-9-]{1,30}', args.name), 'OWNED_NAME')
    require(re.fullmatch(r'.+@sha256:[0-9a-f]{64}', args.runtime_image), 'PINNED_RUNTIME_IMAGE')
    require(30 <= args.timeout <= 1800, 'BOUNDED_TIMEOUT')
    args.archive = args.archive.resolve(); args.out = args.out.resolve()
    results = Path(__file__).resolve().parents[3] / 'benchmarks/results'
    require(args.out != results.resolve() and args.out.is_relative_to(results.resolve()), 'OUTPUT_MUST_BE_IGNORED_RESULTS')
    binaries = {'baseline': args.baseline_binary.resolve(), 'zero_index': args.zero_index_binary.resolve()}
    require(all(binary.is_file() for binary in binaries.values()) and not args.out.exists(), 'BINARIES_OR_NEW_OUTPUT')
    args.out.mkdir(parents=True)
    report = {'format': 'prep-paired-index-cost-v1', 'status': 'RUNNING', 'visits': [], 'cleanup_errors': [],
        'started_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'harness_sha256': sha(Path(__file__).read_bytes()), 'runtime_image': args.runtime_image,
        'binary_sha256': {variant: sha(binary.read_bytes()) for variant, binary in binaries.items()},
        'expected_archive_index_budget_bytes': {'baseline': 64 * 1024**2, 'zero_index': 0},
        'order': [['baseline', 'zero_index'], ['zero_index', 'baseline'], ['baseline', 'zero_index']],
        'limitations': [
            'The caller must verify that the disposable zero-index build changes only ARCHIVE_INDEX_BYTES. Binary hashes alone do not prove source equivalence.',
            'archive_profile reports its normal reference index budget as a literal; expected counterfactual build budgets are recorded separately and allocation/fallback outcomes are verified.',
            'Each admission still reads, hashes and validates all payloads. This isolates optional derived-cache construction; it does not predict a safe persisted-index startup or bypass checksums.',
            'Filesystem cache is uncontrolled; fresh processes and alternating order are not cold-cache guarantees. No cache eviction occurs.',
            'Last-live cgroup samples may precede exit and are incomplete CPU/IO accounting. The profile timer and after-admission RSS are recorded by the measured process itself.',
            'Profile metadata counting runs after its admission timer; Docker lifecycle wall time includes launch, polling, metadata counts and exit.',
            'Three pairs are a bounded diagnostic with raw variation; deltas are not an unconditional speed upper bound or whole-chain extrapolation.'
        ]}
    save = lambda: (args.out / 'execution.json').write_text(json.dumps(report, indent=2) + '\n')
    save(); owned = []
    try:
        report['controller_limits'] = controller_limits(); report['host_before'] = host_health(args.out)
        identity = archive_identity(args.archive)
        catalog = identity['catalog']
        require(catalog['network'] == 'mainnet' and catalog['start_height'] == 1
            and catalog['segments'][-1]['end_height'] == 32768, 'IMMUTABLE_32768_MAINNET_TIER')
        report['archive'] = identity; save()
        for pair, order in enumerate(report['order'], 1):
            for variant in order:
                name = f'{args.name}-{pair}-{variant.replace("_", "-")}'
                visit = {'pair': pair, 'variant': variant, 'status': 'STARTING', 'host_before': host_health(args.out)}
                report['visits'].append(visit); save()
                call(['docker', 'create', '--name', name, '--network', 'none', '--cpus', '1',
                    '--memory', '2g', '--memory-swap', '2g', '--pids-limit', '128', '--stop-signal', 'SIGINT',
                    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only',
                    '-v', str(binaries[variant]) + ':/usr/local/bin/archive_profile:ro',
                    '-v', str(args.archive) + ':/data:ro', '--entrypoint', '/usr/local/bin/archive_profile',
                    args.runtime_image, '/data'])
                owned.append(name)
                before_start = time.perf_counter_ns(); call(['docker', 'start', name])
                deadline = time.monotonic() + args.timeout
                samples = 0
                while True:
                    details = inspect(name)
                    if not details['State']['Running']: break
                    require(time.monotonic() < deadline, 'PROFILE_TIMEOUT')
                    try:
                        visit['resources_last_live'] = counters(details['State']['Pid']); samples += 1
                    except OSError:
                        # The process can finish between inspection and its /proc read.
                        require(not inspect(name)['State']['Running'], 'RESOURCE_SAMPLE_FAILED')
                    time.sleep(.1)
                visit['docker_lifecycle_wall_ns'] = time.perf_counter_ns() - before_start
                state = details['State']
                visit['container_state'] = {key: state[key] for key in ['StartedAt', 'FinishedAt', 'ExitCode', 'OOMKilled']}
                visit['resource_samples'] = samples
                require(state['ExitCode'] == 0 and not state['OOMKilled'], 'PROFILE_EXIT_OR_OOM')
                profile = json.loads(call(['docker', 'logs', name]))
                check_profile(profile, catalog, variant)
                visit.update(status='PASS', profile=profile)
                (args.out / f'pair-{pair}-{variant}.json').write_text(json.dumps(visit, indent=2) + '\n')
                save()
        report['archive_after'] = archive_identity(args.archive, verify_payload=True)
        require(report['archive_after'] == identity, 'ARCHIVE_MUTATED')
        pairs = []
        for pair in range(1, 4):
            visits = {v['variant']: v for v in report['visits'] if v['pair'] == pair}
            baseline = visits['baseline']['profile']['admission_ns']; zero = visits['zero_index']['profile']['admission_ns']
            pairs.append({'pair': pair, 'baseline_ns': baseline, 'zero_index_ns': zero,
                'baseline_minus_zero_ns': baseline-zero, 'order': report['order'][pair-1]})
        report['pairs'] = pairs
        report['summary'] = {'baseline_median_ms': statistics.median(p['baseline_ns'] for p in pairs)/1e6,
            'zero_index_median_ms': statistics.median(p['zero_index_ns'] for p in pairs)/1e6,
            'paired_delta_median_ms': statistics.median(p['baseline_minus_zero_ns'] for p in pairs)/1e6}
        report['host_after'] = host_health(args.out); report['status'] = 'PASS'
    except BaseException as error:
        report.update(status='FAIL', error_type=type(error).__name__, error_code=str(error) if isinstance(error, ValueError) else 'INDEX_COST_FAILED')
        raise
    finally:
        signal.signal(signal.SIGINT, signal.SIG_IGN); signal.signal(signal.SIGTERM, signal.SIG_IGN)
        for name in reversed(owned):
            for operation, command in [('logs', ['docker', 'logs', name]), ('stop', ['docker', 'stop', '--time', '10', name])]:
                try:
                    if operation == 'logs':
                        logs = subprocess.run(command, capture_output=True, text=True, timeout=30)
                        (args.out / (name + '.log')).write_text(logs.stdout + logs.stderr)
                        require(logs.returncode == 0, 'LOG_COLLECTION_FAILED')
                    else: call(command)
                except Exception as error:
                    report['cleanup_errors'].append({'container': name, 'operation': operation, 'error_type': type(error).__name__})
        if report['cleanup_errors']: report['status'] = 'FAIL'
        report['finished_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat(); save()
    require(report['status'] == 'PASS', 'INDEX_COST_OR_CLEANUP_FAILED')
    print('PASS: paired admission cost; evidence local at ' + str(args.out))


if __name__ == '__main__':
    def interrupted(signum, frame):
        raise ValueError('INDEX_COST_INTERRUPTED')
    signal.signal(signal.SIGINT, interrupted); signal.signal(signal.SIGTERM, interrupted)
    main()
