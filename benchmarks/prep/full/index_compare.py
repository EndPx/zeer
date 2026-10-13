"""Compare old/new Prep with unchanged archives and verified common projections.

Two private servers, each 1 CPU/2 GiB; controller and clients share 1 CPU/1 GiB.
Both sources are prepared before timing. Admission latency/memory recorded apart.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import signal
import statistics
import subprocess
import sys
import time
from urllib.request import Request, urlopen

ROOT = Path('/opt/zeer-prep/20261014-index')
SOURCE = ROOT/'source'
OUT = ROOT/'results/compare'
ARCHIVE = Path('/opt/zeer-chef/20261014/data/prep-mainnet-2048')
NETWORK = 'zeer-bench-four-frozen'
SLICE = 'zeerindexclient.slice'
RUNTIME = 'rust@sha256:2c3a22f0a5533ea2dd5a16627bc841228151faa2d4de2644ac9987e4a2f1f2fa'
PYTHON = 'python@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1'
TOKEN = 'zeer-prep-index-private-token'
SERVICES = ['commitpass-api','nabungfi-api','nabungfi-keeper','rocket-arena','nginx']
CASES = ['before-decoded','after-decoded','after-metadata']


def call(args, **kwargs):
    result = subprocess.run(args, capture_output=True, text=True, timeout=120, **kwargs)
    if result.returncode: raise RuntimeError('COMMAND_FAILED:' + args[0])
    return result.stdout.strip()


def inspect(name): return json.loads(call(['docker','inspect',name]))[0]


def group(pid):
    rel=Path(f'/proc/{pid}/cgroup').read_text().strip().split('::',1)[1]
    return Path('/sys/fs/cgroup'+rel)


def limits(path):
    return {name:(path/name).read_text().strip() for name in ['cpu.max','memory.max','memory.swap.max','memory.current','memory.peak','memory.events','cpu.stat']}


def stop(name):
    if inspect(name)['State']['Running']: call(['docker','stop','--time','10',name])
    if inspect(name)['State']['Running']: raise RuntimeError('CONTAINER_NOT_STOPPED')


def health():
    states={name:call(['systemctl','is-active',name]) for name in SERVICES}
    if any(value!='active' for value in states.values()): raise RuntimeError('SERVICE_HEALTH_FAILED')
    available=int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:')))*1024
    if available<2*1024**3 or os.statvfs('/opt').f_bavail*os.statvfs('/opt').f_frsize<30*1024**3:raise RuntimeError('RESOURCE_GUARD')
    return states


def main():
    sys.path.insert(0,str(SOURCE))
    from benchmarks.prep.full.retrieval_session import execute_client
    if OUT.exists(): raise RuntimeError('OUTPUT_EXISTS')
    running=call(['docker','ps','--format','{{.Names}}']).splitlines()
    if any(name.startswith('zeer-') for name in running):raise RuntimeError('OTHER_EXPERIMENT_RUNNING')
    parent=Path('/sys/fs/cgroup')/SLICE
    if not group(os.getpid()).is_relative_to(parent):raise RuntimeError('CONTROLLER_SLICE_REQUIRED')
    expected=limits(parent)
    assert expected['cpu.max']=='100000 100000' and expected['memory.max']==str(1024**3) and expected['memory.swap.max']=='0'
    OUT.mkdir()
    report={'format':'prep-index-before-after-v1','status':'RUNNING','started_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'orchestrator_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'driver_sha256':hashlib.sha256((SOURCE/'benchmarks/prep/full/retrieval.py').read_bytes()).hexdigest(),
            'archive_catalog_sha256':hashlib.sha256((ARCHIVE/'catalog.json').read_bytes()).hexdigest(),
            'host_before':health(),'profile':{'each_server_cpu':1,'each_server_memory':2*1024**3,'client_and_controller_cpu':1,'client_and_controller_memory':1024**3},
            'servers':{},'visits':[],'limitations':['Same immutable archive; index admission is excluded from query timing and recorded separately.',
             'In-memory derived index, not a new persisted disk format. Prepared warm-cache results on a shared VPS.',
             'Old/new decoded cases request identical fields. New metadata case returns direct scalars with identical final normalized rows, reducing overfetch.',
             'Five cyclic rounds across three cases; each workload uses verified warmup then one measured pass. Headers serve as an unchanged control.',
             'Cgroup memory includes page cache and startup; it is not isolated Rust heap size. One admission observation per server is not a cold-start benchmark.']}
    save=lambda:(OUT/'comparison.json').write_text(json.dumps(report,indent=2)+'\n')
    save(); owned=[]; clients=[]
    try:
        for variant in ['before','after']:
            name='zeer-index-'+variant;binary=ROOT/'bin'/('prep-'+variant)
            call(['docker','create','--name',name,'--stop-signal','SIGINT','--network',NETWORK,'--cpus','1','--memory','2g','--memory-swap','2g',
                  '--pids-limit','128','--cap-drop','ALL','--security-opt','no-new-privileges','--read-only','-e','PREP_API_TOKEN='+TOKEN,
                  '-v',str(binary)+':/usr/local/bin/prep:ro','-v',str(ARCHIVE)+':/data:ro',RUNTIME,
                  'prep','serve-http','--archive','/data','--listen','0.0.0.0:39368','--allow-network'])
            owned.append(name);started=time.monotonic();call(['docker','start',name]);item=inspect(name)
            endpoint='http://'+item['NetworkSettings']['Networks'][NETWORK]['IPAddress']+':39368'
            for _ in range(1200):
                try:
                    with urlopen(Request(endpoint+'/height',headers={'Authorization':'Bearer '+TOKEN}),timeout=1) as response:meta=json.load(response)
                    if meta.get('ready') and meta['archive_height']==2048:break
                except (OSError,ValueError):pass
                time.sleep(.1)
            else:raise RuntimeError('SERVER_ADMISSION_TIMEOUT')
            path=group(item['State']['Pid']);before=limits(path)
            assert before['cpu.max']=='100000 100000' and before['memory.max']==str(2*1024**3) and before['memory.swap.max']=='0'
            report['servers'][variant]={'name':name,'endpoint':endpoint,'image_id':item['Image'],'binary_sha256':hashlib.sha256(binary.read_bytes()).hexdigest(),
              'admission_seconds':time.monotonic()-started,'meta':meta,'cgroup_after_admission':before,'cgroup_path':str(path)}
            save()
        for number in range(1,6):
            offset=(number-1)%3
            for case in CASES[offset:]+CASES[:offset]:
                variant,projection=case.split('-')
                for workload in ['headers','transactions','sparse']:
                    visit={'round':number,'case':case,'workload':workload,'host_before':health(),'status':'RUNNING'}
                    report['visits'].append(visit);save()
                    prefix=f'round{number}-{case}-{workload}';name='zeer-index-client-'+prefix
                    env=os.environ.copy();env.update(PREP_API_TOKEN=TOKEN,ZEER_INDEX_ENDPOINT=report['servers'][variant]['endpoint'])
                    call(['docker','create','--name',name,'--network','host','--cgroup-parent',SLICE,'--cpus','1','--memory','1g','--memory-swap','1g',
                          '--pids-limit','64','--cap-drop','ALL','--security-opt','no-new-privileges','--read-only','-e','PYTHONDONTWRITEBYTECODE=1','-e','PREP_API_TOKEN','-e','ZEER_INDEX_ENDPOINT',
                          '-v',str(SOURCE)+':/work:ro','-v',str(OUT)+':/results','-w','/work',PYTHON,'python','-m','benchmarks.prep.full.retrieval',
                          '--candidate','prep','--workload',workload,'--prep-projection',projection,'--endpoint-env','ZEER_INDEX_ENDPOINT',
                          '--oracle','benchmarks/results/raw/2026-10-14-chef/indexing-oracle.json.gz','--manifest','benchmarks/fixtures/mainnet-transactions-v1/manifest.json',
                          '--out','/results/'+prefix+'.json','--round',str(number),'--timeout-seconds','180'],env=env)
                    clients.append(name)
                    # The known container also has scoped cleanup on timeout/interruption.
                    result=execute_client(name)
                    (OUT/(prefix+'.txt')).write_text(result.stdout+result.stderr)
                    if result.returncode:raise RuntimeError('QUERY_VISIT_FAILED')
                    observed=json.loads((OUT/(prefix+'.json')).read_text())
                    assert observed['status']=='PASS' and observed['run']['sha256']==observed['warmup']['sha256']
                    visit.update(status='PASS',file=prefix+'.json',sha256=hashlib.sha256((OUT/(prefix+'.json')).read_bytes()).hexdigest(),
                                 elapsed_ns=observed['run']['retrieval_normalize_ns'],response_bytes=observed['run']['response_bytes'],result_hash=observed['run']['sha256'])
                    save();print(json.dumps({key:visit[key] for key in ['round','case','workload','elapsed_ns']}),flush=True)
        assert len(report['visits'])==45
        report['summary']={}
        for workload in ['headers','transactions','sparse']:
            all_rows=[row for row in report['visits'] if row['workload']==workload]
            assert len({row['result_hash'] for row in all_rows})==1
            for case in CASES:
                rows=[row for row in all_rows if row['case']==case];assert len(rows)==5
                values=[row['elapsed_ns']/1e6 for row in rows]
                report['summary'][case+'-'+workload]={'repetitions':5,'median_ms':statistics.median(values),'min_ms':min(values),'max_ms':max(values),'response_bytes':[row['response_bytes'] for row in rows]}
        for server in report['servers'].values():server['cgroup_after_queries']=limits(Path(server['cgroup_path']))
        assert hashlib.sha256((ARCHIVE/'catalog.json').read_bytes()).hexdigest()==report['archive_catalog_sha256']
        report['status']='PASS'
    except Exception as error:
        report.update(status='FAIL',failure_type=type(error).__name__)
        raise
    finally:
        errors=[]
        for name in clients+owned:
            try:stop(name)
            except Exception as error:errors.append({'name':name,'type':type(error).__name__})
        try:report['host_after']=health()
        except Exception as error:errors.append({'name':'health','type':type(error).__name__})
        report['cleanup_errors']=errors
        if errors:report['status']='FAIL'
        report['finished_at']=datetime.datetime.now(datetime.timezone.utc).isoformat();save()


if __name__=='__main__':
    def interrupt(signum,frame):raise RuntimeError('INTERRUPTED')
    signal.signal(signal.SIGTERM,interrupt);signal.signal(signal.SIGINT,interrupt)
    main()
