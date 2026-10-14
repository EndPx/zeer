"""Read-only immutable Prep archive scale measurements. Linux Docker/cgroup v2.

No ingestion, cache eviction, source-node mutation or existing-service control.
Only this run's newly created containers/network are stopped; state is retained.
"""
import argparse
import gzip
import hashlib
import http.client
import ipaddress
import json
import os
from pathlib import Path
import re
import signal
import statistics
import subprocess
import sys
import time

FIELDS = ['txid', 'block_height', 'index', 'version', 'locktime', 'size_bytes',
          'transparent_input_count', 'transparent_output_count']
TOKEN = 'disposable-prep-scale-token'


def require(ok, code):
    if not ok:
        raise ValueError(code)


def private_subnet(value):
    try:
        network = ipaddress.ip_network(value, strict=True)
    except ValueError:
        raise argparse.ArgumentTypeError('Use a canonical RFC1918 IPv4 subnet, such as 10.250.64.0/24') from None
    private_ranges = [ipaddress.ip_network(cidr) for cidr in ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']]
    if not isinstance(network, ipaddress.IPv4Network) or not 24 <= network.prefixlen <= 28 or not any(network.subnet_of(parent) for parent in private_ranges):
        raise argparse.ArgumentTypeError('Subnet must be RFC1918 IPv4 with a /24 through /28 prefix')
    return str(network)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def digest(value):
    checksum = hashlib.sha256()
    for chunk in json.JSONEncoder(sort_keys=True, separators=(',', ':')).iterencode(value):
        checksum.update(chunk.encode())
    return checksum.hexdigest()


def load_oracle(path, start, end):
    raw = path.read_bytes()
    data = json.loads(gzip.decompress(raw) if path.suffix == '.gz' else raw)
    require(data['range'] == {'from': start, 'to': end}, 'ORACLE_RANGE')
    headers = [{'height': int(b['id']), 'hash': b['hash'], 'time': int(b['time'])} for b in data['blocks']]
    require([b['height'] for b in headers] == list(range(start, end + 1)), 'ORACLE_BLOCK_ORDER')
    counts = {int(b['id']): b['transactionCount'] for b in data['blocks']}
    positions, previous = {}, start
    # Replace entries in the captured array, rather than retaining two full row arrays.
    rows = data.pop('transactions')
    for position, tx in enumerate(rows):
        height = int(tx['minedHeight'])
        require(previous <= height <= end and height in counts, 'ORACLE_TRANSACTION_ORDER')
        index = positions.get(height, 0)
        rows[position] = dict(zip(FIELDS, [tx['id'], height, index, int(tx['version']), int(tx['locktime']),
            int(tx['sizeBytes']), int(tx['transparentInputCount']), int(tx['transparentOutputCount'])]))
        positions[height], previous = index + 1, height
    require(positions == counts, 'ORACLE_TRANSACTION_COUNTS')
    require(all(re.fullmatch('[0-9a-f]{64}', b['hash']) for b in headers), 'ORACLE_BLOCK_HASH')
    require(all(re.fullmatch('[0-9a-f]{64}', row['txid']) for row in rows), 'ORACLE_TXID')
    return {'headers': headers, 'transactions': rows, 'sha256': sha(raw), 'source': data['source']}


def archive_identity(root, verify_payload=False):
    catalog_bytes = (root / 'catalog.json').read_bytes()
    catalog = json.loads(catalog_bytes)
    require(catalog['payload_kind'] == 'full-v1' and catalog['segments'], 'FULL_ARCHIVE_REQUIRED')
    files = []
    for ref in catalog['segments']:
        require(re.fullmatch(r'segments/[A-Za-z0-9_-]+', ref['directory']), 'SEGMENT_PATH')
        folder = root / ref['directory']
        raw = (folder / 'manifest.json').read_bytes()
        require(sha(raw) == ref['manifest_sha256'], 'MANIFEST_HASH')
        manifest = json.loads(raw)
        segment = folder / 'segment.bin'
        # Use the actual single segment filename; never guess its bytes from disk size.
        require(segment.is_file(), 'SEGMENT_FILE_MISSING')
        require(segment.stat().st_size == manifest['segment_bytes'], 'SEGMENT_LENGTH')
        if verify_payload:
            checksum = hashlib.sha256()
            with segment.open('rb') as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b''): checksum.update(chunk)
            require(checksum.hexdigest() == manifest['segment_sha256'], 'SEGMENT_CHECKSUM')
        files.append({'directory': ref['directory'], 'manifest_sha256': sha(raw),
            'payload_sha256_declared': manifest['segment_sha256'], 'bytes': segment.stat().st_size,
            'start': ref['start_height'], 'end': ref['end_height']})
    disk = {'logical_bytes': 0, 'allocated_bytes': 0, 'files': 0}
    for path in root.rglob('*'):
        require(not path.is_symlink(), 'ARCHIVE_SYMLINK')
        if path.is_file():
            stat = path.stat(); disk['logical_bytes'] += stat.st_size
            if not hasattr(stat, 'st_blocks'): disk['allocated_bytes'] = None
            elif disk['allocated_bytes'] is not None: disk['allocated_bytes'] += stat.st_blocks * 512
            disk['files'] += 1
    return {'catalog_sha256': sha(catalog_bytes), 'catalog': catalog, 'segments': files, 'disk': disk}


