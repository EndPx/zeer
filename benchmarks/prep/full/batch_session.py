"""Four prepared retrieval cases, five rotated rounds; no source/index construction.

Root runs this host controller inside zeerbatchclient.slice (1 CPU/1 GiB).
Only one queried backend runs at a time; the frozen node remains stopped.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import statistics
import subprocess
import sys
import time
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = Path('/opt/zeer-prep/20261014-batch')
SOURCE, OUT = ROOT / 'source', ROOT / 'results/compare'
ARCHIVE = Path('/opt/zeer-chef/20261014/data/prep-mainnet-2048')
NETWORK, SLICE = 'zeer-bench-four-frozen', 'zeerbatchclient.slice'
PG, NODE, CLONE = 'zeer-chef-pg', 'zeer-bench-four-frozen', 'zeer-lookup-chef-pg'
PREP = {'before': 'zeer-batch-before', 'after': 'zeer-batch-after'}
CASES = ['before-query', 'after-query', 'after-batch', 'cipherscan-sql']
RUNTIME = 'rust@sha256:2c3a22f0a5533ea2dd5a16627bc841228151faa2d4de2644ac9987e4a2f1f2fa'
PYTHON = 'python@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1'
DEPS, GENERATED = '/opt/zeer-bench/20261013/state/client/deps', '/opt/zeer-bench/20261013/state/client/generated'
ORACLE = Path('benchmarks/fixtures/mainnet-public-2048/oracle.json.gz')
MANIFEST = Path('benchmarks/fixtures/mainnet-transactions-v1/manifest.json')
TOKEN = 'zeer-prep-batch-private-token'
APPS = ['commitpass-api', 'nabungfi-api', 'nabungfi-keeper', 'rocket-arena', 'nginx']


def call(args, *, env=None, timeout=120):
    result = subprocess.run(args, env=env, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError('COMMAND_FAILED:' + args[0])
    return result.stdout.strip()


def inspect(name):
    return json.loads(call(['docker', 'inspect', name]))[0]


def snapshot(name):
    item = inspect(name)
    return {'name': name, 'image_id': item['Image'], 'running': item['State']['Running'], 'oom_killed': item['State']['OOMKilled'],
            'pid': item['State']['Pid'], **{key: item['HostConfig'][key] for key in ['NanoCpus', 'Memory', 'MemorySwap', 'CgroupParent']}}


def group(pid):
    return Path('/sys/fs/cgroup' + Path(f'/proc/{pid}/cgroup').read_text().strip().split('::', 1)[1])


def counters(path):
    return {key: (path / key).read_text().strip() for key in ['cpu.max', 'memory.max', 'memory.swap.max', 'memory.current', 'memory.peak', 'memory.events', 'cpu.stat']}


def quota(path, memory):
    values = counters(path)
    if values['cpu.max'] != '100000 100000' or values['memory.max'] != str(memory) or values['memory.swap.max'] != '0':
        raise RuntimeError('ACTUAL_QUOTA_MISMATCH')
    return values


def health():
    result = {name: call(['systemctl', 'is-active', name]) for name in APPS}
    available = int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))) * 1024
    if any(value != 'active' for value in result.values()) or available < 2 * 1024**3 or os.statvfs('/opt').f_bavail * os.statvfs('/opt').f_frsize < 30 * 1024**3:
        raise RuntimeError('ORIGINAL_APPS_OR_HOST_RESOURCES_UNHEALTHY')
    return {'services': result, 'available_memory': available, 'loadavg': Path('/proc/loadavg').read_text().strip()}


def stop(name):
    if inspect(name)['State']['Running']:
        call(['docker', 'stop', '--time', '10', name], timeout=25)
    if inspect(name)['State']['Running']:
        raise RuntimeError('OWNED_CONTAINER_NOT_STOPPED')


def ready_prep(endpoint):
    start = time.monotonic()
    while time.monotonic() - start < 180:
        try:
            with urlopen(Request(endpoint + '/height', headers={'Authorization': 'Bearer ' + TOKEN}), timeout=2) as response:
                meta = json.loads(response.read(65536))
            if meta.get('ready') and meta.get('network') == 'mainnet' and meta.get('payload_kind') == 'full-v1' and meta.get('start_block') == 1 and meta.get('archive_height') == 2048:
                return meta
        except (OSError, ValueError):
            pass
        time.sleep(.2)
    raise RuntimeError('PREP_ADMISSION_TIMEOUT')


def main():
    sys.path.insert(0, str(SOURCE))
    from benchmarks.prep.full.retrieval_session import execute_client
    if OUT.exists() or any(name.startswith('zeer-') for name in call(['docker', 'ps', '--format', '{{.Names}}']).splitlines()):
        raise RuntimeError('OUTPUT_EXISTS_OR_OTHER_EXPERIMENT_RUNNING')
    if inspect(NODE)['State']['Running'] or inspect(CLONE)['State']['Running']:
        raise RuntimeError('SOURCE_OR_OTHER_PG_RUNNING')
    for name in PREP.values():
        if subprocess.run(['docker', 'inspect', name], capture_output=True, timeout=10).returncode == 0:
            raise RuntimeError('NEW_PREP_CONTAINER_NAME_ALREADY_EXISTS')
    parent = Path('/sys/fs/cgroup') / SLICE
    if not group(os.getpid()).is_relative_to(parent):
        raise RuntimeError('CONTROLLER_CLIENT_SLICE_REQUIRED')
    quota(parent, 1024**3)
    network = json.loads(call(['docker', 'network', 'inspect', NETWORK]))[0]
    if not network['Internal']:
        raise RuntimeError('INTERNAL_BENCHMARK_NETWORK_REQUIRED')
    native = json.loads(Path('/opt/zeer-chef/20261014/results/cipherscan-native-final.json').read_text())
    database = native['runs'][-1]['database']
    if native['status'] != 'PASS' or native['runs'][-1]['status'] != 'PASS' or not re.fullmatch(r'chef_cs_[0-9a-f]{16}_[1-5]', database):
        raise RuntimeError('VERIFIED_NATIVE_DATABASE_REQUIRED')
    original_pg, pg_details = snapshot(PG), inspect(PG)
    configured_ports = pg_details['HostConfig']['PortBindings'].get('5432/tcp') or []
    if not any(binding['HostPort'] == '39460' and binding['HostIp'] in ('127.0.0.1', '::1') for binding in configured_ports):
        raise RuntimeError('DEDICATED_PG_BINDING_REQUIRED')
    config = dict(value.split('=', 1) for value in pg_details['Config']['Env'])
    user = config.get('POSTGRES_USER', 'postgres')
    sql_endpoint = f"postgresql://{quote(user, safe='')}:{quote(config['POSTGRES_PASSWORD'], safe='')}@127.0.0.1:39460/{database}"
    runtime_id, python_id = inspect(RUNTIME)['Id'], inspect(PYTHON)['Id']
    archive_hash = hashlib.sha256((ARCHIVE / 'catalog.json').read_bytes()).hexdigest()
    binary_hashes = {variant: hashlib.sha256((ROOT / 'bin' / ('prep-' + variant)).read_bytes()).hexdigest() for variant in PREP}
    host_before = health()
    OUT.mkdir(parents=True)
    report = {'format': 'prep-batch-before-after-sql-v1', 'status': 'RUNNING', 'eligible_for_comparison': False,
              'started_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'orchestrator_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'driver_sha256': hashlib.sha256((SOURCE / 'benchmarks/prep/full/batch_retrieval.py').read_bytes()).hexdigest(), 'archive_catalog_sha256': archive_hash,
              'binary_sha256': binary_hashes, 'runtime_image_id': runtime_id, 'client_image_id': python_id, 'native_database': database,
              'pg_original': original_pg, 'host_before': host_before, 'order': [CASES[i % 4:] + CASES[:i % 4] for i in range(5)],
              'profile': {'queried_backend_cpu': 1, 'queried_backend_memory': 2 * 1024**3, 'client_and_controller_cpu': 1, 'client_and_controller_memory': 1024**3},
              'visits': [], 'limitations': ['One queried backend at a time; source node stopped; immutable prepared archive/native SQL database.',
                 'Five cyclic rounds over four cases; one position repeats. Verified warmup followed by one timed read per visit; caches are not dropped.',
                 'Same128 normalized seven-field output; batch also checks canonical transaction positions against the independent oracle.',
                 'Startup/index admission excluded from timed reads and recorded separately; cgroup counters include startup/warmup/verification.',
                 'HTTP page/batch and native SQL access paths differ. SQL wire bytes unavailable. No ingestion or engine-only performance ranking.']}
    save = lambda: (OUT / 'session.json').write_text(json.dumps(report, indent=2) + '\n')
    save(); owned, clients, changed_pg = [], [], False
    try:
        changed_pg = True
        call(['docker', 'update', '--cpus', '1', '--memory', '2g', '--memory-swap', '2g', PG])
        for variant, name in PREP.items():
            owned.append(name)
            call(['docker', 'create', '--name', name, '--stop-signal', 'SIGINT', '--network', NETWORK,
                  '--cpus', '1', '--memory', '2g', '--memory-swap', '2g', '--pids-limit', '128', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only',
                  '-e', 'PREP_API_TOKEN=' + TOKEN, '-v', str(ROOT / 'bin' / ('prep-' + variant)) + ':/usr/local/bin/prep:ro', '-v', str(ARCHIVE) + ':/data:ro',
                  '--entrypoint', '/usr/local/bin/prep', runtime_id, 'serve-http', '--archive', '/data', '--listen', '0.0.0.0:39368', '--allow-network'])
        for number, order in enumerate(report['order'], 1):
            for position, case in enumerate(order, 1):
                variant, mode = case.split('-')
                name = PG if mode == 'sql' else PREP[variant]
                if any(inspect(other)['State']['Running'] for other in [PG, *PREP.values()] if other != name) or inspect(NODE)['State']['Running']:
                    raise RuntimeError('BACKEND_OVERLAP_OR_SOURCE_STARTED')
                prefix = f'round{number}-{case}'
                visit = {'round': number, 'position': position, 'case': case, 'status': 'STARTING', 'started_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'host_before': health(), 'file': prefix + '.json'}
                report['visits'].append(visit); save()
                started = time.monotonic(); call(['docker', 'start', name])
                if mode == 'sql':
                    live_ports = inspect(PG)['NetworkSettings']['Ports'].get('5432/tcp') or []
                    if not any(binding['HostPort'] == '39460' and binding['HostIp'] in ('127.0.0.1', '::1') for binding in live_ports):
                        raise RuntimeError('DEDICATED_PG_LIVE_BINDING_REQUIRED')
                    endpoint = sql_endpoint
                    for _ in range(120):
                        result = subprocess.run(['docker', 'exec', PG, 'pg_isready', '-U', user, '-d', database], capture_output=True, timeout=5)
                        if result.returncode == 0: break
                        time.sleep(.5)
                    else: raise RuntimeError('NATIVE_PG_NOT_READY')
                    visit['readiness'] = {'status': 'PASS'}
                else:
                    endpoint = 'http://' + inspect(name)['NetworkSettings']['Networks'][NETWORK]['IPAddress'] + ':39368'
                    visit['readiness'] = ready_prep(endpoint)
                visit['startup_seconds'] = time.monotonic() - started
                path = group(inspect(name)['State']['Pid'])
                visit.update(status='RUNNING', backend=snapshot(name), backend_cgroup_before=quota(path, 2 * 1024**3), client_slice_before=quota(parent, 1024**3)); save()
                client = 'zeer-batch-client-' + prefix; clients.append(client)
                env = os.environ.copy(); env.update(PREP_API_TOKEN=TOKEN, ZEER_BATCH_ENDPOINT=endpoint)
                call(['docker', 'create', '--name', client, '--network', 'host', '--cgroup-parent', SLICE, '--cpus', '1', '--memory', '1g', '--memory-swap', '1g',
                      '--pids-limit', '128', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only', '-e', 'PYTHONDONTWRITEBYTECODE=1',
                      '-e', 'PYTHONPATH=/deps:/generated:/work', '-e', 'ZEER_BATCH_ENDPOINT', '-e', 'PREP_API_TOKEN',
                      '-v', DEPS + ':/deps:ro', '-v', GENERATED + ':/generated:ro', '-v', str(SOURCE) + ':/work:ro', '-v', str(OUT) + ':/results', '-w', '/work', python_id,
                      'python', '-m', 'benchmarks.prep.full.batch_retrieval', '--case', mode, '--endpoint-env', 'ZEER_BATCH_ENDPOINT', '--oracle', str(ORACLE),
                      '--manifest', str(MANIFEST), '--out', '/results/' + visit['file'], '--round', str(number), '--timeout-seconds', '300'], env=env)
                try:
                    result = execute_client(client)
                except Exception as error:
                    visit.update(status='FAIL', client_error_type=type(error).__name__, outer_process_timeout=isinstance(error, subprocess.TimeoutExpired))
                    (OUT / (prefix + '.client.txt')).write_text('Client failed: ' + type(error).__name__ + '\n')
                    save(); raise
                (OUT / (prefix + '.client.txt')).write_text(result.stdout + result.stderr)
                visit.update(client_exit_code=result.returncode, client=snapshot(client), backend_cgroup_after=counters(path), client_slice_after=counters(parent))
                if visit['client']['NanoCpus'] != 10**9 or visit['client']['Memory'] != 1024**3 or visit['client']['CgroupParent'] != SLICE:
                    raise RuntimeError('CLIENT_RESOURCE_MISMATCH')
                observed = json.loads((OUT / visit['file']).read_text())
                expected_requests = 1 if mode == 'batch' else 16 if mode == 'query' else None
                if result.returncode or observed['status'] != 'PASS' or observed['run']['rows'] != 128 or observed['warmup']['rows'] != 128 or observed['run']['sha256'] != observed['warmup']['sha256']:
                    raise RuntimeError('VISIT_OUTPUT_FAILED')
                if expected_requests is not None and any(observed[stage]['requests'] != expected_requests for stage in ['warmup', 'run']):
                    raise RuntimeError('VISIT_REQUEST_COUNT_MISMATCH')
                visit.update(status='PASS', elapsed_ns=observed['run']['retrieval_normalize_ns'], result_hash=observed['run']['sha256'], requests=observed['run']['requests'],
                             response_bytes=observed['run']['response_bytes'], report_sha256=hashlib.sha256((OUT / visit['file']).read_bytes()).hexdigest(), finished_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
                stop(name); save(); print(json.dumps({key: visit[key] for key in ['round', 'case', 'elapsed_ns', 'requests', 'response_bytes']}), flush=True)
        records = [json.loads((OUT / visit['file']).read_text()) for visit in report['visits']]
        if len(records) != 20 or any(row['status'] != 'PASS' for row in records): raise RuntimeError('TWENTY_PASS_VISITS_REQUIRED')
        for key in ['oracle_sha256', 'manifest_sha256', 'runner_sha256', 'range', 'timing_boundary']:
            if any(row[key] != records[0][key] for row in records): raise RuntimeError('SESSION_IDENTITY_MISMATCH')
        if records[0]['runner_sha256'] != report['driver_sha256']:
            raise RuntimeError('EXECUTED_DRIVER_IDENTITY_MISMATCH')
        if len({row[stage]['sha256'] for row in records for stage in ['warmup', 'run']}) != 1: raise RuntimeError('CROSS_CASE_FIELD_DIGEST_MISMATCH')
        report['summary'] = {}
        for case in CASES:
            visits = [visit for visit in report['visits'] if visit['case'] == case]
            if len(visits) != 5 or {visit['round'] for visit in visits} != {1, 2, 3, 4, 5}: raise RuntimeError('MISSING_FIVE_ROUNDS')
            values = [visit['elapsed_ns'] for visit in visits]
            case_reports = [json.loads((OUT / visit['file']).read_text()) for visit in visits]
            if any(item['initial_source'] != case_reports[0]['initial_source'] or item['final_source'] != case_reports[0]['final_source'] for item in case_reports):
                raise RuntimeError('CASE_SOURCE_IDENTITY_CHANGED')
            report['summary'][case] = {'repetitions': 5, 'median_ms': statistics.median(values) / 1e6, 'min_ms': min(values) / 1e6, 'max_ms': max(values) / 1e6,
                                      'requests': [visit['requests'] for visit in visits], 'response_bytes': [visit['response_bytes'] for visit in visits]}
        if hashlib.sha256((ARCHIVE / 'catalog.json').read_bytes()).hexdigest() != archive_hash: raise RuntimeError('ARCHIVE_CATALOG_CHANGED')
        if any(hashlib.sha256((ROOT / 'bin' / ('prep-' + variant)).read_bytes()).hexdigest() != digest for variant, digest in binary_hashes.items()): raise RuntimeError('BINARY_CHANGED')
        report.update(status='PASS', eligible_for_comparison=True)
    except Exception as error:
        report.update(status='FAIL', eligible_for_comparison=False, failure_type=type(error).__name__, failure_code=str(error) if isinstance(error, RuntimeError) else 'BATCH_SESSION_FAILED')
        if report['visits'] and report['visits'][-1]['status'] != 'PASS':
            report['visits'][-1].update(status='FAIL', failure_type=type(error).__name__)
        raise
    finally:
        signal.signal(signal.SIGINT, signal.SIG_IGN); signal.signal(signal.SIGTERM, signal.SIG_IGN)
        errors = []
        def cleanup(label, action):
            try: action()
            except Exception as error: errors.append({'action': label, 'error_type': type(error).__name__})
        for name in clients + owned + [PG]: cleanup('stop:' + name, lambda name=name: stop(name))
        if changed_pg:
            cleanup('restore_pg', lambda: call(['docker', 'update', '--cpus', str(original_pg['NanoCpus'] / 10**9), '--memory', str(original_pg['Memory']), '--memory-swap', str(original_pg['MemorySwap']), PG]))
        report['final_containers'] = {}
        for name in owned + [PG, NODE, CLONE]: cleanup('inspect:' + name, lambda name=name: report['final_containers'].update({name: snapshot(name)}))
        if len(report['final_containers']) != len(owned) + 3 or any(item['running'] for item in report['final_containers'].values()): errors.append({'action': 'verify_stopped', 'error_type': 'OwnedContainerRunningOrSnapshotMissing'})
        if any(report['final_containers'].get(PG, {}).get(key) != original_pg[key] for key in ['NanoCpus', 'Memory', 'MemorySwap']): errors.append({'action': 'verify_pg_restored', 'error_type': 'PgQuotaMismatch'})
        cleanup('original_apps', lambda: report.update(host_after=health()))
        report['cleanup_errors'] = errors
        if errors: report.update(status='FAIL', eligible_for_comparison=False)
        report['finished_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat(); save()


if __name__ == '__main__':
    def interrupt(signum, frame): raise RuntimeError('SESSION_INTERRUPTED')
    signal.signal(signal.SIGINT, interrupt); signal.signal(signal.SIGTERM, interrupt)
    main()
