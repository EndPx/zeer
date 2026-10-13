"""Alternate prepared Chef before/after builds with identical durable workloads.

Host recipe requires isolated pre-built sources and existing frozen benchmark
services. It does not change candidate code, database schemas or node coverage.
"""
import hashlib
import json
import os
from pathlib import Path
import signal
import statistics
import subprocess
import time

ROOT = Path('/opt/zeer-chef/20261014-opt')
OUT = ROOT / 'results'
NETWORK = 'zeer-bench-four-frozen'
NAMES = ['zeer-bench-four-frozen', 'zeer-chef-prep-http', 'zeer-chef-pg']


def call(args, **kwargs):
    result = subprocess.run(args, capture_output=True, text=True, **kwargs)
    if result.returncode:
        raise RuntimeError('COMMAND_FAILED:' + args[0])
    return result.stdout.strip()


def inspect(name):
    return json.loads(call(['docker', 'inspect', name]))[0]


def save(report):
    (OUT / 'comparison.json').write_text(json.dumps(report, indent=2) + '\n')


def main():
    if (OUT / 'comparison.json').exists():
        raise RuntimeError('COMPARISON_EXISTS')
    if any(inspect(name)['State']['Running'] for name in [*NAMES, 'zeer-lookup-chef-pg']):
        raise RuntimeError('SOURCE_OR_SHARED_DB_ACTIVE')
    report = {'status': 'RUNNING', 'before_base_commit': '3ed7db7bd05777ee36da29c637e7d10e88e066e7',
              'rounds': [], 'source_files_sha256': {}, 'profile': {'source_cpu': 0.75, 'source_memory': 2*1024**3,
              'prep_cpu': 0.5, 'prep_memory': 1024**3, 'pg_cpu': 0.75, 'pg_memory': 1024**3,
              'client_and_controller_cpu': 1, 'client_and_controller_memory': 3*1024**3},
              'orchestrator_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    save(report)
    active_unit = None
    try:
        for variant in ['before', 'after']:
            report['source_files_sha256'][variant] = {name: hashlib.sha256((ROOT/variant/name).read_bytes()).hexdigest() for name in
                ['packages/chef/src/store.ts', 'packages/chef/dist/store.js', 'benchmarks/chef/indexing.mjs', 'examples/chef-public/chef.config.ts', 'examples/chef-public/schema.graphql', 'package-lock.json']}
        for name in ['benchmarks/chef/indexing.mjs', 'examples/chef-public/chef.config.ts', 'examples/chef-public/schema.graphql', 'package-lock.json']:
            assert report['source_files_sha256']['before'][name] == report['source_files_sha256']['after'][name]
        call(['systemctl', 'set-property', '--runtime', 'zeeroptclient.slice', 'CPUQuota=100%', 'MemoryMax=3G', 'MemorySwapMax=0'])
        call(['docker', 'update', '--cpus', '0.75', NAMES[0]])
        for name in NAMES:
            call(['docker', 'start', name])
        info = {name: inspect(name) for name in NAMES}
        report['active_limits'] = {name: {'cpu': value['HostConfig']['NanoCpus']/1e9, 'memory': value['HostConfig']['Memory'], 'image': value['Image']} for name,value in info.items()}
        source_url = 'http://' + info[NAMES[0]]['NetworkSettings']['Networks'][NETWORK]['IPAddress'] + ':8232'
        prep_url = 'http://' + info[NAMES[1]]['NetworkSettings']['Networks'][NETWORK]['IPAddress'] + ':39368'
        env = os.environ.copy()
        env.update(DATABASE_URL='postgres://chef:chef-local-benchmark-only@127.0.0.1:39460/chef_test',
                   PREP_URL=prep_url, PREP_API_TOKEN='zeer-chef-prep-private-token')
        for _ in range(40):
            ready = subprocess.run(['docker', 'exec', NAMES[2], 'pg_isready', '-U', 'chef', '-d', 'chef_test'], capture_output=True)
            if ready.returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError('POSTGRES_NOT_READY')
        for round_number in range(1,6):
            order = ['before', 'after'] if round_number % 2 else ['after', 'before']
            for variant in order:
                output = OUT / f'round{round_number}-{variant}.json'
                active_unit = f'zeer-chef-opt-{round_number}-{variant}'
                args = ['systemd-run', '--unit=' + active_unit, '--collect', '--wait', '--pipe', '--slice=zeeroptclient.slice',
                        '--property=WorkingDirectory=' + str(ROOT/variant), '--setenv=DATABASE_URL', '--setenv=PREP_URL', '--setenv=PREP_API_TOKEN',
                        '/usr/bin/node', 'benchmarks/chef/indexing.mjs', '--config', 'examples/chef-public/chef.config.ts',
                        '--manifest', 'benchmarks/fixtures/mainnet-transactions-v1/manifest.json', '--out', str(output),
                        '--source-url', source_url, '--source-mode', 'prep', '--repetitions', '1']
                result = subprocess.run(args, env=env, capture_output=True, text=True, timeout=1800)
                (OUT/f'round{round_number}-{variant}.txt').write_text(result.stdout+result.stderr)
                if result.returncode:
                    raise RuntimeError('INDEXING_RUN_FAILED')
                active_unit = None
                value = json.loads(output.read_text())
                assert value['status']=='PASS' and len(value['runs'])==1
                row = value['runs'][0]
                assert row['persisted_blocks']==2048 and row['persisted_transactions']==16962 and row['persisted_entities']==19010
                record = {'round': round_number, 'variant': variant, 'file': output.name, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
                          'elapsed_ms': row['elapsed_ms'], 'sql_requests': row['sql_requests'], 'oracle_sha256': value['oracle']['sha256'],
                          'workload': value['workload'], 'status': 'PASS'}
                report['rounds'].append(record)
                save(report)
                print(json.dumps(record), flush=True)
        assert len({value['oracle_sha256'] for value in report['rounds']})==1
        assert all(value['workload']==report['rounds'][0]['workload'] for value in report['rounds'])
        report['summary']={}
        for variant in ['before','after']:
            values=[row for row in report['rounds'] if row['variant']==variant]
            elapsed=[row['elapsed_ms'] for row in values]
            report['summary'][variant]={'repetitions':5,'median_ms':statistics.median(elapsed),'min_ms':min(elapsed),'max_ms':max(elapsed),
                                        'tx_per_second':16962/(statistics.median(elapsed)/1000),'sql_requests':[row['sql_requests'] for row in values]}
        report['status']='PASS'
    except Exception as error:
        report['status']='FAIL'; report['failure_type']=type(error).__name__
        raise
    finally:
        errors=[]
        if active_unit:
            subprocess.run(['systemctl','stop',active_unit],capture_output=True)
        for name in NAMES:
            try:
                call(['docker','stop','--time','30',name])
                assert not inspect(name)['State']['Running']
            except Exception as error:
                errors.append({'name':name,'error':type(error).__name__})
        try:
            call(['docker','update','--cpus','1',NAMES[0]])
            report['existing_services']={name:call(['systemctl','is-active',name]) for name in ['commitpass-api','nabungfi-api','nabungfi-keeper','rocket-arena','nginx']}
            assert all(state=='active' for state in report['existing_services'].values())
        except Exception as error:
            errors.append({'name':'restore_and_health','error':type(error).__name__})
        report['cleanup_errors']=errors
        if errors: report['status']='FAIL'
        save(report)


if __name__=='__main__':
    def interrupt(signum, frame): raise RuntimeError('INTERRUPTED')
    signal.signal(signal.SIGTERM,interrupt); signal.signal(signal.SIGINT,interrupt)
    main()