def call(args, timeout=120):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    require(result.returncode == 0, 'COMMAND_FAILED:' + args[0])
    return result.stdout.strip()


def inspect(name):
    return json.loads(call(['docker', 'inspect', name]))[0]


def counters(pid):
    group = Path('/sys/fs/cgroup' + Path(f'/proc/{pid}/cgroup').read_text().strip().split('::', 1)[1])
    values = {key: (group / key).read_text().strip() for key in
        ['cpu.max', 'cpu.stat', 'memory.max', 'memory.swap.max', 'memory.current', 'memory.peak', 'memory.events', 'memory.stat', 'io.stat']}
    values['process_status'] = Path(f'/proc/{pid}/status').read_text()
    require(values['cpu.max'] == '100000 100000' and values['memory.max'] == str(2 * 1024**3)
            and values['memory.swap.max'] == '0', 'CGROUP_QUOTA')
    return values


def controller_limits():
    group = Path('/sys/fs/cgroup' + Path('/proc/self/cgroup').read_text().strip().split('::', 1)[1])
    values = {key: (group / key).read_text().strip() for key in ['cpu.max', 'memory.max', 'memory.swap.max']}
    cpu = values['cpu.max'].split()
    require(cpu[0] != 'max' and int(cpu[0]) / int(cpu[1]) <= 1
        and values['memory.max'] != 'max' and int(values['memory.max']) <= 1024**3
        and values['memory.swap.max'] == '0', 'BOUNDED_CONTROLLER_CGROUP_REQUIRED')
    return values


def host_health(path):
    available = int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))) * 1024
    stat = os.statvfs(path)
    free = stat.f_bavail * stat.f_frsize
    require(available >= 3 * 1024**3 and free >= 2 * 1024**3, 'HOST_MEMORY_OR_DISK_LOW')
    return {'available_memory_bytes': available, 'free_disk_bytes': free, 'loadavg': Path('/proc/loadavg').read_text().strip()}


class Http:
    def __init__(self, address):
        self.address, self.requests, self.bytes = address, 0, 0

    def request(self, path, body=None, timeout=30):
        connection = http.client.HTTPConnection(self.address, 39368, timeout=timeout)
        try:
            connection.request('GET' if body is None else 'POST', path,
                None if body is None else json.dumps(body), {'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json'})
            response = connection.getresponse(); raw = response.read(32 * 1024**2 + 1)
            self.requests += 1; self.bytes += len(raw)
            require(response.status == 200 and len(raw) <= 32 * 1024**2, 'HTTP_STATUS_OR_LIMIT')
            return json.loads(raw)
        finally:
            connection.close()


