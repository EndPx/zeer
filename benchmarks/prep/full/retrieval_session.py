"""Prepared, six-source retrieval session on preserved Zeer benchmark containers.

Root launches this controller inside zeerretrievalclient.slice (1 CPU/512 MiB).
No source construction, DDL, database drops, public ports or image installation.
"""
import argparse
import datetime
import gzip
import hashlib
import json
import os
import re
from pathlib import Path
import signal
import statistics
import subprocess
import sys
import time
from urllib.parse import quote
from urllib.request import Request, urlopen

SOURCE = Path('/opt/zeer-chef/20261014-opt/after')
OUT = Path('/opt/zeer-prep/20261014-retrieval')
NETWORK = 'zeer-bench-four-frozen'
NODE, PG, PREP = 'zeer-bench-four-frozen', 'zeer-chef-pg', 'zeer-chef-prep-http'
CLIENT_SLICE = 'zeerretrievalclient.slice'
BASE = ['prep', 'rpc', 'cipherscan', 'lwd', 'zinder', 'zaino']
PROVIDERS = {'prep': PREP, 'rpc': NODE, 'cipherscan': PG, 'lwd': 'zeer-bench-four-lightwalletd',
             'zinder': 'zeer-bench-four-zinder', 'zaino': 'zeer-bench-four-zaino'}
ORACLE = Path('benchmarks/fixtures/mainnet-public-2048/oracle.json.gz')
MANIFEST = Path('benchmarks/fixtures/mainnet-transactions-v1/manifest.json')
PYTHON_IMAGE = 'python@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1'
DEPS, GENERATED = '/opt/zeer-bench/20261013/state/client/deps', '/opt/zeer-bench/20261013/state/client/generated'
TOKEN = 'zeer-chef-prep-private-token'
NATIVE_REPORT = Path('/opt/zeer-chef/20261014/results/cipherscan-native-final.json')
CLIENT_PREFIX = 'zeer-retrieval-client-'
PREP_PROJECTION = 'decoded'
PREP_SPARSE_ACCESS = 'query'
SERVICES = ['commitpass-api', 'nabungfi-api', 'nabungfi-keeper', 'rocket-arena', 'nginx']


def run(args, *, env=None, timeout=120):
    result = subprocess.run(args, env=env, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError('COMMAND_FAILED:' + args[0])
    return result.stdout.strip()


def inspect(name):
    return json.loads(run(['docker', 'inspect', name]))[0]


def ip(name):
    return inspect(name)['NetworkSettings']['Networks'][NETWORK]['IPAddress']


def snapshot(name):
    item = inspect(name)
    return {'name': name, 'image_id': item['Image'], 'running': item['State']['Running'],
            'oom_killed': item['State']['OOMKilled'], 'pid': item['State']['Pid'],
            **{key: item['HostConfig'][key] for key in ['NanoCpus', 'Memory', 'MemorySwap', 'CgroupParent']}}


def process_group(pid):
    relative = Path(f'/proc/{pid}/cgroup').read_text().strip().split('::', 1)[1]
    return Path('/sys/fs/cgroup' + relative)


def counters(path):
    return {key: (path / key).read_text().strip() for key in ['cpu.max', 'memory.max', 'memory.swap.max', 'cpu.stat', 'memory.events', 'memory.peak']}


def quota(path, memory):
    result = counters(path)
    if result['cpu.max'] != '100000 100000' or result['memory.max'] != str(memory) or result['memory.swap.max'] != '0':
        raise RuntimeError('ACTUAL_CGROUP_QUOTA_MISMATCH')
    return result


def health():
    result = {name: run(['systemctl', 'is-active', name]) for name in SERVICES}
    if any(value != 'active' for value in result.values()):
        raise RuntimeError('ORIGINAL_SERVICE_NOT_ACTIVE')
    available = int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))) * 1024
    if available < 2 * 1024**3 or os.statvfs('/opt').f_bavail * os.statvfs('/opt').f_frsize < 30 * 1024**3:
        raise RuntimeError('HOST_RESOURCE_GUARD')
    return {'services': result, 'available_memory': available, 'loadavg': Path('/proc/loadavg').read_text().strip()}


def stop(name, grace=30):
    if inspect(name)['State']['Running']:
        run(['docker', 'stop', '--time', str(grace), name], timeout=grace + 15)
    if inspect(name)['State']['Running']:
        raise RuntimeError('OWNED_CONTAINER_NOT_STOPPED')


