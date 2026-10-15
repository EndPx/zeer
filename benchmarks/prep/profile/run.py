"""Sequential opt-in admission phase / optional-cap diagnostics; never edits inputs."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time

CAP = 64 * 1024**2
SEGMENT_CAP = 16 * 1024**2


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def inventory(root):
    require(root.is_dir() and not root.is_symlink(), 'ARCHIVE_DIRECTORY')
    catalog_path = root / 'catalog.json'
    require(not catalog_path.is_symlink(), 'CATALOG_SYMLINK')
    catalog = json.loads(catalog_path.read_text())
    files = {'catalog.json': sha(catalog_path)}
    for segment in catalog['segments']:
        directory = Path(segment['directory'])
        require(len(directory.parts) == 2 and directory.parts[0] == 'segments'
                and directory.parts[1] not in ('.', '..'), 'UNSAFE_SEGMENT')
        for name in ['manifest.json', 'segment.bin']:
            relative = directory / name
            path = root / relative
            require(not path.is_symlink() and not path.parent.is_symlink()
                    and not (root / 'segments').is_symlink(), 'INPUT_SYMLINK')
            files[str(relative)] = sha(path)
    return {'catalog': catalog, 'files_sha256': files}


def check(profile, catalog, budget):
    require(profile['format'] == 'prep-admission-phases-v1', 'FORMAT')
    require(profile['catalog_sha256'] == catalog['catalog_sha256'], 'CATALOG_IDENTITY')
    require(profile['head'] == catalog['segments'][-1]['end_height']
            and profile['head_hash'] == catalog['segments'][-1]['end_hash'], 'HEAD_IDENTITY')
    p = profile['profile']
    require(p['archive_budget_bytes'] == (CAP if budget is None else budget)
            and p['segment_budget_bytes'] == SEGMENT_CAP, 'BUDGET_IDENTITY')
    require(len(p['segments']) == len(catalog['segments']), 'SEGMENT_COUNT')
    remaining = p['archive_budget_bytes']
    indexed = fallback = 0
    for observed, reference in zip(p['segments'], catalog['segments']):
        require(all(observed[key] == reference[key]
                    for key in ['directory', 'start_height', 'end_height']), 'SEGMENT_IDENTITY')
        require(observed['available_archive_bytes'] == remaining, 'REMAINING_BUDGET')
        allocated = observed['allocated_index_bytes']
        require(0 <= allocated <= min(remaining, SEGMENT_CAP), 'CAP_EXCEEDED')
        remaining -= allocated
        blocks = reference['end_height'] - reference['start_height'] + 1
        if allocated:
            indexed += blocks
        else:
            fallback += blocks
    require(profile['transaction_index_allocated_bytes'] == p['archive_budget_bytes'] - remaining
            and profile['indexed_blocks'] == indexed and profile['fallback_blocks'] == fallback,
            'RETAINED_INDEX_ACCOUNTING')
    require(sum(item['ns'] for item in p['phases'].values()) <= p['admission_ns'], 'PHASE_OVERLAP')


def check_fixture(profile, mode):
    p = profile['profile']
    expected = {'archive-cap': [220_000] * 5, 'segment-cap': [220_000, 221_000], 'small': [3, 4, 5]}[mode]
    require(profile['segment_transaction_counts'] == expected
            and profile['transactions'] == sum(expected), 'SYNTHETIC_ROW_COUNTS')
    require(p['native_metadata_row_bytes'] == 72 and p['native_secondary_entry_bytes'] == 4
            and p['native_offset_bytes'] == 8 and p['native_index_fixed_bytes'] == 96,
            'SYNTHETIC_X86_64_LAYOUT')
    require(len(p['segments']) == len(expected)
            and all(s['start_height'] == s['end_height'] for s in p['segments']),
            'SYNTHETIC_ONE_BLOCK_SEGMENTS')
    minimums = [p['native_index_fixed_bytes'] + 2 * p['native_offset_bytes']
                + count * (p['native_metadata_row_bytes'] + p['native_secondary_entry_bytes'])
                for count in expected]
    allocations = [s['allocated_index_bytes'] for s in p['segments']]
    if mode == 'archive-cap':
        require(len(allocations) == 5 and all(allocations[:4]) and allocations[4] == 0,
                'DEFAULT_ARCHIVE_CAP_NOT_OBSERVED')
        require(all(minimum <= SEGMENT_CAP for minimum in minimums)
                and p['segments'][4]['available_archive_bytes'] < minimums[4],
                'ARCHIVE_REMAINDER_NOT_LIMITING')
    elif mode == 'segment-cap':
        require(len(allocations) == 2 and allocations[0] > 0 and allocations[1] == 0,
                'DEFAULT_SEGMENT_CAP_NOT_OBSERVED')
        require(profile['profile']['segments'][1]['available_archive_bytes'] > SEGMENT_CAP,
                'ARCHIVE_BUDGET_CONFOUNDS_SEGMENT_CAP')
        require(minimums[0] <= SEGMENT_CAP < minimums[1], 'SEGMENT_MINIMUM_DOES_NOT_CROSS_CAP')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['archive', 'binary', 'out']:
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--budgets', default='0', help='Reduced archive bytes, comma-separated; default 0')
    parser.add_argument('--rounds', type=int, default=3)
    parser.add_argument('--timeout', type=int, default=900)
    parser.add_argument('--synthetic', choices=['archive-cap', 'segment-cap', 'small'])
    args = parser.parse_args()
    budgets = [int(value) for value in args.budgets.split(',')]
    require(1 <= args.rounds <= 3 and 30 <= args.timeout <= 1800, 'BOUNDED_RUN')
    require(1 <= len(budgets) <= 8 and len(set(budgets)) == len(budgets)
            and all(0 <= budget < CAP for budget in budgets), 'BOUNDED_REDUCED_BUDGETS')
    root, binary, out = args.archive.resolve(), args.binary.resolve(), args.out.resolve()
    results = Path(__file__).resolve().parents[3] / 'benchmarks/results'
    require(out != results.resolve() and out.is_relative_to(results.resolve()), 'IGNORED_RESULTS_REQUIRED')
    require(binary.is_file() and not out.exists(), 'BINARY_OR_NEW_OUTPUT')
    out.mkdir(parents=True)
    report = {'format': 'prep-admission-phase-runs-v1', 'status': 'RUNNING',
              'synthetic': args.synthetic, 'binary_sha256': sha(binary), 'visits': [],
              'harness_sha256': sha(Path(__file__)),
              'limitations': 'Input prehash warms filesystem cache. Phases add timer overhead. '
              'Controller must enforce resource limits externally. Metadata/payload verification '
              'runs after admission; digests compare budgets, not independent chain provenance.'}
    def save():
        (out / 'execution.json').write_text(json.dumps(report, indent=2) + '\n')
    save()
    try:
        report['before'] = inventory(root)
        catalog = report['before']['catalog']
        require(catalog['payload_kind'] == 'full-v1' and catalog['segments'], 'FULL_ARCHIVE_REQUIRED')
        expected = None
        for round_ in range(args.rounds):
            order = [None, *budgets]
            if round_ % 2:
                order.reverse()
            for position, budget in enumerate(order):
                command = [str(binary), str(root)]
                if budget is not None:
                    command.append(str(budget))
                visit = {'round': round_ + 1, 'budget': budget, 'status': 'RUNNING', 'command': command}
                report['visits'].append(visit)
                save()
                started = time.perf_counter_ns()
                result = subprocess.run(command, capture_output=True, timeout=args.timeout)
                visit['process_wall_ns'] = time.perf_counter_ns() - started
                stem = f'round{round_+1}-{position}'
                (out / (stem + '.stdout.json')).write_bytes(result.stdout)
                (out / (stem + '.stderr.txt')).write_bytes(result.stderr)
                visit['returncode'] = result.returncode
                require(result.returncode == 0, 'PROFILE_PROCESS_FAILED')
                profile = json.loads(result.stdout)
                check(profile, catalog, budget)
                if budget is None and args.synthetic:
                    check_fixture(profile, args.synthetic)
                equality = {key: profile[key] for key in
                            ['catalog_sha256', 'payload_sha256', 'metadata_sha256', 'transactions']}
                if expected is None:
                    expected = equality
                require(equality == expected, 'BUDGET_OUTPUT_CHANGED')
                visit.update(status='PASS', output=stem + '.stdout.json', profile=profile)
                save()
        report['after'] = inventory(root)
        require(report['before'] == report['after'], 'INPUT_CHANGED')
        report['status'] = 'PASS'
    except BaseException as error:
        report['status'] = 'FAIL'
        report['failure'] = f'{type(error).__name__}: {error}'
        raise
    finally:
        save()


if __name__ == '__main__':
    main()
