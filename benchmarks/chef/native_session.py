"""Latest Chef/Prep and pinned CipherScan ingestion observations in one session.

Run only on the prepared benchmark host, after source builds are independently
verified. Candidate engines are unchanged; a local copy of the CipherScan runner
changes only isolation, repetition and resource settings. No speed ranking is
implied: entity workloads and timer boundaries differ.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import statistics
import subprocess
import time
from urllib.parse import quote
import urllib.request

GIB = 1024**3
NODE = 'zeer-bench-four-frozen'
NETWORK = 'zeer-bench-four-frozen'
PG = 'zeer-latest-native-pg'
PREP = 'zeer-latest-native-prep'
CS_NETWORK = 'zeer-chef-cs'
SLICE = 'zeerlatestcandidate.slice'
CLIENT = 'zeerlatestcontroller.slice'
SERVICES = ['commitpass-api', 'nabungfi-api', 'nabungfi-keeper', 'rocket-arena', 'nginx']


def call(args, **kwargs):
    result = subprocess.run(args, capture_output=True, text=True, timeout=kwargs.pop('timeout', 120), **kwargs)
    if result.returncode:
        raise RuntimeError('COMMAND_FAILED:' + args[0])
    return result.stdout.strip()


def inspect(name):
    return json.loads(call(['docker', 'inspect', name]))[0]


def env_of(value):
    return dict(item.split('=', 1) for item in value['Config']['Env'])


def snapshot(name):
    item = inspect(name)
    host = item['HostConfig']
    return {'name': name, 'image': item['Image'], 'state': item['State'],
            'cpu': host['NanoCpus']/1e9, 'memory': host['Memory'],
            'swap': host['MemorySwap'], 'parent': host['CgroupParent'],
            'mounts': item['Mounts'], 'ports': host['PortBindings']}


def health(paths):
    services = {name: call(['systemctl', 'is-active', name]) for name in SERVICES}
    if any(value != 'active' for value in services.values()):
        raise RuntimeError('EXISTING_SERVICE_NOT_ACTIVE')
    usage = sum(int(call(['du', '-sb', str(path)]).split()[0]) for path in paths)
    if usage > 40*GIB:
        raise RuntimeError('SESSION_STORAGE_BUDGET_EXCEEDED')
    available = os.statvfs('/opt').f_bavail * os.statvfs('/opt').f_frsize
    memory = int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:')))*1024
    if available < 30*GIB or memory < 2*GIB:
        raise RuntimeError('HOST_FREE_DISK_GUARD')
    return {'services': services, 'bounded_storage_bytes': usage, 'free_disk_bytes': available,
            'available_memory_bytes':memory,
            'loadavg': Path('/proc/loadavg').read_text().strip()}


def own_slice(name, cpu, memory):
    content = f'[Unit]\nDescription=Zeer latest ingestion benchmark\n[Slice]\nCPUQuota={cpu}%\nMemoryMax={memory}\nMemorySwapMax=0\nTasksMax=512\n'
    path = Path('/run/systemd/system')/name
    if path.exists() and path.read_text() != content:
        raise RuntimeError('SLICE_CONFLICT')
    path.write_text(content)
    call(['systemctl', 'daemon-reload'])
    call(['systemctl', 'start', name])
    call(['systemctl', 'set-property', '--runtime', name, f'CPUQuota={cpu}%', f'MemoryMax={memory}', 'MemorySwapMax=0'])


def counters():
    base = Path('/sys/fs/cgroup')/SLICE
    return {name: (base/name).read_text().strip() for name in
            ['cpu.max', 'memory.max', 'memory.swap.max', 'cpu.stat', 'memory.events', 'memory.peak']}


def stop(name):
    if inspect(name)['State']['Running']:
        call(['docker', 'stop', '--time', '30', name])
    if inspect(name)['State']['Running']:
        raise RuntimeError('CONTAINER_NOT_STOPPED')


def main():
    global PG, PREP, SLICE, CLIENT
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--prep-binary', required=True)
    parser.add_argument('--source-commit', required=True)
    parser.add_argument('--name', required=True, help='Fresh lowercase alphanumeric session identifier')
    args = parser.parse_args()
    if not re.fullmatch('[a-z][a-z0-9]{1,15}',args.name):
        raise RuntimeError('INVALID_SESSION_NAME')
    PG,PREP=f'zeer-{args.name}-native-pg',f'zeer-{args.name}-native-prep'
    SLICE,CLIENT=f'zeer{args.name}candidate.slice',f'zeer{args.name}controller.slice'
    worker_prefix=f'zeer-chef-{args.name}-cs-'
    if not re.fullmatch('[0-9a-f]{40}',args.source_commit):
        raise RuntimeError('FULL_SOURCE_COMMIT_REQUIRED')
    root, source, binary = Path(args.root).resolve(), Path(args.source).resolve(), Path(args.prep_binary).resolve()
    if not str(root).startswith('/opt/zeer-compare/') or not str(source).startswith('/opt/zeer-'):
        raise RuntimeError('DEDICATED_PATH_REQUIRED')
    out = root/'native-ingestion'
    if out.exists():
        raise RuntimeError('SESSION_OUTPUT_EXISTS')
    out.mkdir(parents=True)
    original_pg = inspect('zeer-chef-pg')
    original_prep = inspect('zeer-chef-prep-http')
    originals = {name: snapshot(name) for name in [NODE, 'zeer-chef-pg', 'zeer-chef-prep-http']}
    if any(value['state']['Running'] for value in originals.values()):
        raise RuntimeError('PREPARED_SERVICE_ALREADY_RUNNING')
    # Count fresh outputs plus all persisted PostgreSQL/archive writes. Source
    # RocksDB is mounted read-only by CipherScan and is excluded preparation.
    storage = [root, *{Path(m['Source']) for m in original_pg['Mounts']}]
    report = {'format': 'latest-native-ingestion-session-v1', 'status': 'RUNNING',
              'started_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'latest_source_commit': args.source_commit,
              'session_name':args.name,
              'orchestrator_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'profile': {'candidate_cpu': 2, 'candidate_memory': 5*GIB,
                          'source_cpu': .75, 'source_memory': 2*GIB,
                          'controller_cpu': .25, 'controller_memory': GIB,
                          'aggregate_cpu_ceiling': 3, 'aggregate_memory_ceiling': 8*GIB,
                          'storage_budget_bytes': 40*GIB},
              'originals': originals, 'visits': [], 'limitations': [
                  'Prepared archive and frozen RocksDB source; build, sync and archive construction excluded.',
                  'Equal aggregate candidate ceilings, different native entity workloads and timer boundaries.',
                  'Chef timer: first selected source request through final durable commit. CipherScan timer: process creation/start through shutdown.',
                  'CipherScan writes additional explorer entities and indexes; extra entity semantics are not fully oracle-verified.',
                  'Independent full common projections checked after timing; no complete-mainnet or shielded-data claim.',
                  'Shared host and caches; no cache dropping; cgroup counters include oracle/readiness/verification.']}
    def save():
        (out/'session.json').write_text(json.dumps(report, indent=2)+'\n')
    save()
    owned, active_unit, native_runner_started = [], None, False
    try:
        report['host_before'] = health(storage)
        for name in [PG,PREP]:
            if subprocess.run(['docker','inspect',name],capture_output=True).returncode==0:
                raise RuntimeError('OWNED_CONTAINER_NAME_EXISTS')
        pg_mounts={mount['Source'] for mount in original_pg['Mounts']}
        running=call(['docker','ps','--format','{{.Names}}']).splitlines()
        for name in running:
            item=inspect(name)
            if pg_mounts.intersection(mount['Source'] for mount in item['Mounts']):
                raise RuntimeError('POSTGRES_SHARED_MOUNT_IN_USE')
            if name.startswith('zeer-'):
                raise RuntimeError('ANOTHER_BENCHMARK_ACTIVE')
        report['source_files_sha256'] = {str(path.relative_to(source)): hashlib.sha256(path.read_bytes()).hexdigest()
            for folder in ['packages/chef/src', 'packages/chef/dist', 'packages/prep-client', 'packages/prep-client/src']
            for path in sorted((source/folder).glob('*')) if path.is_file()}
        for name in ['benchmarks/chef/indexing.mjs','benchmarks/chef/cipherscan.mjs',
                     'examples/chef-public/chef.config.ts','examples/chef-public/schema.graphql','package-lock.json']:
            report['source_files_sha256'][name]=hashlib.sha256((source/name).read_bytes()).hexdigest()
        report['prep_binary_sha256'] = hashlib.sha256(binary.read_bytes()).hexdigest()
        own_slice(SLICE, 200, '5G'); own_slice(CLIENT, 25, '1G')
        controller_cgroup=Path('/proc/self/cgroup').read_text().strip().split('::',1)[1]
        if not controller_cgroup.startswith('/'+CLIENT+'/'):
            raise RuntimeError('RUN_HOST_RECIPE_IN_CONTROLLER_SLICE')
        report['controller_cgroup']=controller_cgroup
        network=json.loads(call(['docker','network','inspect',CS_NETWORK]))[0]
        if not network['Internal']:raise RuntimeError('INTERNAL_NETWORK_REQUIRED')
        pg_args = ['docker', 'create', '--name', PG, '--network', NETWORK, '--cgroup-parent', SLICE,
                   '--cpus', '.5', '--memory', '1g', '--memory-swap', '1g', '--pids-limit', '256']
        for key,value in env_of(original_pg).items():
            if key.startswith('POSTGRES_'): pg_args += ['-e', key+'='+value]
        for mount in original_pg['Mounts']:
            if mount['Type'] != 'bind' or not mount['Source'].startswith('/opt/zeer-chef/20261014/'):
                raise RuntimeError('UNEXPECTED_POSTGRES_MOUNT')
            pg_args += ['--mount', f"type=bind,src={mount['Source']},dst={mount['Destination']}"]
        call(pg_args + [original_pg['Image']]); owned.append(PG)
        call(['docker', 'network', 'connect', '--alias', 'chef-pg', CS_NETWORK, PG])
        archive = next(m['Source'] for m in original_prep['Mounts'] if m['Destination']=='/data')
        call(['docker', 'create', '--name', PREP, '--network', NETWORK, '--cgroup-parent', SLICE,
              '--cpus', '.5', '--memory', '1g', '--memory-swap', '1g', '--pids-limit', '128',
              '--stop-signal', 'SIGINT',
              '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only',
              '-e', 'PREP_API_TOKEN=zeer-chef-prep-private-token',
              '--mount', f'type=bind,src={binary},dst=/usr/local/bin/prep,readonly',
              '--mount', f'type=bind,src={archive},dst=/data,readonly', original_prep['Image'],
              'prep', 'serve-http', '--archive', '/data', '--listen', '0.0.0.0:39368', '--allow-network'])
        owned.append(PREP)
        runner = (source/'benchmarks/chef/cipherscan.mjs').read_text()
        adaptations = [
            ("['127.0.0.1', 'localhost'].includes(adminUrl.hostname) && adminUrl.port === '39460'", "adminUrl.port === '5432'"),
            ("pgInfo.State.Running && pgInfo.NetworkSettings.Ports['5432/tcp']?.some(binding => binding.HostPort === '39460' && ['127.0.0.1', '::1'].includes(binding.HostIp))",
             "pgInfo.State.Running && !Object.values(pgInfo.HostConfig.PortBindings ?? {}).some(bindings => bindings?.length) && adminUrl.hostname === pgInfo.NetworkSettings.Networks['"+NETWORK+"']?.IPAddress"),
            ("'zeer-chef-pg'", repr(PG)),
            ("native_cpu_limit: 1.75", "native_cpu_limit: 1.5"),
            ("index <= 5", "index <= 1"),
            ("'--cpus', '1.75'", "'--cgroup-parent', '"+SLICE+"', '--cpus', '1.5'"),
            ("repetitions: 5", "repetitions: 1"),
            ("elapsed[2]", "elapsed[0]"),
            ("elapsed[4]", "elapsed[0]"),
            ("`chef_cs_${randomBytes", "`chef_"+args.name+"_cs_${randomBytes"),
        ]
        for before,after in adaptations:
            if before not in runner: raise RuntimeError('RUNNER_ADAPTATION_DRIFT')
            runner = runner.replace(before,after)
        # The runner stays next to package resolution via a dedicated symlink.
        (out/'node_modules').symlink_to(source/'node_modules', target_is_directory=True)
        adapted = out/'cipherscan-session.mjs'; adapted.write_text(runner)
        report['runner_adaptations'] = adaptations
        report['adapted_runner_sha256'] = hashlib.sha256(adapted.read_bytes()).hexdigest()
        env = os.environ.copy(); pg_env = env_of(original_pg)
        env['PREP_API_TOKEN']='zeer-chef-prep-private-token'
        call(['docker', 'update', '--cpus', '.75', '--memory', '2g', '--memory-swap', '2g', NODE])
        report['source_limits']=snapshot(NODE)
        if report['source_limits']['cpu']!=.75 or report['source_limits']['memory']!=2*GIB or report['source_limits']['swap']!=2*GIB:
            raise RuntimeError('SOURCE_RESOURCE_MISMATCH')
        call(['docker', 'start', PG])
        for _ in range(40):
            if subprocess.run(['docker','exec',PG,'pg_isready','-U',pg_env.get('POSTGRES_USER','chef'),'-d',pg_env.get('POSTGRES_DB','chef_test')],capture_output=True).returncode==0: break
            time.sleep(1)
        else: raise RuntimeError('POSTGRES_NOT_READY')
        pg_ip=inspect(PG)['NetworkSettings']['Networks'][NETWORK]['IPAddress']
        env['DATABASE_URL']=f"postgres://{quote(pg_env.get('POSTGRES_USER','chef'),safe='')}:{quote(pg_env['POSTGRES_PASSWORD'],safe='')}@{pg_ip}:5432/{pg_env.get('POSTGRES_DB','chef_test')}"
        probe="""import pg from 'pg';
