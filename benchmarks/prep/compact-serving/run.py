"""Pinned Pearl serving schedule against Prep only, with bounded systemd resources."""
import argparse,pathlib,subprocess,json,time,os,pwd,threading,resource,hashlib,gzip,re,sys,uuid,socket
parser=argparse.ArgumentParser(description=__doc__)
for name in ('root','output','binary','ghz','generated'):
 parser.add_argument('--'+name,type=pathlib.Path,required=True)
parser.add_argument('--user',required=True)
parser.add_argument('--baseline',type=pathlib.Path,help='Optional baseline binary: alternate three focused baseline runs with the complete candidate matrix')
parser.add_argument('--controller-cpu',type=int,default=5)
args=parser.parse_args()
assert os.geteuid()==0,'Run the controller as root; the server and client use --user.'
root=args.root.resolve()
sys.path.insert(0,str(args.generated.resolve()))
import grpc,service_pb2 as p,service_pb2_grpc as g,compact_formats_pb2 as cf
from google.protobuf.json_format import ParseDict
os.sched_setaffinity(0,{args.controller_cpu})
out=args.output.resolve();out.mkdir(parents=True,exist_ok=False)
account=pwd.getpwnam(args.user);assert account.pw_uid!=0;os.chown(out,account.pw_uid,account.pw_gid)
binary=args.binary.resolve();ghz=args.ghz.resolve();proto=root/'reference/service.proto'
service_user=args.user;unit_prefix='zeer-compact-'+uuid.uuid4().hex[:12]
expected=json.loads((root/'expected.json').read_text());endpoint='127.0.0.1:39479';lo=expected['lower'];hi=expected['upper']
assert (lo,hi,expected['tip'],expected['blocks'])==(280000,4382797,4382897,4102798)
assert len(expected['chunks'])==411 and len(expected['samples'])==2000
assert hashlib.sha256((root/'reference/data-heights.json').read_bytes()).hexdigest()=='e4e562fdd8a7295b9b2d5cda51406a9c9b80e813e1a84cdf9aa84526b1d65e4a'
assert hashlib.sha256(proto.read_bytes()).hexdigest()=='6fbfa974081fb02366a3118a25764af289bdbb86688978f5ff2bae661dfa346a'
assert hashlib.sha256((proto.parent/'compact_formats.proto').read_bytes()).hexdigest()=='d8d0c8aaa5ceec7d5dcc188ef25b04011df2ec0254901620fce982fc13aeb32d'
assert '0.121.0' in subprocess.check_output([str(ghz),'--version'],text=True,stderr=subprocess.STDOUT)
with socket.socket() as probe:probe.bind(('127.0.0.1',39479))
def command(args,**kw):return subprocess.run(args,check=True,**kw)
def cg_read(path):
 cpu=dict(line.split() for line in (path/'cpu.stat').read_text().splitlines())
 mem=dict(line.split() for line in (path/'memory.stat').read_text().splitlines())
 return {'cpuSeconds':int(cpu['usage_usec'])/1e6,'memoryBytes':int((path/'memory.current').read_text()),'anonBytes':int(mem['anon']),'fileBytes':int(mem['file'])}
