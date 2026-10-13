"""Host recipe: genuine NU5 fixture metadata and a disposable real-node reorg.

Run only after the comparison. Uses copied Regtest state; all public source
archives remain read-only. Existing application services are never modified.
"""
import json
import os
from pathlib import Path
import subprocess
import signal
import sys
import time

ROOT=Path('/opt/zeer-prep/20261014-index')
SOURCE=ROOT/'source'
OUT=ROOT/'results/live'
NETWORK='zeer-index-proof'
TOKEN='zeer-prep-index-private-token'
RUNTIME='rust@sha256:2c3a22f0a5533ea2dd5a16627bc841228151faa2d4de2644ac9987e4a2f1f2fa'
NODE_IMAGE='zfnd/zebra@sha256:bb2a6029db277ee3a10e951dcc0ddd36b4cbcbe0fad684746d695ee21d53fde2'


def call(args):
    result=subprocess.run(args,capture_output=True,text=True,timeout=120)
    if result.returncode:raise RuntimeError('COMMAND_FAILED:'+args[0])
    return result.stdout.strip()


def inspect(name):return json.loads(call(['docker','inspect',name]))[0]
def ip(name):return inspect(name)['NetworkSettings']['Networks'][NETWORK]['IPAddress']


def stop(name):
    call(['docker','stop','--time','10',name])
    assert not inspect(name)['State']['Running']


def wait(fn):
    for _ in range(120):
        try:
            value=fn()
            if value:return value
        except (OSError,ValueError,KeyError):pass
        time.sleep(.5)
    raise RuntimeError('READINESS_TIMEOUT')