def query(http, start, end, kind, meta, ids=None):
    rows = []
    for window in range(start, end + 1, 10000):
        upper = min(window + 10000, end + 1)
        body = {'from_block': window, 'to_block': upper, 'limit': 128,
            'field_selection': {'block': ['height', 'hash', 'time'] if kind == 'headers' else [],
                                'transaction': FIELDS if kind != 'headers' else []}}
        if ids is not None: body['transaction_filter'] = {'txids': ids}
        next_height = window
        while next_height < upper:
            page = http.request('/query', body)
            require(all(page[key] == meta[key] for key in ['network', 'epoch', 'revision', 'archive_height']), 'QUERY_IDENTITY')
            # Prep preserves the original request range on every cursor page.
            require(page['from_block'] == window and page['to_block'] == upper, 'QUERY_RANGE')
            require(next_height < page['next_block'] <= upper, 'QUERY_PROGRESS')
            rows.extend(page['data']['blocks' if kind == 'headers' else 'transactions'])
            next_height = page['next_block']
            require((page['cursor'] is None) == (next_height == upper), 'QUERY_CURSOR')
            if page['cursor'] is not None: body['cursor'] = page['cursor']
    return rows


def measure(http, fetch, expected):
    before = (http.requests, http.bytes); started = time.perf_counter_ns()
    rows = fetch(); elapsed = time.perf_counter_ns() - started
    require(rows == expected, 'EXACT_ORACLE_MISMATCH')
    require(all(type(row[key]) is type(reference[key]) for row, reference in zip(rows, expected) for key in reference), 'PROJECTION_SCALAR_TYPES')
    return {'elapsed_ns': elapsed, 'rows': len(rows), 'sha256': digest(rows),
        'requests': http.requests - before[0], 'response_body_bytes': http.bytes - before[1]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ['archive', 'oracle', 'binary', 'out']: parser.add_argument('--' + key, type=Path, required=True)
    parser.add_argument('--profile-binary', type=Path)
    parser.add_argument('--runtime-image', required=True)
    parser.add_argument('--name', required=True)
    parser.add_argument('--subnet', type=private_subnet, help='Optional unused RFC1918 IPv4 /24 through /28; inspect host routes first')
    parser.add_argument('--rounds', type=int, default=3)
    parser.add_argument('--startup-timeout', type=int, default=600)
    args = parser.parse_args()
    require(sys.platform == 'linux' and re.fullmatch(r'zeer-scale-[a-z0-9-]{1,35}', args.name), 'LINUX_OR_NAME')
    require(1 <= args.rounds <= 5 and 30 <= args.startup_timeout <= 1800, 'BOUNDED_ROUNDS_TIMEOUT')
    require(re.fullmatch(r'.+@sha256:[0-9a-f]{64}', args.runtime_image), 'PINNED_RUNTIME_IMAGE')
    for key in ['archive', 'oracle', 'binary', 'out']:
        setattr(args, key, getattr(args, key).resolve())
    require(not args.out.exists() and args.binary.is_file(), 'NEW_OUTPUT_BINARY')
    if args.profile_binary: require(args.profile_binary.resolve().is_file(), 'PROFILE_BINARY_REQUIRED')
    args.out.mkdir(parents=True)
    try:
        controller = controller_limits(); health = host_health(args.out)
        identity = archive_identity(args.archive)
        catalog = identity['catalog']; start, end = catalog['start_height'], catalog['segments'][-1]['end_height']
        require(catalog['network'] == 'mainnet' and start == 1 and end in [2048, 8192, 32768], 'MAINNET_PREFIX_TIER')
        oracle = load_oracle(args.oracle, start, end)
        require(oracle['headers'][-1]['hash'] == catalog['segments'][-1]['end_hash'], 'ORACLE_ARCHIVE_HEAD')
    except Exception as error:
        (args.out / 'execution.json').write_text(json.dumps({'status': 'FAIL', 'phase': 'preflight', 'error_type': type(error).__name__, 'error_code': str(error) if isinstance(error, ValueError) else 'PREFLIGHT_FAILED'}, indent=2) + '\n')
        raise
    report = {'format': 'prep-immutable-scale-v1', 'status': 'RUNNING', 'archive': identity,
        'binary_sha256': sha(args.binary.read_bytes()), 'oracle_sha256': oracle['sha256'], 'oracle_source': oracle['source'],
        'harness_sha256': sha(Path(__file__).read_bytes()), 'controller_limits': controller, 'host_before': health,
        'requested_subnet': args.subnet,
        'visits': [], 'cleanup_errors': [],
        'limits': ['Fresh process, filesystem cache uncontrolled; archive admission itself reads payloads. No drop_caches or cold-cache claim.',
                   'Startup starts before docker start and ends after first verified ready metadata, including launch/inspection/poll overhead.',
                   'Query time includes HTTP connection, transfer and JSON decode; equality and digest are outside the timer. Warmup precedes every measured read.',
                   'Read-only prepared early-chain tier; source synchronization and archive ingestion excluded. Not modern shielded density or whole-chain extrapolation.',
                   'Cgroup memory includes file cache; /proc RSS and optional archive_profile distinguish process/index allocations.']}
    save = lambda: (args.out / 'execution.json').write_text(json.dumps(report, indent=2) + '\n')
    save(); owned = []; network_created = False
    try:
        network_args = ['docker', 'network', 'create', '--internal']
        if args.subnet: network_args += ['--subnet', args.subnet]
        call([*network_args, args.name]); network_created = True
        def create(name, binary, command):
            call(['docker', 'create', '--name', name, '--network', args.name, '--stop-signal', 'SIGINT',
                '--cpus', '1', '--memory', '2g', '--memory-swap', '2g', '--pids-limit', '128',
                '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only',
                '-e', 'PREP_API_TOKEN=' + TOKEN, '-v', str(binary) + ':/usr/local/bin/probe:ro',
                '-v', str(args.archive) + ':/data:ro', '--entrypoint', '/usr/local/bin/probe', args.runtime_image, *command])
            owned.append(name)
        for number in range(1, args.rounds + 1):
            name = args.name + '-' + str(number)
            create(name, args.binary, ['serve-http', '--archive', '/data', '--listen', '0.0.0.0:39368', '--allow-network'])
            visit = {'round': number, 'status': 'STARTING', 'reads': {}}; report['visits'].append(visit); save()
            visit['host_before'] = host_health(args.out)
            started = time.perf_counter_ns(); call(['docker', 'start', name])
            launched = time.perf_counter_ns(); details = inspect(name)
            pid = details['State']['Pid']; http = Http(details['NetworkSettings']['Networks'][args.name]['IPAddress'])
            deadline = time.monotonic() + args.startup_timeout
            while True:
                require(time.monotonic() < deadline, 'STARTUP_TIMEOUT')
                try:
                    meta = http.request('/height', timeout=1)
                    require(meta['ready'] and meta['network'] == catalog['network'] and meta['payload_kind'] == 'full-v1'
                        and meta['start_block'] == start and meta['archive_height'] == end, 'READY_IDENTITY')
                    break
                except (OSError, ValueError):
                    require(inspect(name)['State']['Running'], 'PREP_EXITED_DURING_ADMISSION')
                    time.sleep(.05)
            visit.update(start_to_ready_ns=time.perf_counter_ns() - started, docker_start_ns=launched-started,
                metadata=meta, resources_after_admission=counters(pid))
            jobs = [('headers', lambda: query(http, start, end, 'headers', meta), oracle['headers']),
                    ('metadata', lambda: query(http, start, end, 'metadata', meta), oracle['transactions'])]
            for position, anchor in enumerate([start, start + (end-start)//2, max(start, end-999)]):
                upper = min(end + 1, anchor + 1000)
                candidates = [row for row in oracle['transactions'] if anchor <= row['block_height'] < upper]
                ids = list(dict.fromkeys(row['txid'] for row in candidates))[::max(1, len(candidates)//128)][:128]
                expected = [row for row in candidates if row['txid'] in ids]
                jobs.append((f'sparse-{position}', lambda anchor=anchor, upper=upper, ids=ids: query(http, anchor, upper-1, 'metadata', meta, ids), expected))
                def batch(anchor=anchor, upper=upper, ids=ids):
                    response = http.request('/transactions', {'from_block': anchor, 'to_block': upper, 'txids': ids, 'fields': FIELDS})
                    require(response['complete'] and response['missing_txids'] == [] and all(response[key] == meta[key] for key in ['network', 'epoch', 'revision', 'archive_height']), 'BATCH_IDENTITY')
                    require(response['from_block'] == anchor and response['to_block'] == upper and response['snapshot'] == {
                        'network': meta['network'], 'archive_start': start, 'to_block': upper, 'epoch': meta['epoch'],
                        'boundary_hash': oracle['headers'][upper-start-1]['hash']}, 'BATCH_BOUNDARY')
                    return response['transactions']
                jobs.append((f'batch-{position}', batch, expected))
            # Rotate workload order to reduce persistent warm-cache position bias.
            offset = (number - 1) % len(jobs); jobs = jobs[offset:] + jobs[:offset]
            for label, fetch, expected in jobs:
                warmup = measure(http, fetch, expected)
                measured = measure(http, fetch, expected)
                visit['reads'][label] = {'warmup': warmup, 'measured': measured}; save()
            visit.update(status='PASS', resources_after_reads=counters(pid)); save()
            call(['docker', 'stop', '--time', '10', name])
        if args.profile_binary:
            binary = args.profile_binary.resolve(); name = args.name + '-profile'
            create(name, binary, ['/data']); call(['docker', 'start', name])
            require(call(['docker', 'wait', name], timeout=args.startup_timeout) == '0', 'PROFILE_FAILURE')
            profile = json.loads(call(['docker', 'logs', name]))
            require(profile['head'] == end and profile['start_height'] == start
                and profile['head_hash'] == oracle['headers'][-1]['hash'] and profile['network'] == catalog['network']
                and profile['payload_kind'] == 'full-v1'
                and profile['indexed_blocks'] + profile['fallback_blocks'] == end-start+1
                and profile['transaction_index_allocated_bytes'] <= 64*1024**2, 'PROFILE_RANGE_OR_BUDGET')
            report['archive_profile'] = {'binary_sha256': sha(binary.read_bytes()), 'timing': 'Separate process after measured reads; filesystem cache warmed by preceding visits.', 'result': profile}
        report['archive_after'] = archive_identity(args.archive, verify_payload=True)
        require(report['archive_after'] == identity, 'ARCHIVE_MUTATED')
        report['summary'] = {label: {'median_ms': statistics.median(v['reads'][label]['measured']['elapsed_ns'] for v in report['visits'])/1e6}
            for label in report['visits'][0]['reads']}
        report['summary']['startup'] = {'median_start_to_ready_ms': statistics.median(v['start_to_ready_ns'] for v in report['visits'])/1e6,
            'median_docker_start_ms': statistics.median(v['docker_start_ns'] for v in report['visits'])/1e6}
        report['host_after'] = host_health(args.out); report['status'] = 'PASS'
    except BaseException as error:
        report.update(status='FAIL', error_type=type(error).__name__, error_code=str(error) if isinstance(error, ValueError) else 'RUN_FAILED')
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
                except Exception as error: report['cleanup_errors'].append({'container': name, 'operation': operation, 'error_type': type(error).__name__})
        if report['cleanup_errors']: report['status'] = 'FAIL'
        report['network_created'] = network_created; save()
    require(report['status'] == 'PASS', 'RUN_OR_CLEANUP_FAILED')
    print('PASS: immutable Prep scale; evidence local at ' + str(args.out))


if __name__ == '__main__':
    def interrupted(signum, frame):
        raise ValueError('RUN_INTERRUPTED')
    signal.signal(signal.SIGINT, interrupted); signal.signal(signal.SIGTERM, interrupted)
    main()