def start(number):
 unit=f'{unit_prefix}-r{number}'
 assert subprocess.run(['systemctl','is-active','--quiet',unit]).returncode!=0
 args=['systemd-run','--collect','--unit',unit,'-p','User='+service_user,'-p','CPUQuota=200%','-p','AllowedCPUs=0,1','-p','MemoryMax=2G','-p','MemorySwapMax=0','-p','TasksMax=256','-p','RuntimeMaxSec=1800','-p','KillSignal=SIGINT','-p','TimeoutStopSec=5','-p','Environment=TOKIO_WORKER_THREADS=2','-p','StandardOutput=append:'+str(out/f'server-r{number}.log'),'-p','StandardError=append:'+str(out/f'server-r{number}.log'),str(binary),'serve-compact','--archive',str(root/'archive'),'--listen',endpoint]
 began=time.monotonic();command(args,capture_output=True,text=True)
 try:
  group=subprocess.check_output(['systemctl','show',unit,'-p','ControlGroup','--value'],text=True).strip();path=pathlib.Path('/sys/fs/cgroup')/group.lstrip('/')
  for _ in range(180):
   channel=grpc.insecure_channel(endpoint)
   try:
    client=g.CompactTxStreamerStub(channel);info=client.GetLightdInfo(p.Empty(),timeout=1);tip=client.GetLatestBlock(p.ChainSpec(),timeout=1)
    assert info.blockHeight==expected['tip'] and tip.height==expected['tip'];break
   except grpc.RpcError:time.sleep(1)
   finally:channel.close()
  else:
   subprocess.run(['systemctl','stop',unit]);raise RuntimeError('SERVER_READY_DEADLINE')
  time.sleep(.3)
  (out/f'unit-r{number}.json').write_text(json.dumps({'unit':unit,'readySeconds':time.monotonic()-began,'controlGroup':group,'cpuMax':(path/'cpu.max').read_text().strip(),'cpus':(path/'cpuset.cpus.effective').read_text().strip(),'memoryMax':(path/'memory.max').read_text().strip(),'argv':args},indent=2))
  return unit,path
 except BaseException:
  subprocess.run(['systemctl','stop',unit],capture_output=True);raise

def stop(unit):subprocess.run(['systemctl','stop',unit],check=False,capture_output=True)
def digest(messages):
 h=hashlib.sha256();n=0
 for b in messages:
  raw=b.SerializeToString(deterministic=True);h.update(len(raw).to_bytes(8,'big'));h.update(raw);n+=1
 return h.hexdigest(),n
def verify():
 unit,path=start(0);channel=grpc.insecure_channel(endpoint,options=[('grpc.max_receive_message_length',8*1024**2)])
 results=[]
 try:
  client=g.CompactTxStreamerStub(channel)
  for height,wanted in expected['samples'].items():
   b=client.GetBlock(p.BlockID(height=int(height)),timeout=10)
   assert b.height==int(height) and hashlib.sha256(b.SerializeToString(deterministic=True)).hexdigest()==wanted
  published=[json.loads(line) for line in (root/'reference/published-compat.jsonl').read_text().splitlines()]
  for row in published:
   if row['status']!='OK':continue
   if row['method']=='GetBlock' and row['case'].startswith('height='):
    wanted=ParseDict(row['first_message'],cf.CompactBlock())
    if wanted.height<lo:continue
    b=client.GetBlock(p.BlockID(height=wanted.height),timeout=10);assert b==wanted
    results.append({'method':'GetBlock','case':row['case'],'status':'PASS'})
   elif row['method']=='GetBlockRange' and re.fullmatch(r'\d+-\d+',row['case']):
    a,z=map(int,row['case'].split('-'));actual,n=digest(client.GetBlockRange(p.BlockRange(start=p.BlockID(height=a),end=p.BlockID(height=z)),timeout=30))
    assert actual==row['digest'] and n==row['messages'];results.append({'method':'GetBlockRange','case':row['case'],'status':'PASS'})
  large=next(r for r in published if r['method']=='GetBlockRange' and r['case'].endswith(' 100k'))
  first,last=map(int,large['case'].split()[0].split('-'))
  def large_messages():
   yield client.GetBlock(p.BlockID(height=first),timeout=10)
   yield from client.GetBlockRange(p.BlockRange(start=p.BlockID(height=first+1),end=p.BlockID(height=last)),timeout=120)
  actual,n=digest(large_messages());assert actual==large['digest'] and n==large['messages']
  results.append({'method':'payload comparison','case':large['case'],'status':'PASS','note':'Reference compatibility case is 100001 blocks; compared by one unary + one 100000-block RPC, not a claim of single-call 100001 support.'})
  whole=hashlib.sha256();total=0
  for part in expected['chunks']:
   h=hashlib.sha256();cursor=part['start']
   for b in client.GetBlockRange(p.BlockRange(start=p.BlockID(height=cursor),end=p.BlockID(height=part['end'])),timeout=120):
    assert b.height==cursor;raw=b.SerializeToString(deterministic=True);framed=len(raw).to_bytes(8,'big')+raw;h.update(framed);whole.update(framed);cursor+=1;total+=1
   assert cursor==part['end']+1 and h.hexdigest()==part['digest']
   if total%500000==0:print('Verified streamed blocks:',total,flush=True)
  assert total==expected['blocks'] and whole.hexdigest()==expected['digest']
  (out/'correctness.json').write_text(json.dumps({'status':'PASS','seededHeights':len(expected['samples']),'publishedCases':results,'fullDownloadBlocks':total,'fullDownloadDigest':whole.hexdigest(),'supportedMethods':['GetBlock','GetBlockRange','GetLightdInfo','GetLatestBlock'],'excluded':'Remaining wallet RPCs, reverse and explicit-pool requests, hash-only lookup, and pre-Sapling blocks are not supported by this immutable profile.'},indent=2))
  print('Full stream and published payload parity PASS',flush=True)
 finally:channel.close();stop(unit)