const client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
try {await client.connect();await client.query('SELECT 1');console.log(JSON.stringify({status:'PASS'}));}
catch(error){console.log(JSON.stringify({status:'FAIL',type:error.name,code:/^[A-Z0-9_]+$/.test(error.code??'')?error.code:'PG_CONNECTION_FAILED'}));process.exitCode=1;}
finally{await client.end();}
"""
        probe_result=subprocess.run(['/usr/bin/node','--input-type=module','-e',probe],cwd=source,env=env,capture_output=True,text=True,timeout=30)
        report['postgres_read_only_probe']=json.loads(probe_result.stdout.strip())
        save()
        if probe_result.returncode or report['postgres_read_only_probe']['status']!='PASS':raise RuntimeError('POSTGRES_AUTHENTICATED_PROBE_FAILED')
        report['containers'] = [snapshot(PG),snapshot(PREP)]
        if any(item['cpu']!=.5 or item['memory']!=GIB or item['swap']!=GIB or item['parent']!=SLICE or item['ports'] for item in report['containers']):
            raise RuntimeError('SUPPORT_CONTAINER_RESOURCE_MISMATCH')
        oracle = None
        for round_number in range(1,6):
            order = ['chef','cipherscan'] if round_number%2 else ['cipherscan','chef']
            for candidate in order:
                visit = {'round':round_number,'candidate':candidate,'host_before':health(storage)}
                report['visits'].append(visit); save()
                output = out/f'round{round_number}-{candidate}.json'
                if candidate=='chef':
                    call(['docker','start',NODE,PREP])
                    source_url = 'http://'+inspect(NODE)['NetworkSettings']['Networks'][NETWORK]['IPAddress']+':8232'
                    env['PREP_URL']='http://'+inspect(PREP)['NetworkSettings']['Networks'][NETWORK]['IPAddress']+':39368'
                    for _ in range(60):
                        try:
                            request=urllib.request.Request(source_url,data=json.dumps({'jsonrpc':'2.0','id':1,'method':'getblockchaininfo','params':[]}).encode(),headers={'Content-Type':'application/json'})
                            with urllib.request.urlopen(request,timeout=5) as response: head=json.load(response)['result']
                            if head['blocks']!=6764: raise RuntimeError('FROZEN_HEAD_MISMATCH')
                            break
                        except (OSError,KeyError):time.sleep(1)
                    else: raise RuntimeError('FROZEN_SOURCE_NOT_READY')
                    command=['/usr/bin/node',str(source/'benchmarks/chef/indexing.mjs'),'--config',str(source/'examples/chef-public/chef.config.ts'),
                             '--manifest',str(source/'benchmarks/fixtures/mainnet-transactions-v1/manifest.json'),'--out',str(output),'--source-url',source_url,'--source-mode','prep','--repetitions','1']
                    unit_slice, cpu, memory = SLICE,100,'3G'
                else:
                    stop(PREP); stop(NODE)
                    if oracle is None: raise RuntimeError('ORACLE_NOT_PREPARED')
                    command=['/usr/bin/node',str(adapted),'--oracle',str(oracle),'--out',str(output),
                             '--binary','/opt/zeer-bench/four-20261013/cipherscan-indexer',
                             '--state','/opt/zeer-bench/four-20261013/state/zakura/state/v29/mainnet',
                             '--schema','/opt/zeer-bench/four-20261013/cipherscan-schema.sql',
                             '--runtime-image','zeer-benchmark/native-runtime:20261013','--docker-network',CS_NETWORK,'--pg-container',PG]
                    unit_slice,cpu,memory = CLIENT,25,'1G'
                visit['cgroup_before']=counters()
                if visit['cgroup_before']['cpu.max']!='200000 100000' or visit['cgroup_before']['memory.max']!=str(5*GIB): raise RuntimeError('CANDIDATE_CGROUP_MISMATCH')
                active_unit=f'zeer-{args.name}-native-{round_number}-{candidate}'
                started=time.monotonic()
                if candidate=='cipherscan':native_runner_started=True
                execution=subprocess.run(['systemd-run','--unit='+active_unit,'--collect','--wait','--pipe','--slice='+unit_slice,
                    '--property=WorkingDirectory='+str(source),'--property=CPUQuota='+str(cpu)+'%', '--property=MemoryMax='+memory,'--property=MemorySwapMax=0',
                    '--setenv=DATABASE_URL','--setenv=PREP_URL','--setenv=PREP_API_TOKEN',*command],env=env,capture_output=True,text=True,timeout=2400)
                (out/f'round{round_number}-{candidate}.txt').write_text(execution.stdout+execution.stderr)
                visit['whole_driver_seconds']=time.monotonic()-started
                visit['cgroup_after']=counters()
                def oom_count(value):
                    return int(next(line.split()[1] for line in value.splitlines() if line.startswith('oom_kill ')))
                if oom_count(visit['cgroup_after']['memory.events']) != oom_count(visit['cgroup_before']['memory.events']):
                    raise RuntimeError('CANDIDATE_OOM_DURING_VISIT')
                if execution.returncode: raise RuntimeError('VISIT_FAILED:'+candidate)
                active_unit=None
                value=json.loads(output.read_text()); row=value['runs'][0]
                if value['status']!='PASS' or len(value['runs'])!=1 or row['status']!='PASS': raise RuntimeError('VISIT_REPORT_FAILED')
                if candidate=='chef':
                    if row['persisted_blocks']!=2048 or row['persisted_transactions']!=16962: raise RuntimeError('CHEF_OUTPUT_MISMATCH')
                    oracle=Path(value['oracle']['file'])
                    visit['oracle_sha256']=value['oracle']['sha256']
                    visit['elapsed_ms']=row['elapsed_ms']
                    visit['timer']='first_selected_source_request_to_final_durable_commit'
                    stop(PREP);stop(NODE)
                else:
                    if row['blocks']!=2048 or row['transactions']!=16962: raise RuntimeError('CIPHERSCAN_OUTPUT_MISMATCH')
                    visit['oracle_sha256']=value['workload']['oracle_sha256']
                    visit['elapsed_ms']=row['process_elapsed_ms']
                    visit['timer']='container_creation_to_native_process_shutdown'
                    visit['native_container']=snapshot(row['container'])
                    native=visit['native_container']
                    if native['cpu']!=1.5 or native['memory']!=4*GIB or native['swap']!=4*GIB or native['parent']!=SLICE or native['state']['OOMKilled']:
                        raise RuntimeError('NATIVE_CONTAINER_RESOURCE_MISMATCH')
                visit.update(status='PASS',report_file=output.name,report_sha256=hashlib.sha256(output.read_bytes()).hexdigest())
                save();print(json.dumps({'round':round_number,'candidate':candidate,'elapsed_ms':visit['elapsed_ms']}),flush=True)
        if len({row['oracle_sha256'] for row in report['visits']})!=1: raise RuntimeError('COMMON_ORACLE_MISMATCH')
        report['source_files_sha256_after']={name:hashlib.sha256((source/name).read_bytes()).hexdigest() for name in report['source_files_sha256']}
        report['prep_binary_sha256_after']=hashlib.sha256(binary.read_bytes()).hexdigest()
        if report['source_files_sha256_after']!=report['source_files_sha256'] or report['prep_binary_sha256_after']!=report['prep_binary_sha256']:
            raise RuntimeError('SOURCE_CHANGED_DURING_SESSION')
        report['summary']={}
        for candidate in ['chef','cipherscan']:
            rows=[row['elapsed_ms'] for row in report['visits'] if row['candidate']==candidate]
            report['summary'][candidate]={'repetitions':len(rows),'median_ms':statistics.median(rows),'min_ms':min(rows),'max_ms':max(rows),'transactions_per_second':16962/(statistics.median(rows)/1000)}
        report['status']='PASS'
    except Exception as error:
        report['status']='FAIL';report['failure_type']=type(error).__name__
        report['failure_code']=str(error) if isinstance(error,RuntimeError) else 'SESSION_OPERATION_FAILED'
        raise
    finally:
        errors=[]
        if active_unit:
            subprocess.run(['systemctl','stop',active_unit],capture_output=True)
            state=subprocess.run(['systemctl','is-active',active_unit],capture_output=True,text=True).stdout.strip()
            if state not in {'inactive','failed','unknown'}:errors.append({'name':active_unit,'type':'UnitNotStopped'})
        # A failed native runner may leave its owned backfill container alive.
        if native_runner_started:
            try:
                for name in call(['docker','ps','--format','{{.Names}}']).splitlines():
                    if name.startswith(worker_prefix):
                        try: stop(name)
                        except Exception as error: errors.append({'name':name,'type':type(error).__name__})
            except Exception as error:errors.append({'name':'find_native_workers','type':type(error).__name__})
        for name in [*reversed(owned),NODE]:
            try: stop(name)
            except Exception as error: errors.append({'name':name,'type':type(error).__name__})
        try:
            old=originals[NODE]
            call(['docker','update','--cpus',str(old['cpu']),'--memory',str(old['memory']),'--memory-swap',str(old['swap']),NODE])
            report['host_after']=health(storage)
            report['running_containers_after']=call(['docker','ps','--format','{{.Names}}']).splitlines()
        except Exception as error: errors.append({'name':'restore_and_health','type':type(error).__name__})
        report['cleanup_errors']=errors
        if errors:report['status']='FAIL'
        report['finished_at']=datetime.datetime.now(datetime.timezone.utc).isoformat();save()
        if errors:raise RuntimeError('SESSION_CLEANUP_FAILED')


if __name__=='__main__':
    def interrupt(signum,frame):raise RuntimeError('SESSION_INTERRUPTED')
    signal.signal(signal.SIGTERM,interrupt);signal.signal(signal.SIGINT,interrupt)
    main()
