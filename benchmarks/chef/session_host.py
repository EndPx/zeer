"""Bounded Hostinger reproduction recipe for the five-candidate lookup session.

Runs only against previously prepared Zeer benchmark state. No provisioning,
database migrations, candidate source changes or public ports are performed.
"""
import datetime
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import statistics
import signal
import subprocess
import time
from urllib.parse import quote

ROOT = Path('/opt/zeer-chef/20261014')
SOURCE = ROOT / 'source'
OUT = ROOT / 'lookup-session'
NETWORK = 'zeer-bench-four-frozen'
NODE = 'zeer-bench-four-frozen'
CHEF_PG = 'zeer-lookup-chef-pg'
SLICE = 'zeerlookup.slice'
CLIENT_SLICE = 'zeerlookupclient.slice'
API_UNIT = 'zeer-lookup-chef-api'
CLIENT_PREFIX = 'zeer-lookup-client-'
REPORT = ROOT / 'results/indexing-prep-v2.json'
PYTHON_IMAGE = 'python@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1'
PROVIDERS = {'cipherscan': 'zeer-bench-four-pg', 'zinder': 'zeer-bench-four-zinder',
             'zaino': 'zeer-bench-four-zaino', 'lightwalletd': 'zeer-bench-four-lightwalletd'}
VERSIONS = {'chef': '444ebcc59243231ef2ed83bb2aaf73667b65cf95', 'cipherscan': '15d7f528f07a84d796ed89029de21bfb26a24d23',
            'zinder': '0.6.0', 'zaino': '0.10.1', 'lightwalletd': '0.5.5'}
BASE_ORDER = ['chef', 'cipherscan', 'zinder', 'zaino', 'lightwalletd']
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


def environment(item):
    return dict(value.split('=', 1) for value in item['Config']['Env'])


def snapshot(name):
    value = inspect(name)
    host = value['HostConfig']
    return {'name': name, 'image_id': value['Image'], 'running': value['State']['Running'],
            'oom_killed': value['State']['OOMKilled'], 'cpu_limit': host['NanoCpus'] / 1e9,
            'memory_limit': host['Memory'], 'cgroup_parent': host['CgroupParent'],
            'published_ports': host['PortBindings'], 'pid': value['State']['Pid']}


def cgroup(path):
    return {name: (path / name).read_text().strip() for name in ['cpu.max', 'memory.max', 'memory.swap.max', 'cpu.stat', 'memory.events', 'memory.peak']}


def process_cgroup(pid):
    rel = Path(f'/proc/{pid}/cgroup').read_text().strip().split('::', 1)[1]
    return Path('/sys/fs/cgroup' + rel)


def own_slice(name, memory):
    path = Path('/run/systemd/system') / name
    content = f'[Unit]\nDescription=Zeer isolated lookup benchmark\n[Slice]\nCPUQuota=100%\nMemoryMax={memory}\nMemorySwapMax=0\nTasksMax=512\n'
    if path.exists() and path.read_text() != content:
        raise RuntimeError('EXISTING_SLICE_CONFLICT')
    path.write_text(content)
    run(['systemctl', 'daemon-reload'])
    run(['systemctl', 'start', name])
    run(['systemctl', 'set-property', '--runtime', name, 'CPUQuota=100%', 'MemoryMax=' + memory, 'MemorySwapMax=0'])


def health():
    states = {name: run(['systemctl', 'is-active', name]) for name in SERVICES}
    if any(value != 'active' for value in states.values()):
        raise RuntimeError('EXISTING_SERVICE_NOT_ACTIVE')
    available = int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))) * 1024
    if available < 2 * 1024**3 or os.statvfs('/opt').f_bavail * os.statvfs('/opt').f_frsize < 30 * 1024**3:
        raise RuntimeError('HOST_RESOURCE_GUARD')
    return {'services': states, 'available_memory': available, 'loadavg': Path('/proc/loadavg').read_text().strip()}


def stop_candidate(candidate):
    if candidate == 'chef':
        subprocess.run(['systemctl', 'stop', API_UNIT], capture_output=True)
        state = subprocess.run(['systemctl', 'is-active', API_UNIT], capture_output=True, text=True).stdout.strip()
        if state not in {'inactive', 'failed', 'unknown'}:
            raise RuntimeError('CHEF_API_NOT_STOPPED')
        if inspect(CHEF_PG)['State']['Running']:
            run(['docker', 'stop', '--time', '30', CHEF_PG])
    elif inspect(PROVIDERS[candidate])['State']['Running']:
        run(['docker', 'stop', '--time', '30', PROVIDERS[candidate]])
    if inspect(CHEF_PG if candidate == 'chef' else PROVIDERS[candidate])['State']['Running']:
        raise RuntimeError('CANDIDATE_NOT_STOPPED')