def main():
    sys.path.insert(0,str(SOURCE))
    from benchmarks.prep.full.index_reorg import metadata, FIELDS
    from benchmarks.prep.full.reorg_proof import PrivateEndpoint
    assert not OUT.exists()
    assert not any(name.startswith('zeer-') for name in call(['docker','ps','--format','{{.Names}}']).splitlines())
    OUT.mkdir()
    network=subprocess.run(['docker','network','inspect',NETWORK],capture_output=True,text=True)
    if network.returncode:call(['docker','network','create','--internal',NETWORK])
    assert json.loads(call(['docker','network','inspect',NETWORK]))[0]['Internal']
    owned=[]
    result={'status':'RUNNING'}
    env=os.environ.copy();env['PREP_API_TOKEN']=TOKEN
    def http(name,archive):
        call(['docker','create','--name',name,'--stop-signal','SIGINT','--network',NETWORK,'--cpus','.75','--memory','1g','--memory-swap','1g','--pids-limit','128',
              '--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','-e','PREP_API_TOKEN='+TOKEN,
              '-v',str(ROOT/'bin/prep-after')+':/usr/local/bin/prep:ro','-v',str(archive)+':/data:ro',RUNTIME,
              'prep','serve-http','--archive','/data','--listen','0.0.0.0:39368','--allow-network'])
        owned.append(name);call(['docker','start',name])
        endpoint=PrivateEndpoint('http://'+ip(name)+':39368',TOKEN)
        wait(lambda:endpoint.request('/height')[1].get('ready'))
        return endpoint
    try:
        modern=http('zeer-index-modern','/opt/zeer-prep/20261013-proof/modern-archive')
        fixture=json.loads((SOURCE/'benchmarks/fixtures/mainnet-nu5-full-v1/fixture.json').read_text())
        blocks=fixture['blocks'];start=blocks[0]['decoded']['height'];end=blocks[-1]['decoded']['height']+1
        expected=[metadata(tx,b['decoded']['height'],i) for b in blocks for i,tx in enumerate(b['decoded']['tx'])]
        query={'from_block':start,'to_block':end,'limit':10,'field_selection':{'block':[],'transaction':FIELDS}}
        status,page=modern.request('/query',query)
        assert status==200 and page['cursor'] is None and page['data']['transactions']==expected
        ids=[row['txid'] for row in expected]
        status,selected=modern.request('/query',{**query,'transaction_filter':{'txids':ids+ids}})
        assert status==200 and selected['data']['transactions']==expected
        filters=[]
        for field in ['has_sapling','has_orchard']:
            for enabled in [False,True]:
                wanted=[]
                for b in blocks:
                    for i,tx in enumerate(b['decoded']['tx']):
                        present=bool(tx.get('vShieldedSpend') or tx.get('vShieldedOutput')) if field=='has_sapling' else bool((tx.get('orchard') or {}).get('actions'))
                        if present==enabled:wanted.append(metadata(tx,b['decoded']['height'],i))
                status,observed=modern.request('/query',{**query,'transaction_filter':{field:enabled}})
                assert status==200 and observed['data']['transactions']==wanted
                filters.append({'field':field,'enabled':enabled,'matches':len(wanted)})
        status,legacy=modern.request('/query',{**query,'field_selection':{'block':['raw'],'transaction':FIELDS}})
        assert status==200 and legacy['data']['transactions']==expected and [row['raw'] for row in legacy['data']['blocks']]==[b['raw'] for b in blocks]
        (OUT/'modern-metadata.json').write_text(json.dumps({'status':'PASS','blocks':len(blocks),'transactions':len(expected),'versions':sorted({r['version'] for r in expected}),'filters':filters,'raw_fallback_equal':True,'source_kind':fixture['source_kind'],'limitations':fixture['limitations']},indent=2)+'\n')
        stop('zeer-index-modern')
        assert not inspect('zeer-prep-proof-node')['State']['Running']
        copied=ROOT/'regtest-node';assert not copied.exists()
        call(['cp','-a','/opt/zeer-prep/20261013-proof/node',str(copied)])
        name='zeer-index-zebra'
        call(['docker','create','--name',name,'--stop-signal','SIGINT','--network',NETWORK,'--network-alias','index-zebra','--cpus','.75','--memory','2g','--memory-swap','2g','--pids-limit','256',
              '--cap-drop','ALL','--security-opt','no-new-privileges','--user','10001:10001','--entrypoint','zebrad',
              '-v','/opt/zeer-prep/20261013-proof/zebra-regtest.toml:/config.toml:ro',
              '-v',str(copied)+':/home/zebra/.cache/zebra',NODE_IMAGE,'--config','/config.toml','start'])
        owned.append(name);call(['docker','start',name]);node=PrivateEndpoint('http://'+ip(name)+':18232')
        expected_head=json.loads(Path('/opt/zeer-prep/20261013-proof/results/reorg-proof.json').read_text())['final_height']
        def node_ready():
            value=node.rpc('getblockchaininfo',[])
            return value if value.get('blocks')==expected_head else None
        info=wait(node_ready);head=info['blocks'];start=head-4
        name='zeer-index-follow'
        call(['docker','create','--name',name,'--stop-signal','SIGINT','--network',NETWORK,'--cpus','.75','--memory','2g','--memory-swap','2g','--pids-limit','128',
              '--cap-drop','ALL','--security-opt','no-new-privileges','-v',str(ROOT/'bin/prep-after')+':/usr/local/bin/prep:ro','-v',str(ROOT)+':/experiment',RUNTIME,
              'prep','sync','--source','http://index-zebra:18232','--network','regtest','--archive','/experiment/live-archive','--from',str(start),'--segment-blocks','2',
              '--confirmations','1','--max-reorg-blocks','10','--max-disk-gib','1','--allow-insecure','--follow','--poll-seconds','1'])
        owned.append(name);call(['docker','start',name])
        status_path=ROOT/'live-archive/status.json'
        def follower_ready():
            state=json.loads(status_path.read_text());return state['ready'] and state['indexed_height']==head
        wait(follower_ready)
        prep=http('zeer-index-live-http',ROOT/'live-archive')
        cmd=[sys.executable,str(SOURCE/'benchmarks/prep/full/index_reorg.py'),'--source','http://'+ip('zeer-index-zebra')+':18232',
             '--prep','http://'+ip('zeer-index-live-http')+':39368','--expected-head',str(head),'--from-block',str(start),
             '--depth','2','--confirmations','1','--timeout','90','--allow-disposable-regtest-mutation','--out',str(OUT/'index-reorg.json')]
        proof=subprocess.run(cmd,env=env,capture_output=True,text=True,timeout=240)
        (OUT/'index-reorg.txt').write_text(proof.stdout+proof.stderr)
        if proof.returncode:raise RuntimeError('INDEX_REORG_PROOF_FAILED')
        result['status']='PASS'
    except Exception as error:
        result.update(status='FAIL',failure_type=type(error).__name__)
        raise
    finally:
        errors=[]
        for name in reversed(owned):
            try:stop(name)
            except Exception as error:errors.append({'name':name,'type':type(error).__name__})
        result['cleanup_errors']=errors
        result['services']={name:call(['systemctl','is-active',name]) for name in ['commitpass-api','nabungfi-api','nabungfi-keeper','rocket-arena','nginx']}
        if errors or any(state!='active' for state in result['services'].values()):result['status']='FAIL'
        (OUT/'execution.json').write_text(json.dumps(result,indent=2)+'\n')


if __name__=='__main__':
    def interrupt(signum,frame):raise RuntimeError('INTERRUPTED')
    signal.signal(signal.SIGTERM,interrupt);signal.signal(signal.SIGINT,interrupt)
    main()
