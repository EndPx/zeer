"""Acquire public bytes outside timing, then build with Prep's checked writer."""
import argparse,pathlib,json,subprocess,sys,time,urllib.request,urllib.parse,base64,hashlib,gzip,shutil,stat
parser=argparse.ArgumentParser(description=__doc__)
for name in ('root','generated','importer','rpc-cookie'):
 parser.add_argument('--'+name,type=pathlib.Path,required=True)
parser.add_argument('--rpc-url',required=True)
parser.add_argument('--segment',type=int,required=True)
args=parser.parse_args()
url=urllib.parse.urlsplit(args.rpc_url)
assert url.scheme=='http' and url.hostname in ('127.0.0.1','localhost','::1') and not url.username,'Use a loopback SSH tunnel to the existing Zebra source.'
assert stat.S_IMODE(args.rpc_cookie.stat().st_mode)&0o077==0,'RPC cookie must be owner-only.'
sys.path.insert(0,str(args.generated.resolve()))
import grpc,service_pb2 as p,service_pb2_grpc as g
root=args.root.resolve();root.mkdir(parents=True,exist_ok=True)
index=args.segment;start=280000+index*100000;end=min(start+99999,4382897)
assert 0<=index<42 and start<=end
segments=root/'archive/segments';segments.mkdir(parents=True,exist_ok=True)
out=segments/f's{index:03d}';capture=root/f'frames-{index:03d}.pb.gz';capture_proof=root/f'frames-{index:03d}.json'
cookie=args.rpc_cookie.read_text().strip()
def rpc(height):
 req=urllib.request.Request(args.rpc_url,data=json.dumps({'jsonrpc':'2.0','id':1,'method':'getblockhash','params':[height]}).encode(),headers={'Content-Type':'application/json','Authorization':'Basic '+base64.b64encode(cookie.encode()).decode()})
 with urllib.request.urlopen(req,timeout=15) as r:d=json.load(r)
 assert not d.get('error');return d['result']
tip=rpc(end);parent=rpc(start-1);began=time.monotonic()
if not capture_proof.exists():
 for attempt in range(1,4):
  part=root/f'frames-{index:03d}-{time.time_ns()}.part.gz';digest=hashlib.sha256();n=0;size=0;previous=bytes.fromhex(parent)[::-1]
  channel=grpc.secure_channel('testnet.zec.rocks:443',grpc.ssl_channel_credentials(),options=[('grpc.max_receive_message_length',8*1024*1024)])
  client=g.CompactTxStreamerStub(channel)
  try:
   assert client.GetLightdInfo(p.Empty(),timeout=20).chainName=='test'
   with gzip.open(part,'wb',compresslevel=1) as f:
    for part_start in range(start,end+1,10000):
     for b in client.GetBlockRange(p.BlockRange(start=p.BlockID(height=part_start),end=p.BlockID(height=min(part_start+9999,end))),timeout=120):
      assert b.height==start+n and n<=end-start and len(b.hash)==32 and b.prevHash==previous
      kept=[]
      for tx in b.vtx:
       if tx.spends or tx.outputs or tx.actions or tx.ironwoodActions:
        tx.ClearField('vin');tx.ClearField('vout');kept.append(tx.SerializeToString(deterministic=True))
      b.ClearField('vtx')
      for raw in kept:b.vtx.add().ParseFromString(raw)
      payload=b.SerializeToString(deterministic=True);assert 0<len(payload)<=4*1024**2
      raw=len(payload).to_bytes(4,'little')+payload;size+=len(raw);assert size<=256*1024**2
      digest.update(raw);f.write(raw);n+=1;previous=b.hash
     time.sleep(.05)
   assert n==end-start+1 and previous[::-1].hex()==tip and rpc(end)==tip and rpc(start-1)==parent
   part.rename(capture)
   capture_proof.write_text(json.dumps({'start':start,'end':end,'blocks':n,'bytes':size,'sha256':digest.hexdigest(),'source':'testnet.zec.rocks:443','projection':'shielded-only','boundaryHashes':'independent existing Zebra node','seconds':time.monotonic()-began},indent=2))
   break
  except grpc.RpcError as e:
   (root/f'capture-failed-{index:03d}-{time.time_ns()}.json').write_text(json.dumps({'code':e.code().name,'blocksReceived':n,'attempt':attempt}))
   if attempt==3:raise
   time.sleep(attempt*2)
  finally:channel.close()
proof=json.loads(capture_proof.read_text())
if not (out/'manifest.json').exists():
 if out.exists():
  failed=root/'failed';failed.mkdir(exist_ok=True);out.rename(failed/f's{index:03d}-{time.time_ns()}')
 with (root/f'build-{index:03d}.log').open('wb') as log:
  child=subprocess.Popen([str(args.importer.resolve()),'--out',str(out),'--network','testnet','--start',str(start),'--end',str(end),'--predecessor',parent,'--end-hash',tip],stdin=subprocess.PIPE,stdout=log,stderr=log)
  try:
   with gzip.open(capture,'rb') as f:shutil.copyfileobj(f,child.stdin,1024*1024)
   child.stdin.close();assert child.wait(timeout=180)==0
  except BaseException:
   child.kill();child.wait();raise
m=json.loads((out/'manifest.json').read_text())
assert m['start_height']==start and m['end_height']==end and m['end_hash']==tip and m['predecessor_hash']==parent
assert m['segment_sha256']==proof['sha256'] and m['segment_bytes']==proof['bytes']
assert rpc(end)==tip and rpc(start-1)==parent
record={'segment':index,'start':start,'end':end,'blocks':m['block_count'],'segmentBytes':m['segment_bytes'],'segmentSha256':m['segment_sha256'],'manifestSha256':hashlib.sha256((out/'manifest.json').read_bytes()).hexdigest(),'elapsedSeconds':time.monotonic()-began,'projection':'shielded-only','allFramesIdenticalToCapture':True,'status':'PASS'}
(root/f'capture-verified-{index:03d}.json').write_text(json.dumps(record,indent=2));print(json.dumps(record),flush=True)