def template(size,offset):
 st=f'(add {lo} (mod (add (mul .RequestNumber 2654435761) {offset}) {hi-size+2-lo}))'
 return '{"start":{"height":"{{ '+st+' }}"},"end":{"height":"{{ add '+st+f' {size-1}'+' }}"}}'
sync_start=f'(add {lo} (mul .RequestNumber 10000))'
sync_data='{"start":{"height":"{{ '+sync_start+' }}"},"end":{"height":"{{ min (add '+sync_start+' 9999) '+str(hi)+' }}"}}'
plan=[]
for method in ['GetLightdInfo','GetLatestBlock','GetBlock']:plan.append(dict(name=method,method=method,n=1050,skip=50,c=1,data='{}',file=method=='GetBlock'))
for size,n in [(100,1000),(1000,300),(10000,100),(100000,10)]:plan.append(dict(name=f'range-{size}',method='GetBlockRange',n=n+2,skip=2,c=1,data=template(size,size),blocks=size))
for c in [1,8,32,128]:
 plan.append(dict(name=f'range1000-c{c}',method='GetBlockRange',duration=30,c=c,data=template(1000,c),blocks=1000))
 plan.append(dict(name=f'block-c{c}',method='GetBlock',duration=30,c=c,file=True,blocks=1))
plan.append(dict(name='full-wallet-download',method='GetBlockRange',n=len(expected['chunks']),skip=0,c=1,data=sync_data,totalBlocks=expected['blocks'],timeout='600s'))
environment={'referenceCommit':'b01dab9df6256185e9c96fac96286b9d41f1c7ce','binarySha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'ghzSha256':hashlib.sha256(ghz.read_bytes()).hexdigest(),'requestHeightsSha256':hashlib.sha256((root/'reference/data-heights.json').read_bytes()).hexdigest(),'hardware':subprocess.check_output(['lscpu'],text=True),'platform':subprocess.check_output(['uname','-a'],text=True),'plan':plan,'cache':'Warm prepared archive, full untimed verification, declared warmups; no OS cache dropping','limitations':['WSL2/Ryzen hardware differs from published GitHub runners','Only compact streaming subset, not full wallet protocol compatibility','Snapshot acquired remotely and materialized before timing; no equivalent local-node index-build timing','No Zaino or Ztreamer process run']}
paired=args.baseline is not None
variants={'baseline':args.baseline.resolve(),'candidate':binary} if paired else {'candidate':binary}
focus=['full-wallet-download','range1000-c128','block-c128']
if paired:environment.update(variants={k:hashlib.sha256(v.read_bytes()).hexdigest() for k,v in variants.items()},baselineFocus=focus)
(out/'environment.json').write_text(json.dumps(environment,indent=2))
for variant,binary in variants.items():
 verify()
 if paired:(out/f'correctness-{variant}.json').write_bytes((out/'correctness.json').read_bytes())
summaries=[]
for repeat in range(1,4):
 for variant in (list(variants) if repeat%2 else list(reversed(variants))):
  binary=variants[variant];unit,path=start(repeat*10+(variant=='candidate') if paired else repeat)
  try:
   for scenario in plan:
    if variant=='baseline' and scenario['name'] not in focus:continue
    name=(variant+'-' if paired else '')+f"r{repeat}-{scenario['name']}";dest=out/(name+'.json');os.chown(out,account.pw_uid,account.pw_gid)
    args=['runuser','-u',service_user,'--','taskset','-c','2,3',str(ghz),'--insecure','--proto',str(proto),'--import-paths',str(root/'reference'),'--call','cash.z.wallet.sdk.rpc.CompactTxStreamer.'+scenario['method'],'--concurrency',str(scenario['c']),'--connections',str(scenario['c']),'--timeout',scenario.get('timeout','120s'),'--max-recv-message-size','256MB','--format','json','--output',str(dest)]
    if scenario.get('duration'):args+=['--duration',str(scenario['duration'])+'s','--duration-stop','wait']
    else:args+=['--total',str(scenario['n'])]
    if scenario.get('skip'):args+=['--skipFirst',str(scenario['skip'])]
    args+=['--data-file',str(root/'reference/data-heights.json')] if scenario.get('file') else ['--data',scenario['data']]
    args+=[endpoint];before=cg_read(path);peaks=dict(before);done=threading.Event()
    def monitor():
     while not done.wait(.5):
      try:
       now=cg_read(path)
       for k in ['memoryBytes','anonBytes','fileBytes']:peaks[k]=max(peaks[k],now[k])
      except FileNotFoundError:return
    watcher=threading.Thread(target=monitor);watcher.start();cpu=resource.getrusage(resource.RUSAGE_CHILDREN)
    try:result=subprocess.run(args,capture_output=True,text=True,timeout=1200,env={**os.environ,'GOMAXPROCS':'2'})
    finally:done.set();watcher.join()
    after=cg_read(path);usage=resource.getrusage(resource.RUSAGE_CHILDREN)
    (out/(name+'.stderr')).write_text(result.stderr);assert result.returncode==0,'GHZ_FAILED_'+name
    raw=json.loads(dest.read_text());codes=raw.get('statusCodeDistribution',{});ok=codes.get('OK',0);seconds=raw['total']/1e9;dist={d['percentage']:d['latency']/1e9 for d in raw['latencyDistribution']}
    row={'repeat':repeat,'scenario':scenario['name'],'count':raw['count'],'ok':ok,'statusCodes':codes,'totalSeconds':seconds,'p50Seconds':dist.get(50),'p95Seconds':dist.get(95),'p99Seconds':dist.get(99),'serverCpuSeconds':after['cpuSeconds']-before['cpuSeconds'],'clientCpuSeconds':usage.ru_utime+usage.ru_stime-cpu.ru_utime-cpu.ru_stime,'sampledPeakCgroupBytes':peaks['memoryBytes'],'sampledPeakAnonBytes':peaks['anonBytes'],'sampledPeakFileBytes':peaks['fileBytes']}
    if scenario.get('blocks'):row['blocksPerSecond']=ok*scenario['blocks']/seconds
    if scenario.get('totalBlocks') and ok==scenario['n']:row['blocksPerSecond']=scenario['totalBlocks']/seconds
    digest_file=hashlib.sha256();compressed=dest.with_suffix('.json.gz')
    with dest.open('rb') as src,gzip.open(compressed,'wb',compresslevel=1) as target:
     while chunk:=src.read(1024*1024):digest_file.update(chunk);target.write(chunk)
    verify_file=hashlib.sha256()
    with gzip.open(compressed,'rb') as src:
     while chunk:=src.read(1024*1024):verify_file.update(chunk)
    assert verify_file.digest()==digest_file.digest();row['rawSha256']=digest_file.hexdigest()
    assert dest.parent==out and compressed.is_file();dest.unlink()
    row.update(variant=variant) if paired else None;summaries.append(row);(out/'summary.json').write_text(json.dumps(summaries,indent=2));print(json.dumps(row),flush=True)
    assert ok==raw['count'] and ok>0,'NON_SUCCESSFUL_REQUESTS_'+name
    if not scenario.get('duration'):assert raw['count']==scenario['n']-scenario.get('skip',0),'MEASURED_COUNT_MISMATCH_'+name
  finally:stop(unit)
(out/'complete.json').write_text(json.dumps({'status':'PASS','runs':3,'scenarios':len(plan),'pairedBaseline':paired,'measurements':len(summaries)},indent=2));print('BENCHMARK COMPLETE',flush=True)