def execute_client(name):
    process = subprocess.Popen(['docker', 'start', '--attach', name], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        stdout, stderr = process.communicate(timeout=420)
        return subprocess.CompletedProcess(process.args, process.returncode, stdout, stderr)
    finally:
        # Keep the attached start alive while stopping: a stop issued in the
        # created state may race daemon startup, so retry until start settles.
        deadline = time.monotonic() + 45
        while process.poll() is None and time.monotonic() < deadline:
            subprocess.run(['docker', 'stop', '--time', '10', name], capture_output=True, timeout=20)
            try:
                process.communicate(timeout=1)
            except subprocess.TimeoutExpired:
                pass
        if process.poll() is None:
            process.kill(); process.communicate(timeout=5)
            raise RuntimeError('CLIENT_START_DID_NOT_SETTLE')
        stop(name, grace=10)


def ready(candidate, endpoint, dataset):
    start = time.monotonic()
    if candidate in ('lwd', 'zinder', 'zaino'):
        from benchmarks.chef.session_lookup import await_readiness
        from benchmarks.transactions.benchmark import GrpcTransactionAdapter
        adapter, result = await_readiness(lambda: GrpcTransactionAdapter(endpoint), dataset, seconds=180)
        adapter.close()
        return result
    while time.monotonic() - start < 180:
        try:
            if candidate == 'cipherscan':
                user = dict(value.split('=', 1) for value in inspect(PG)['Config']['Env']).get('POSTGRES_USER', 'postgres')
                run(['docker', 'exec', PG, 'pg_isready', '-U', user, '-d', CS_DATABASE], timeout=5)
            else:
                payload = None if candidate == 'prep' else json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'getblockchaininfo', 'params': []}).encode()
                request = Request(endpoint.rstrip('/') + ('/height' if candidate == 'prep' else '/'), data=payload,
                                  headers={'content-type': 'application/json', 'authorization': 'Bearer ' + TOKEN})
                with urlopen(request, timeout=3) as response:
                    value = json.loads(response.read(1024 * 1024))
                if candidate == 'prep':
                    if not value.get('ready') or value.get('archive_height', 0) < 2048:
                        raise RuntimeError('PREP_NOT_READY')
                elif value.get('error') or value.get('result', {}).get('blocks') != dataset['end_height'] or value['result']['bestblockhash'] != dataset['end_hash']:
                    raise RuntimeError('FROZEN_HEAD_NOT_READY')
            return {'status': 'PASS', 'elapsed_seconds': time.monotonic() - start}
        except Exception:
            time.sleep(1)
    raise RuntimeError('BACKEND_READINESS_TIMEOUT')


def configure(argv=None):
    """Choose fresh session locations without changing resource or workload bounds."""
    global SOURCE, OUT, PREP, NATIVE_REPORT, CLIENT_PREFIX, TOKEN, PREP_PROJECTION, PREP_SPARSE_ACCESS
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=SOURCE)
    parser.add_argument('--out', type=Path, default=OUT)
    parser.add_argument('--prep-container', default=PREP)
    parser.add_argument('--native-report', type=Path, default=NATIVE_REPORT)
    parser.add_argument('--client-prefix', default=CLIENT_PREFIX)
    parser.add_argument('--token-env')
    parser.add_argument('--prep-projection', choices=('decoded', 'metadata'), default=PREP_PROJECTION)
    parser.add_argument('--prep-sparse-access', choices=('query', 'batch'), default=PREP_SPARSE_ACCESS)
    args = parser.parse_args(argv)
    if args.prep_sparse_access == 'batch' and args.prep_projection != 'metadata':
        parser.error('batch sparse access requires metadata projection')
    if not args.source.is_absolute() or not args.out.is_absolute() or not args.native_report.is_absolute():
        parser.error('source, out and native-report must be absolute paths')
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}', args.prep_container):
        parser.error('invalid Prep container name')
    if args.prep_container in {value for key, value in PROVIDERS.items() if key != 'prep'}:
        parser.error('Prep container must differ from all other providers')
    if not re.fullmatch(r'zeer-retrieval-client-[a-z0-9-]{0,32}', args.client_prefix):
        parser.error('client prefix must start with zeer-retrieval-client-')
    if args.token_env:
        if not re.fullmatch(r'[A-Z][A-Z0-9_]{0,63}', args.token_env) or not os.environ.get(args.token_env):
            parser.error('token environment variable must exist and be nonempty')
        TOKEN = os.environ[args.token_env]
    SOURCE, OUT, PREP = args.source, args.out, args.prep_container
    NATIVE_REPORT, CLIENT_PREFIX, PREP_PROJECTION = args.native_report, args.client_prefix, args.prep_projection
    PREP_SPARSE_ACCESS = args.prep_sparse_access
    PROVIDERS['prep'] = PREP


