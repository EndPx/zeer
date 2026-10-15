"""Connected real Regtest recovery proof. Own Docker resources only; no public writes.

Requires a built checkout and Prep binary. All node state starts empty. The
explicit mutation flag authorizes only this script's new peerless Regtest node.
Run under a 0.25 CPU / 512 MiB controller cgroup; containers total <=2.5 CPU/6GiB.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

from benchmarks.prep.full.reorg_proof import PrivateEndpoint, REGTEST_GENESIS, guard_source

NODE = 'zfnd/zebra@sha256:bb2a6029db277ee3a10e951dcc0ddd36b4cbcbe0fad684746d695ee21d53fde2'
RUST = 'rust@sha256:2c3a22f0a5533ea2dd5a16627bc841228151faa2d4de2644ac9987e4a2f1f2fa'
JS = 'node@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8'
PG = 'postgres@sha256:ceef4a62198b562d6fe3e51be67362f72a0abf0aaa255f54f0c0e55be9768ed2'
TOKEN = 'disposable-recovery-api-token'
QUERY = {'query': '{ _meta { height hash status } BlockList(first:100) { items { id hash previousHash time transactionCount } nextCursor } TransactionList(first:100) { items { id txid blockHeight index version locktime sizeBytes } nextCursor } BranchBlockList(first:100) { items { id height } nextCursor } }'}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--work', type=Path, required=True)
    p.add_argument('--source', type=Path, required=True)
    p.add_argument('--prep-binary', type=Path, required=True)
    p.add_argument('--name', required=True)
    p.add_argument('--subnet', help='Optional unused RFC1918 IPv4 /24-/28; inspect host/VPN routes first')
    p.add_argument('--allow-disposable-regtest-mutation', action='store_true')
    a = p.parse_args()
    assert a.allow_disposable_regtest_mutation and re.fullmatch(r'zeer-[a-z0-9-]{1,40}', a.name)
    if a.subnet:
        subnet=ipaddress.ip_network(a.subnet,strict=True)
        assert subnet.version==4 and 24<=subnet.prefixlen<=28 and any(subnet.subnet_of(ipaddress.ip_network(cidr)) for cidr in ['10.0.0.0/8','172.16.0.0/12','192.168.0.0/16'])
    a.work = a.work.resolve(); a.source = a.source.resolve(); a.prep_binary = a.prep_binary.resolve()
    assert not a.work.exists() and a.prep_binary.is_file()
    assert (a.source/'packages/chef/dist/cli.js').is_file()
    a.work.mkdir(parents=True)
    owned = []; processes = []; record = {'status':'RUNNING', 'source':'fresh peerless real Zebra Regtest', 'stages':[], 'proofs':[],
        'prep_binary_sha256':hashlib.sha256(a.prep_binary.read_bytes()).hexdigest()}
    network = a.name
    graph_project = 'recovery_public'
    def call(argv, timeout=120):
        r = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
        if r.returncode: raise RuntimeError(f'command_failed:{argv[0]}:{r.stderr[-1500:]}')
        return r.stdout.strip()
    def event(stage, **data):
        value = {'stage':stage, 'time':time.time(), **data}; record['stages'].append(value)
        with (a.work/'journal.jsonl').open('a') as f: f.write(json.dumps(value)+'\n')
        print(stage, flush=True)
    def wait(fn, reason, timeout=90):
        end=time.monotonic()+timeout; last=None
        while time.monotonic()<end:
            try:
                v=fn()
                if v:return v
            except (OSError,ValueError,KeyError,ConnectionError) as e:last=type(e).__name__
            time.sleep(.25)
        raise RuntimeError('timeout:'+reason+':'+str(last))
    def inspect(name):return json.loads(call(['docker','inspect',name]))[0]
    def ip(name):return inspect(name)['NetworkSettings']['Networks'][network]['IPAddress']
    def start(name):call(['docker','start',name])
    def stop(name):call(['docker','stop','--time','3',name])
    def create(suffix,image,command,cpu,memory,extra=()):
        name=a.name+'-'+suffix
        call(['docker','create','--name',name,'--label','zeer.recovery='+a.name,'--network',network,
              '--cpus',str(cpu),'--memory',memory,'--memory-swap',memory,'--pids-limit','128',
              '--stop-signal','SIGINT',*extra,image,*command])
        owned.append(name);return name
    def sql(statement):return call(['docker','exec',pg,'psql','-U','recovery','-d','recovery','-At','-v','ON_ERROR_STOP=1','-c',statement])
    def checkpoint():return json.loads(sql('SELECT row_to_json(s) FROM chef_recovery_public.state s'))
    def pgwait(expression):return sql(expression)=='t'
    def graph():return api.request('/graphql',QUERY)
    def oracle(height):
        blocks=[];txs=[];branches=[]
        for h in range(1,height+1):
            bh=node.rpc('getblockhash',[h]); b=node.rpc('getblock',[bh,2])
            blocks.append({'id':str(h),'hash':bh,'previousHash':b['previousblockhash'],'time':str(b['time']),'transactionCount':len(b['tx'])})
            branches.append({'id':bh,'height':h})
            for i,t in enumerate(b['tx']):txs.append({'id':f'{h}:{i}','txid':t['txid'],'blockHeight':h,'index':i,'version':t['version'],'locktime':str(t['locktime']),'sizeBytes':len(t['hex'])//2})
        return {'_meta':{'height':height,'hash':node.rpc('getblockhash',[height]),'status':'ready'},
            **{key:{'items':sorted(rows,key=lambda x:x['id']),'nextCursor':None} for key,rows in [('BlockList',blocks),('TransactionList',txs),('BranchBlockList',branches)]}}
    def equal(height):
        status,body=graph()
        assert status==200 and not body.get('errors'),(status,body)
        expected=oracle(height)
        proof={'height':height,'observed':body['data'],'node_oracle':expected,'equal':body['data']==expected,
            'prep':prep.request('/height')[1], 'graphql_project':graph_project,
            'database_checkpoint_project':'recovery_public', 'database_checkpoint':checkpoint()}
        filename=f'canonical-{len(record["proofs"])+1}.json'
        encoded=json.dumps(proof,indent=2)+'\n';(a.work/filename).write_text(encoded)
        record['proofs'].append({'file':filename,'sha256':hashlib.sha256(encoded.encode()).hexdigest()})
        assert proof['equal'],'graph_not_equal_canonical_node'
        return body['data']
    def ready(height):
        status,b=graph()
        return status==200 and b.get('data',{}).get('_meta',{}).get('height')==height and b['data']['_meta']['hash']==node.rpc('getblockhash',[height])
    def generate(n):
        before=node.rpc('getblockchaininfo',[])['blocks'];guard_source(node,before)
        assert len(node.rpc('generate',[n]))==n
        guard_source(node,before+n);return before+n
    def replace(depth):
        head=node.rpc('getblockchaininfo',[])['blocks'];guard_source(node,head)
        old=[node.rpc('getblockhash',[h]) for h in range(head-depth+1,head+1)]
        node.rpc('invalidateblock',[old[0]])
        wait(lambda:node.rpc('getblockchaininfo',[])['blocks']==head-depth,'node_rewind')
        guard_source(node,head-depth)
        new=node.rpc('generate',[depth+1]);guard_source(node,head+1)
        assert set(old).isdisjoint(new),'branch_hashes_reused'
        return head+1,old
    try:
        call(['docker','network','create','--internal',*(['--subnet',a.subnet] if a.subnet else []),network])
        (a.work/'node').mkdir();os.chown(a.work/'node',10001,10001)
        zebra=create('node',NODE,['--config','/config.toml','start'],.6,'2g',[
            '--entrypoint','zebrad','--user','10001:10001','-v',str(a.source/'benchmarks/prep/full/zebra-regtest.toml')+':/config.toml:ro',
            '-v',str(a.work/'node')+':/home/zebra/.cache/zebra'])
        start(zebra);node=PrivateEndpoint('http://'+ip(zebra)+':18232')
        wait(lambda:node.rpc('getblockhash',[0])==REGTEST_GENESIS,'genesis')
        assert node.rpc('getpeerinfo',[])==[] and node.rpc('getblockchaininfo',[])['blocks']==0
        assert len(node.rpc('generate',[12]))==12;guard_source(node,12)
        pg=create('pg',PG,[],.4,'512m',['-e','POSTGRES_USER=recovery','-e','POSTGRES_PASSWORD=fixture-only','-e','POSTGRES_DB=recovery','-v',str(a.work/'pg')+':/var/lib/postgresql/data'])
        start(pg);wait(lambda:subprocess.run(['docker','exec',pg,'pg_isready','-U','recovery','-d','recovery'],capture_output=True).returncode==0,'postgres')
        prep_mount=['-v',str(a.prep_binary)+':/usr/local/bin/prep:ro','-v',str(a.work/'archive')+':/data']
        follower=create('follow',RUST,['prep','sync','--source','http://'+ip(zebra)+':18232','--network','regtest','--archive','/data','--from','1','--segment-blocks','2','--confirmations','1','--max-reorg-blocks','10','--max-disk-gib','1','--deadline-seconds','120','--allow-insecure','--follow','--poll-seconds','1','--max-source-retries','20'],.4,'1g',prep_mount)
        start(follower)
        wait(lambda:json.loads((a.work/'archive/status.json').read_text()).get('indexed_height')==12,'archive')
        http=create('http',RUST,['prep','serve-http','--archive','/data','--listen','0.0.0.0:39368','--allow-network'],.35,'1g',prep_mount+['-e','PREP_API_TOKEN='+TOKEN])
        start(http);prep=PrivateEndpoint('http://'+ip(http)+':39368',TOKEN)
        wait(lambda:prep.request('/height')[1].get('ready'),'prep_http')
        common=['-v',str(a.source)+':/work:ro','-w','/work','-e','DATABASE_URL=postgres://recovery:fixture-only@'+ip(pg)+':5432/recovery',
                '-e','PREP_URL=http://'+ip(http)+':39368','-e','PREP_API_TOKEN='+TOKEN,'-e','CHEF_API_TOKEN='+TOKEN]
        config='benchmarks/chef/recovery.config.ts'
        cli=['node','packages/chef/dist/cli.js']
        migrate=create('migrate',JS,cli+['migrate','--config',config],.5,'768m',common);start(migrate)
        assert call(['docker','wait',migrate])=='0'
        worker=create('worker',JS,cli+['sync','--config',config,'--follow','--poll-seconds','1'],.5,'768m',common);start(worker)
        serving=create('api',JS,cli+['serve','--config',config,'--listen','0.0.0.0'],.25,'512m',common);start(serving)
        api=PrivateEndpoint('http://'+ip(serving)+':39370',TOKEN)
        wait(lambda:ready(12),'initial_chef');equal(12);event('backfill_equal',height=12)
        head=generate(2);wait(lambda:ready(head),'live_follow');equal(head);event('live_follow_equal',height=head)
        stop(zebra)
        wait(lambda:prep.request('/height')[1].get('ready') is False,'source_gate')
        wait(lambda:graph()[0]==503,'chef_source_gate')
        assert checkpoint()['status']=='reconciling';event('source_outage_gated')
        previous_head=head
        start(zebra)
        restored=wait(lambda:node.rpc('getblockchaininfo',[]),'restarted_node')
        head=restored['blocks'];guard_source(node,head)
        # A node restart can restore a shorter canonical tip. Compare to the
        # actual guarded node, never require the application to keep an orphan.
        assert previous_head-3<=head<=previous_head,'unexpected_restart_source_range'
        wait(lambda:ready(head),'source_recovery');equal(head)
        event('source_recovery_equal',before=previous_head,restored_source=head)
        stop(http);wait(lambda:checkpoint()['status']=='reconciling','prep_transport_gate')
        assert graph()[0]==503;event('prep_outage_gated')
        start(http);wait(lambda:ready(head),'prep_recovery');equal(head);event('prep_recovery_equal')

        # Pause SQL after entity flush, before block/checkpoint commit; no product hook.
        target=head+2
        sql(f"CREATE FUNCTION chef_recovery_public.proof_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.height={target} THEN PERFORM pg_sleep(12); END IF; RETURN NEW; END $$; CREATE TRIGGER proof_pause BEFORE INSERT ON chef_recovery_public.blocks FOR EACH ROW EXECUTE FUNCTION chef_recovery_public.proof_pause();")
        head=generate(2)
        wait(lambda:pgwait("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event='PgSleep' AND query LIKE '%INSERT INTO %blocks%')"),'mid_block_barrier')
        assert checkpoint()['height']==head-1;equal(head-1)
        call(['docker','kill','--signal','KILL',worker]);event('worker_killed_during_uncommitted_block',durable_height=head-1)
        wait(lambda:pgwait("SELECT NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event='PgSleep' AND query LIKE '%INSERT INTO %blocks%')"),'abandoned_transaction_rollback')
        assert checkpoint()['height']==head-1;equal(head-1)
        sql('DROP TRIGGER proof_pause ON chef_recovery_public.blocks; DROP FUNCTION chef_recovery_public.proof_pause();')
        start(worker);wait(lambda:ready(head),'worker_restart');equal(head);event('worker_restart_exactly_once',height=head)

        old=equal(head)
        query={'from_block':1,'to_block':head+1,'limit':1,'field_selection':{'block':['height','hash'],'transaction':[]}}
        code,page=prep.request('/query',query);assert code==200 and page['cursor']
        # Hold entity reads to obtain a verified old repeatable-read snapshot.
        lock=subprocess.Popen(['docker','exec',pg,'psql','-U','recovery','-d','recovery','-v','ON_ERROR_STOP=1','-c',
            'BEGIN; LOCK TABLE chef_recovery_public.entities IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(18); COMMIT;'],stdout=(a.work/'snapshot-lock.txt').open('w'),stderr=subprocess.STDOUT)
        processes.append(lock)
        wait(lambda:pgwait("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event='PgSleep' AND query LIKE 'BEGIN; LOCK TABLE%')"),'snapshot_lock')
        with ThreadPoolExecutor(max_workers=1) as pool:
            in_flight=pool.submit(graph)
            wait(lambda:pgwait("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT data FROM %entities%')"),'query_snapshot_established')
            # Exact retained boundary: Chef window is three blocks.
            head,orphaned=replace(3)
            wait(lambda:checkpoint()['status']=='reconciling','reorg_gated')
            assert graph()[0]==503;event('new_queries_gated_during_reorg')
            # Release only the test's lock holder, before the API statement deadline.
            assert sql("SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE wait_event='PgSleep' AND query LIKE 'BEGIN; LOCK TABLE%'")=='t'
            status,prior=in_flight.result(timeout=30)
            (a.work/'held-query.json').write_text(json.dumps({'status':status,'observed':prior,'expected_old_snapshot':old},indent=2)+'\n')
            assert status==200 and prior['data']==old,'mixed_or_failed_graphql_snapshot'
            event('held_query_result',http_status=status,coherent_old_snapshot=True)
        lock.wait(timeout=30);assert lock.returncode!=0  # explicitly cancelled test lock
        wait(lambda:ready(head),'bounded_reorg_replay');new=equal(head)
        assert set(orphaned).isdisjoint(r['id'] for r in new['BranchBlockList']['items'])
        status,invalid=prep.request('/query',{**query,'cursor':page['cursor']})
        assert status==409 and invalid['error']['code']=='REORG'
        after=prep.request('/height')[1];assert int(after['epoch'])>int(page['epoch'])
        event('exact_window_reorg_equal',height=head,orphan_block_ids_removed=orphaned,old_cursor_rejected=True,
              before_epoch=page['epoch'],after_epoch=after['epoch'],checkpoint=checkpoint())
        # One beyond Chef's retained window; Prep still has a deeper recovery window.
        head,_=replace(4)
        wait(lambda:checkpoint()['status']=='blocked','deep_reorg_blocked')
        assert graph()[0]==503
        wait(lambda:not inspect(worker)['State']['Running'],'blocked_worker_exit')
        start(worker);wait(lambda:not inspect(worker)['State']['Running'],'blocked_restart_exit')
        assert checkpoint()['status']=='blocked' and graph()[0]==503
        event('beyond_window_blocks_and_survives_restart',source_height=head)
        # Explicit operator rebuild: new namespace, preserving old blocked namespace.
        stop(serving)
        newer=common+['-e','ZEER_RECOVERY_PROJECT=recovery_rebuilt']
        rebuild=create('rebuild',JS,cli+['migrate','--config',config],.5,'768m',newer);start(rebuild);assert call(['docker','wait',rebuild])=='0'
        resync=create('resync',JS,cli+['sync','--config',config],.5,'768m',newer);start(resync);assert call(['docker','wait',resync])=='0'
        rebuilt_api=create('rebuilt-api',JS,cli+['serve','--config',config,'--listen','0.0.0.0'],.25,'512m',newer);start(rebuilt_api)
        api=PrivateEndpoint('http://'+ip(rebuilt_api)+':39370',TOKEN)
        graph_project='recovery_rebuilt'
        wait(lambda:ready(head),'rebuild_api');equal(head)
        assert checkpoint()['status']=='blocked'
        event('new_namespace_rebuild_equal_old_namespace_preserved',height=head)
        record['status']='PASS'
    except Exception as error:
        record.update(status='FAIL',error_type=type(error).__name__,error=str(error))
        raise
    finally:
        record['containers']=[];cleanup=[]
        for name in reversed(owned):
            try:
                logs=subprocess.run(['docker','logs',name],capture_output=True,text=True,timeout=30)
                (a.work/(name+'.log')).write_text(logs.stdout+logs.stderr)
            except Exception as e:cleanup.append({'name':name,'operation':'logs','error':str(e)})
            try:
                d=inspect(name)
                record['containers'].append({'name':name,'image':d['Image'],'limits':{k:d['HostConfig'][k] for k in ['NanoCpus','Memory','MemorySwap']}})
            except Exception as e:cleanup.append({'name':name,'operation':'inspect','error':str(e)})
            try:stop(name)
            except Exception as e:cleanup.append({'name':name,'operation':'stop','error':str(e)})
        for proc in processes:
            if proc.poll() is None:proc.terminate();proc.wait(timeout=10)
        record['cleanup_errors']=cleanup
        if cleanup:record['status']='FAIL'
        (a.work/'execution.json').write_text(json.dumps(record,indent=2)+'\n')
    if record['status']!='PASS':raise RuntimeError('Recovery or cleanup failed; inspect retained execution.json')
    print('PASS: connected real-node recovery; evidence local at '+str(a.work))


if __name__=='__main__':main()