def save(session):
    (OUT / 'session.json').write_text(json.dumps(session, indent=2) + '\n')


def main():
    if OUT.exists():
        raise RuntimeError('SESSION_OUTPUT_EXISTS')
    if subprocess.run(['docker', 'container', 'inspect', CHEF_PG], capture_output=True).returncode == 0:
        raise RuntimeError('SESSION_PG_ALREADY_EXISTS')
    if run(['systemctl', 'show', API_UNIT, '--property=LoadState', '--value']) != 'not-found':
        raise RuntimeError('SESSION_API_UNIT_ALREADY_EXISTS')
    initial = [NODE, 'zeer-chef-pg', *PROVIDERS.values()]
    if any(inspect(name)['State']['Running'] for name in initial):
        raise RuntimeError('BENCHMARK_SERVICE_ALREADY_RUNNING')
    pg_mounts = {mount['Source'] for mount in inspect('zeer-chef-pg')['Mounts']}
    for name in run(['docker', 'ps', '--format', '{{.Names}}']).splitlines():
        if pg_mounts.intersection(mount['Source'] for mount in inspect(name)['Mounts']):
            raise RuntimeError('POSTGRES_SHARED_MOUNT_IN_USE')
    OUT.mkdir()
    session = {'format': 'five-candidate-rotated-lookup-v1', 'status': 'RUNNING',
               'started_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'orchestrator_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
               'order': [BASE_ORDER[i:] + BASE_ORDER[:i] for i in range(5)],
               'profile': {'source_cpu': 1, 'source_memory': 2 * 1024**3, 'candidate_cpu': 1,
                           'candidate_memory': 4 * 1024**3, 'client_cpu': 1, 'client_memory': 512 * 1024**2},
               'host_before': health(), 'initial_containers': [snapshot(name) for name in initial], 'visits': [],
               'limitations': ['Prepared serving only; startup, warmup, source checks and output verification excluded from lookup timing.',
                              'Same seven-field output; native SQL, GraphQL and gRPC paths perform different work.',
                              'Five rotated positions per candidate; OS caches are not dropped and shared-host activity remains.',
                              'Chef prepared coverage ends at 2048; other serving stores/source reach 6764. Selected records are identical.',
                              'Chef API and PostgreSQL share one enforced 1 CPU / 4 GiB parent cgroup; each other native stack has the same aggregate ceiling.',
                              'Cgroup counters include readiness/warmup and are not isolated timed-request CPU measurements.']}
    save(session)
    active = None
    client_name = None
    try:
        own_slice(SLICE, '4G')
        own_slice(CLIENT_SLICE, '512M')
        original = inspect('zeer-chef-pg')
        args = ['docker', 'create', '--name', CHEF_PG, '--network', NETWORK,
                '--cgroup-parent', SLICE, '--cpus', '1', '--memory', '4g', '--memory-swap', '4g', '--pids-limit', '256']
        for key, value in environment(original).items():
            if key.startswith('POSTGRES_'):
                args += ['-e', f'{key}={value}']
        for mount in original['Mounts']:
            if not mount['Source'].startswith('/opt/zeer-chef/20261014/'):
                raise RuntimeError('UNEXPECTED_CHEF_MOUNT')
            args += ['--mount', f"type=bind,src={mount['Source']},dst={mount['Destination']}"]
        run(args + [original['Image']])
        source = snapshot(NODE)
        if source['cpu_limit'] != 1 or source['memory_limit'] != 2 * 1024**3:
            raise RuntimeError('SOURCE_RESOURCE_MISMATCH')
        for name in PROVIDERS.values():
            value = snapshot(name)
            if value['cpu_limit'] != 1 or value['memory_limit'] != 4 * 1024**3:
                raise RuntimeError('CANDIDATE_RESOURCE_MISMATCH')
        run(['docker', 'start', NODE])
        source_url = 'http://' + ip(NODE) + ':8232'
        session['source_active'] = snapshot(NODE)
        for round_number, order in enumerate(session['order'], 1):
            for position, candidate in enumerate(order, 1):
                active = candidate
                visit = {'round': round_number, 'position': position, 'candidate': candidate, 'host_before': health()}
                session['visits'].append(visit)
                save(session)
                if candidate == 'chef':
                    if inspect('zeer-chef-pg')['State']['Running']:
                        raise RuntimeError('CHEF_VOLUME_ALREADY_IN_USE')
                    run(['docker', 'start', CHEF_PG])
                    for _ in range(30):
                        ready = subprocess.run(['docker', 'exec', CHEF_PG, 'pg_isready', '-U', 'chef', '-d', 'chef_test'], capture_output=True)
                        if ready.returncode == 0:
                            break
                        time.sleep(1)
                    else:
                        raise RuntimeError('CHEF_PG_NOT_READY')
                    env = os.environ.copy()
                    pg_env = environment(original)
                    env['DATABASE_URL'] = f"postgres://chef:{quote(pg_env['POSTGRES_PASSWORD'], safe='')}@{ip(CHEF_PG)}:5432/chef_test"
                    env['CHEF_API_TOKEN'] = 'zeer-lookup-session-private-token'
                    run(['systemd-run', '--unit=' + API_UNIT, '--collect', '--slice=' + SLICE,
                         '--property=WorkingDirectory=' + str(SOURCE), '--setenv=DATABASE_URL', '--setenv=CHEF_API_TOKEN',
                         '/usr/bin/node', str(SOURCE / 'benchmarks/chef/serve.mjs'), '--report', str(REPORT),
                         '--config', str(SOURCE / 'examples/chef-public/chef.config.ts'), '--port', '39370'], env=env)
                    endpoint = 'http://127.0.0.1:39370/graphql'
                    candidate_path = Path('/sys/fs/cgroup') / SLICE
                    visit['container'] = snapshot(CHEF_PG)
                    assert process_cgroup(visit['container']['pid']).is_relative_to(candidate_path)
                    api_group = run(['systemctl', 'show', API_UNIT, '--property=ControlGroup', '--value'])
                    assert api_group.startswith('/' + SLICE + '/')
                    visit['api_cgroup'] = api_group
                else:
                    name = PROVIDERS[candidate]
                    run(['docker', 'start', name])
                    visit['container'] = snapshot(name)
                    candidate_path = process_cgroup(visit['container']['pid'])
                    if candidate == 'cipherscan':
                        pg_env = environment(inspect(name))
                        endpoint = f"postgresql://{quote(pg_env.get('POSTGRES_USER', 'postgres'), safe='')}:{quote(pg_env['POSTGRES_PASSWORD'], safe='')}@{ip(name)}:5432/{quote(pg_env['POSTGRES_DB'], safe='')}"
                    else:
                        endpoint = 'grpc://' + ip(name) + (':8137' if candidate == 'zaino' else ':9067')
                visit['cgroup_before'] = cgroup(candidate_path)
                assert visit['cgroup_before']['cpu.max'] == '100000 100000'
                assert visit['cgroup_before']['memory.max'] == str(4 * 1024**3)
                assert visit['cgroup_before']['memory.swap.max'] == '0'
                prefix = f'round{round_number}-{candidate}'
                client_name = CLIENT_PREFIX + prefix
                env = os.environ.copy()
                env.update(ZEER_TX_ENDPOINT=endpoint, CHEF_API_TOKEN='zeer-lookup-session-private-token')
                client_args = ['docker', 'run', '--name', client_name, '--network', 'host', '--cgroup-parent', CLIENT_SLICE,
                               '--cpus', '1', '--memory', '512m', '--memory-swap', '512m', '--pids-limit', '64',
                               '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only',
                               '-e', 'PYTHONDONTWRITEBYTECODE=1', '-e', 'PYTHONPATH=/deps:/generated:/work', '-e', 'ZEER_TX_ENDPOINT', '-e', 'CHEF_API_TOKEN',
                               '-v', '/opt/zeer-bench/20261013/state/client/deps:/deps:ro', '-v', '/opt/zeer-bench/20261013/state/client/generated:/generated:ro',
                               '-v', str(SOURCE) + ':/work:ro', '-v', str(OUT) + ':/results', '-w', '/work', PYTHON_IMAGE,
                               'python', '-m', 'benchmarks.chef.session_lookup', '--manifest', 'benchmarks/fixtures/mainnet-transactions-v1/manifest.json',
                               '--candidate', candidate, '--version', VERSIONS[candidate], '--round', str(round_number), '--out', '/results/' + prefix,
                               '--source-url', source_url, '--readiness-seconds', '180']
                result = subprocess.run(client_args, env=env, capture_output=True, text=True, timeout=420)
                (OUT / (prefix + '.client.txt')).write_text(result.stdout + result.stderr)
                visit['client_exit_code'] = result.returncode
                visit['client'] = snapshot(client_name)
                client_name = None
                visit['cgroup_after'] = cgroup(candidate_path)
                visit['report_file'] = prefix + '.json'
                if result.returncode:
                    raise RuntimeError('CANDIDATE_VISIT_FAILED:' + candidate)
                report = json.loads((OUT / visit['report_file']).read_text())
                assert report['summary']['status'] == 'PASS' and report['record_count'] == 128
                assert report['repetitions'] == 1 and len(report['runs']) == 1 and report['runs'][0]['status'] == 'PASS'
                visit['report_sha256'] = hashlib.sha256((OUT / visit['report_file']).read_bytes()).hexdigest()
                visit['elapsed_ns'] = report['runs'][0]['lookup_normalize_ns']
                visit['status'] = 'PASS'
                stop_candidate(candidate)
                active = None
                save(session)
                print(json.dumps({'round': round_number, 'candidate': candidate, 'milliseconds': visit['elapsed_ns'] / 1e6}), flush=True)
        reports = [json.loads((OUT / visit['report_file']).read_text()) for visit in session['visits']]
        for key in ['manifest_sha256', 'dataset', 'projection', 'code_identity', 'session_driver_identity', 'profile']:
            assert all(report[key] == reports[0][key] for report in reports)
        session['summary'] = {}
        for candidate in BASE_ORDER:
            candidate_reports = [report for report in reports if report['session_visit']['candidate_key'] == candidate]
            assert {report['session_visit']['round'] for report in candidate_reports} == {1, 2, 3, 4, 5}
            assert all(report['candidate']['version'] == VERSIONS[candidate] for report in candidate_reports)
            values = [visit['elapsed_ns'] for visit in session['visits'] if visit['candidate'] == candidate]
            assert len(values) == 5
            session['summary'][candidate] = {'repetitions': 5, 'median_ms': statistics.median(values) / 1e6,
                                             'min_ms': min(values) / 1e6, 'max_ms': max(values) / 1e6,
                                             'lookups_per_second': 128 * 1e9 / statistics.median(values)}
        session['eligible_for_comparison'] = True
        session['status'] = 'PASS'
    except Exception as error:
        session['status'] = 'FAIL'
        session['failure_type'] = type(error).__name__
        session['failure_code'] = str(error) if isinstance(error, (RuntimeError, AssertionError)) else 'SESSION_OPERATION_FAILED'
        raise
    finally:
        cleanup_errors = []
        def cleanup(label, action):
            try:
                action()
            except Exception as error:
                cleanup_errors.append({'action': label, 'error_type': type(error).__name__})
        if client_name:
            cleanup('client', lambda: run(['docker', 'stop', '--time', '10', client_name]))
        for candidate in BASE_ORDER:
            cleanup(candidate, lambda candidate=candidate: stop_candidate(candidate))
        cleanup('source', lambda: run(['docker', 'stop', '--time', '30', NODE]))
        try:
            session['host_after'] = health()
            session['running_containers_after'] = run(['docker', 'ps', '--format', '{{.Names}}']).splitlines()
            owned = {NODE, CHEF_PG, *PROVIDERS.values()}
            if owned.intersection(session['running_containers_after']) or any(name.startswith(CLIENT_PREFIX) for name in session['running_containers_after']):
                cleanup_errors.append({'action': 'verify_stopped', 'error_type': 'OwnedContainerStillRunning'})
        except Exception as error:
            cleanup_errors.append({'action': 'final_health', 'error_type': type(error).__name__})
        session['cleanup_errors'] = cleanup_errors
        if cleanup_errors:
            session['status'] = 'FAIL'
            session['eligible_for_comparison'] = False
        session['finished_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        save(session)
    if session['status'] != 'PASS' or not session.get('eligible_for_comparison'):
        raise RuntimeError('SESSION_NOT_ELIGIBLE')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=SOURCE)
    parser.add_argument('--out', type=Path, default=OUT)
    parser.add_argument('--report', type=Path, default=REPORT)
    parser.add_argument('--name', default='zeerlookup')
    parser.add_argument('--chef-revision', default=VERSIONS['chef'])
    args = parser.parse_args()
    if not re.fullmatch(r'zeer[a-z0-9]{1,24}', args.name) or not re.fullmatch(r'[0-9a-f]{40}', args.chef_revision):
        raise RuntimeError('INVALID_SESSION_NAME_OR_REVISION')
    SOURCE, OUT, REPORT = args.source.resolve(), args.out.resolve(), args.report.resolve()
    if not SOURCE.is_dir() or not REPORT.is_file():
        raise RuntimeError('PREPARED_SOURCE_AND_REPORT_REQUIRED')
    SLICE, CLIENT_SLICE = args.name + '.slice', args.name + 'client.slice'
    CHEF_PG, API_UNIT = 'zeer-' + args.name + '-pg', 'zeer-' + args.name + '-api'
    CLIENT_PREFIX = 'zeer-' + args.name + '-client-'
    VERSIONS['chef'] = args.chef_revision
    def interrupt(signum, frame):
        raise RuntimeError('SESSION_INTERRUPTED')
    signal.signal(signal.SIGTERM, interrupt)
    signal.signal(signal.SIGINT, interrupt)
    main()