def main():
    global CS_DATABASE
    sys.path[:0] = [str(SOURCE), DEPS, GENERATED]
    guarded = list(dict.fromkeys([NODE, PREP, 'zeer-chef-prep-http', PG, 'zeer-lookup-chef-pg', *[PROVIDERS[key] for key in ('lwd', 'zinder', 'zaino')]]))
    if OUT.exists() or any(inspect(name)['State']['Running'] for name in guarded):
        raise RuntimeError('OUTPUT_EXISTS_OR_BENCHMARK_ALREADY_RUNNING')
    client_group = Path('/sys/fs/cgroup') / CLIENT_SLICE
    if not process_group(os.getpid()).is_relative_to(client_group):
        raise RuntimeError('CONTROLLER_MUST_SHARE_CLIENT_SLICE')
    quota(client_group, 512 * 1024**2)
    manifest = json.loads((SOURCE / MANIFEST).read_text())
    with gzip.open(SOURCE / ORACLE, 'rt') as source:
        oracle = json.load(source)
    if oracle['source']['height'] != manifest['end_height'] or oracle['source']['hash'] != manifest['end_hash']:
        raise RuntimeError('ORACLE_MANIFEST_SOURCE_MISMATCH')
    native = json.loads(NATIVE_REPORT.read_text())
    CS_DATABASE = native['runs'][-1]['database']
    if native['status'] != 'PASS' or native['runs'][-1]['status'] != 'PASS' or not re.fullmatch(r'chef_cs_[0-9a-f]{16}_[1-5]', CS_DATABASE):
        raise RuntimeError('NATIVE_BENCHMARK_DATABASE_REQUIRED')
    names = list(dict.fromkeys(PROVIDERS.values()))
    originals = {name: snapshot(name) for name in names}
    if originals[NODE]['NanoCpus'] != 10**9 or originals[NODE]['Memory'] != 2 * 1024**3:
        raise RuntimeError('FROZEN_SOURCE_RESOURCE_MISMATCH')
    image_id = inspect(PYTHON_IMAGE)['Id']
    OUT.mkdir()
    session = {'format': 'six-source-prepared-retrieval-session-v1', 'status': 'RUNNING', 'eligible_for_comparison': False,
               'started_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'orchestrator_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
               'driver_sha256': hashlib.sha256((SOURCE / 'benchmarks/prep/full/retrieval.py').read_bytes()).hexdigest(), 'client_image_id': image_id,
               'source_directory': str(SOURCE), 'native_report': str(NATIVE_REPORT), 'prep_projection': PREP_PROJECTION, 'prep_sparse_access': PREP_SPARSE_ACCESS,
               'order': [BASE[i:] + BASE[:i] for i in range(5)], 'initial_containers': originals, 'host_before': health(), 'visits': [],
               'profile': {'queried_backend_cpu': 1, 'queried_backend_memory': 2 * 1024**3, 'source_cpu': 1, 'source_memory': 2 * 1024**3,
                           'client_and_controller_cpu': 1, 'client_and_controller_memory': 512 * 1024**2},
               'limitations': ['Prepared source retrieval, not node synchronization or application entity indexing.', 'Five rotations of six candidates cover five distinct positions per candidate; caches are not dropped.',
                              'RPC queries the source itself; the shared source remains available to other backends, which may query it while serving. Both resource ceilings are included in the aggregate profile.', 'Cgroup counters include readiness, warmup and all workloads, not isolated timed-request CPU.',
                              'Only sparse raw-transaction retrieval is validated for these gRPC adapters; early full-header and complete public-transaction scans are not validated in this session.']}
    save = lambda: (OUT / 'session.json').write_text(json.dumps(session, indent=2) + '\n')
    save()
    clients, changed = [], []
    try:
        for name in names:
            changed.append(name)
            run(['docker', 'update', '--cpus', '1', '--memory', '2g', '--memory-swap', '2g', name])
        run(['docker', 'start', NODE]); source_url = 'http://' + ip(NODE) + ':8232'
        session['source_readiness'] = ready('rpc', source_url, manifest)
        session['source_cgroup'] = quota(process_group(inspect(NODE)['State']['Pid']), 2 * 1024**3)
        for round_number, order in enumerate(session['order'], 1):
            for position, candidate in enumerate(order, 1):
                name = PROVIDERS[candidate]
                if candidate != 'rpc':
                    run(['docker', 'start', name])
                group = process_group(inspect(name)['State']['Pid'])
                if candidate == 'rpc':
                    endpoint = source_url
                elif candidate == 'prep':
                    endpoint = 'http://' + ip(name) + ':39368'
                elif candidate == 'cipherscan':
                    config = dict(value.split('=', 1) for value in inspect(name)['Config']['Env'])
                    endpoint = f"postgresql://{quote(config.get('POSTGRES_USER', 'postgres'), safe='')}:{quote(config['POSTGRES_PASSWORD'], safe='')}@127.0.0.1:39460/{CS_DATABASE}"
                else:
                    endpoint = 'grpc://' + ip(name) + (':8137' if candidate == 'zaino' else ':9067')
                admission = ready(candidate, endpoint, manifest)
                for workload in (['headers', 'transactions', 'sparse'] if candidate in ('prep', 'rpc', 'cipherscan') else ['sparse']):
                    prefix = f'round{round_number}-{candidate}-{workload}'
                    visit = {'round': round_number, 'position': position, 'candidate': candidate, 'workload': workload, 'status': 'RUNNING',
                             'readiness': admission, 'host_before': health(), 'backend': snapshot(name), 'backend_cgroup_before': quota(group, 2 * 1024**3),
                             'source_cgroup_before': quota(process_group(inspect(NODE)['State']['Pid']), 2 * 1024**3),
                             'client_slice_before': quota(client_group, 512 * 1024**2), 'report_file': prefix + '.json'}
                    session['visits'].append(visit); save()
                    client = CLIENT_PREFIX + prefix; clients.append(client)
                    env = os.environ.copy(); env.update(ZEER_RETRIEVAL_ENDPOINT=endpoint, PREP_API_TOKEN=TOKEN)
                    create = ['docker', 'create', '--name', client, '--network', 'host', '--cgroup-parent', CLIENT_SLICE, '--cpus', '1', '--memory', '512m', '--memory-swap', '512m',
                              '--pids-limit', '128', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only', '-e', 'PYTHONDONTWRITEBYTECODE=1',
                              '-e', 'PYTHONPATH=/deps:/generated:/work', '-e', 'ZEER_RETRIEVAL_ENDPOINT', '-e', 'PREP_API_TOKEN',
                              '-v', DEPS + ':/deps:ro', '-v', GENERATED + ':/generated:ro', '-v', str(SOURCE) + ':/work:ro', '-v', str(OUT) + ':/results', '-w', '/work', image_id,
                              'python', '-m', 'benchmarks.prep.full.retrieval', '--candidate', candidate, '--workload', workload, '--endpoint-env', 'ZEER_RETRIEVAL_ENDPOINT',
                              '--oracle', '/work/' + str(ORACLE), '--manifest', '/work/' + str(MANIFEST), '--out', '/results/' + visit['report_file'], '--round', str(round_number), '--timeout-seconds', '300']
                    if candidate == 'prep':
                        create.extend(['--prep-projection', PREP_PROJECTION])
                        if workload == 'sparse':
                            create.extend(['--prep-access', PREP_SPARSE_ACCESS])
                    run(create, env=env)
                    try:
                        result = execute_client(client)
                    except Exception as error:
                        visit.update(status='FAIL', client_error_type=type(error).__name__, outer_process_timeout=isinstance(error, subprocess.TimeoutExpired))
                        (OUT / (prefix + '.client.txt')).write_text('Client failed: ' + type(error).__name__ + '\n')
                        save(); raise
                    (OUT / (prefix + '.client.txt')).write_text(result.stdout + result.stderr)
                    visit.update(client_exit_code=result.returncode, client=snapshot(client), backend_cgroup_after=counters(group), client_slice_after=counters(client_group))
                    if visit['client']['NanoCpus'] != 10**9 or visit['client']['Memory'] != 512 * 1024**2 or visit['client']['CgroupParent'] != CLIENT_SLICE:
                        raise RuntimeError('CLIENT_QUOTA_OR_PARENT_MISMATCH')
                    if result.returncode:
                        visit['status'] = 'FAIL'; save(); raise RuntimeError('RETRIEVAL_VISIT_FAILED')
                    report = json.loads((OUT / visit['report_file']).read_text())
                    if report['status'] != 'PASS' or report['warmup']['sha256'] != report['run']['sha256']:
                        raise RuntimeError('RETRIEVAL_PROJECTION_FAILED')
                    visit.update(status='PASS', elapsed_ns=report['run']['retrieval_normalize_ns'], sha256=report['run']['sha256'], report_sha256=hashlib.sha256((OUT / visit['report_file']).read_bytes()).hexdigest())
                    save(); print(json.dumps({key: visit[key] for key in ('round', 'candidate', 'workload', 'elapsed_ns')}), flush=True)
                if candidate != 'rpc':
                    stop(name)
        reports = [json.loads((OUT / visit['report_file']).read_text()) for visit in session['visits']]
        if len(reports) != 60:
            raise RuntimeError('EXPECTED_SIXTY_VISITS')
        for key in ['oracle_sha256', 'manifest_sha256', 'runner_sha256', 'range', 'timing_boundary']:
            if any(report[key] != reports[0][key] for report in reports):
                raise RuntimeError('SESSION_IDENTITY_MISMATCH')
        session['summary'] = {}
        for workload in ['headers', 'transactions', 'sparse']:
            subset = [report for report in reports if report['workload'] == workload]
            if len({report['run']['sha256'] for report in subset}) != 1 or len({report['warmup']['sha256'] for report in subset}) != 1:
                raise RuntimeError('CROSS_CANDIDATE_FIELD_DIGEST_MISMATCH')
            for candidate in (BASE if workload == 'sparse' else BASE[:3]):
                rows = [report for report in subset if report['candidate'] == candidate]
                if len(rows) != 5 or {row['round'] for row in rows} != {1, 2, 3, 4, 5}:
                    raise RuntimeError('MISSING_FIVE_ROUNDS')
                values = [row['run']['retrieval_normalize_ns'] for row in rows]
                session['summary'][candidate + '-' + workload] = {'repetitions': 5, 'rows': rows[0]['run']['rows'], 'median_ms': statistics.median(values) / 1e6, 'min_ms': min(values) / 1e6, 'max_ms': max(values) / 1e6}
        session.update(status='PASS', eligible_for_comparison=True)
    except Exception as error:
        session.update(status='FAIL', eligible_for_comparison=False, failure_type=type(error).__name__, failure_code=str(error) if isinstance(error, RuntimeError) else 'SESSION_FAILED')
        raise
    finally:
        signal.signal(signal.SIGINT, signal.SIG_IGN); signal.signal(signal.SIGTERM, signal.SIG_IGN)
        errors = []
        def cleanup(label, action):
            try:
                action()
            except Exception as error:
                errors.append({'action': label, 'error_type': type(error).__name__})
        for name in clients + names:
            cleanup('stop:' + name, lambda name=name: stop(name, 10 if name.startswith('zeer-retrieval-client-') else 30))
        for name in changed:
            original = originals[name]
            cleanup('restore:' + name, lambda name=name, original=original: run(['docker', 'update', '--cpus', str(original['NanoCpus'] / 10**9), '--memory', str(original['Memory']), '--memory-swap', str(original['MemorySwap']), name]))
        cleanup('original_services_health', lambda: session.update(host_after=health()))
        session['final_containers'] = {}
        for name in names:
            cleanup('inspect_final:' + name, lambda name=name: session['final_containers'].update({name: snapshot(name)}))
        if len(session['final_containers']) != len(names) or any(value['running'] or any(value[key] != originals[name][key] for key in ('NanoCpus', 'Memory', 'MemorySwap')) for name, value in session['final_containers'].items()):
            errors.append({'action': 'verify_restored', 'error_type': 'ResourceOrLifecycleMismatch'})
        session['cleanup_errors'] = errors
        if errors:
            session.update(status='FAIL', eligible_for_comparison=False)
        session['finished_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat(); save()


if __name__ == '__main__':
    configure()
    def interrupt(signum, frame):
        raise RuntimeError('SESSION_INTERRUPTED')
    signal.signal(signal.SIGINT, interrupt); signal.signal(signal.SIGTERM, interrupt)
    main()
