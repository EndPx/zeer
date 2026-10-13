"""Read-only full-node oracle and equivalent-field native serving comparison.

Outputs are public decoded blockchain fields. Requires a frozen source head.
Compare native paths, not isolated engine speed; all preparation is excluded.
"""
import argparse, concurrent.futures, decimal, hashlib, http.client, json, os, pathlib, statistics, threading, time, urllib.parse

class SourceDecimal(decimal.Decimal):
 """Retain the original JSON token as well as its exact decimal value."""
 def __new__(cls,token):
  value=super().__new__(cls,token);value.json_token=token;return value

class Rpc:
 def __init__(self,url):
  p=urllib.parse.urlsplit(url)
  if p.scheme!='http' or p.username or p.password or p.query or p.fragment: raise ValueError('Private plaintext benchmark RPC only')
  self.host,self.port=p.hostname,p.port or 80; self.local=threading.local()
 def call(self,method,params):
  if not hasattr(self.local,'conn'): self.local.conn=http.client.HTTPConnection(self.host,self.port,timeout=20)
  c=self.local.conn; data=json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':params})
  c.request('POST','/',data,{'Content-Type':'application/json'})
  r=c.getresponse(); b=r.read(32*1024*1024+1)
  if r.status!=200 or len(b)>32*1024*1024: raise ValueError('rpc_transport_or_size')
  x=json.loads(b,parse_float=SourceDecimal)
  if x.get('error') or x.get('id')!=1: raise ValueError('rpc_error')
  return x['result']

def lossless(x):
 if isinstance(x,bool) or x is None or isinstance(x,str): return x
 if isinstance(x,SourceDecimal): return x.json_token
 if isinstance(x,(int,decimal.Decimal)): return str(x)
 if isinstance(x,list): return [lossless(i) for i in x]
 if isinstance(x,dict): return {k:lossless(v) for k,v in x.items()}
 raise ValueError(type(x))

def digest(x): return hashlib.sha256(json.dumps(x,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def query(conn,path,body=None,token=None):
 h={'Content-Type':'application/json'}
 if token: h['Authorization']='Bearer '+token
 conn.request('POST' if body is not None else 'GET',path,json.dumps(body) if body is not None else None,h)
 r=conn.getresponse(); b=r.read(32*1024*1024+1)
 if len(b)>32*1024*1024: raise ValueError('response_too_large')
 return r.status,json.loads(b)

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',required=True);p.add_argument('--prep',required=True);p.add_argument('--from-block',type=int,default=1000);p.add_argument('--to-block',type=int,default=2024);p.add_argument('--out',type=pathlib.Path,required=True)
 a=p.parse_args();a.out.mkdir(parents=True,exist_ok=False)
 if not (1<=a.from_block<a.to_block<=a.from_block+2048):raise ValueError('range_bound')
 rpc=Rpc(a.source);head=rpc.call('getblockchaininfo',[]); height,anchor=head['blocks'],head['bestblockhash']
 pp=urllib.parse.urlsplit(a.prep);conn=http.client.HTTPConnection(pp.hostname,pp.port or 80,timeout=30)
 token=os.environ.get('PREP_API_TOKEN');status,meta=query(conn,'/height',token=token);assert status==200 and meta['ready']
 reference=[]; public=[]; expected_blocks=[];expected_txs=[]; hashes={}
 for n in range(a.from_block,a.to_block):
  bh=rpc.call('getblockhash',[n]);b=rpc.call('getblock',[bh,2]);raw=rpc.call('getblock',[bh,0]);assert b['height']==n and b['hash']==bh
  assert all(isinstance(t,dict) and t.get('hex') and t.get('txid') for t in b['tx'])
  block={'height':n,'hash':bh,'previous_hash':b['previousblockhash'],'time':b['time'],'raw':raw,'decoded':lossless(b)}
  txs=[{'txid':t['txid'],'block_height':n,'index':i,'version':t['version'],'locktime':t['locktime'],'raw':t['hex'],'vin':lossless(t['vin']),'vout':lossless(t['vout']),'decoded':lossless(t)} for i,t in enumerate(b['tx'])]
  expected_blocks.append(block);expected_txs.extend(txs)
  reference.append({'height':n,'hash':bh,'raw_sha256':hashlib.sha256(bytes.fromhex(raw)).hexdigest(),'transaction_count':len(txs),'projection_sha256':digest({'block':block,'transactions':txs})})
  public.append({'height':n,'hash':bh,'time':b['time']})
  hashes[n]=bh
 q={'from_block':a.from_block,'to_block':a.to_block,'limit':16,'field_selection':{'block':['height','hash','previous_hash','time','raw','decoded'],'transaction':['txid','block_height','index','version','locktime','raw','vin','vout','decoded']}}
 blocks=[];txs=[];pages=0;cursor=None
 while True:
  req=dict(q)
  if cursor:req['cursor']=cursor
  status,x=query(conn,'/query',req,token);assert status==200,(status,x)
  blocks.extend(x['data']['blocks']);txs.extend(x['data']['transactions']);pages+=1
  cursor=x['cursor']
  if cursor is None: assert x['next_block']==a.to_block;break
 assert blocks==expected_blocks,'full_block_field_mismatch'
 assert txs==expected_txs,'full_transaction_field_mismatch'
 # Filter one genuine transaction; headers disabled, all other txs absent.
 selected=expected_txs[len(expected_txs)//2]
 fq={'from_block':a.from_block,'to_block':a.to_block,'limit':1000,'field_selection':{'block':[],'transaction':['txid','block_height','raw']},'transaction_filter':{'txids':[selected['txid']]}}
 found=[];cursor=None
 while True:
  req=dict(fq)
  if cursor:req['cursor']=cursor
  status,x=query(conn,'/query',req,token);assert status==200
  found.extend(x['data']['transactions']);cursor=x['cursor']
  if cursor is None:break
 assert found==[{k:selected[k] for k in ['txid','block_height','raw']}]
 def addresses(tx):
  result=[]
  for output in tx['vout']:
   script=output.get('scriptPubKey',{})
   result.extend(script.get('addresses',[]))
   if isinstance(script.get('address'),str):result.append(script['address'])
  return result
 address=next(address for tx in expected_txs for address in addresses(tx))
 aq={**fq,'transaction_filter':{'transparent_output_addresses':[address]}}
 matched=[];cursor=None
 while True:
  req=dict(aq)
  if cursor:req['cursor']=cursor
  status,x=query(conn,'/query',req,token);assert status==200
  matched.extend(x['data']['transactions']);cursor=x['cursor']
  if cursor is None:break
 assert matched==[{k:tx[k] for k in ['txid','block_height','raw']} for tx in expected_txs if address in addresses(tx)]
 # Equivalent projected header task. RPC uses reused connections and 8 workers.
 # This is source-node vs prepared-archive retrieval, not identical backend work.
 heights=list(range(a.from_block,a.to_block));pool=concurrent.futures.ThreadPoolExecutor(max_workers=8)
 def node_one(n):
  b=rpc.call('getblock',[hashes[n],1]);return {'height':b['height'],'hash':b['hash'],'time':b['time']}
 def node_read():return list(pool.map(node_one,heights))
 hq={'from_block':a.from_block,'to_block':a.to_block,'limit':128,'field_selection':{'block':['height','hash','time'],'transaction':[]}}
 def prep_read():
  out=[];cursor=None
  while True:
   req=dict(hq)
   if cursor:req['cursor']=cursor
   status,x=query(conn,'/query',req,token);assert status==200
   out.extend(x['data']['blocks']);cursor=x['cursor']
   if cursor is None:return out
 for f in [node_read,prep_read]:assert f()==public
 runs={'full_node_rpc':[],'prep_http':[]}
 for i in range(5):
  order=[('full_node_rpc',node_read),('prep_http',prep_read)]
  if i%2:order.reverse()
  for name,f in order:
   begin=time.perf_counter_ns();out=f();elapsed=time.perf_counter_ns()-begin
   assert out==public
   runs[name].append({'run':i+1,'elapsed_ns':elapsed,'status':'PASS'})
 pool.shutdown()
 end=rpc.call('getblockchaininfo',[]);assert (end['blocks'],end['bestblockhash'])==(height,anchor)
 status,post=query(conn,'/height',token=token);assert status==200 and post['epoch']==meta['epoch'] and post['archive_height']==meta['archive_height']
 report={'schema_version':1,'status':'PASS','captured_at_unix':int(time.time()),'range':{'from':a.from_block,'to_exclusive':a.to_block},'source_head':{'height':height,'hash':anchor},'full_blocks':len(blocks),'full_transactions':len(txs),'full_projection_digest':digest({'blocks':blocks,'transactions':txs}),'full_projection_pages':pages,'txid_filter':'PASS','transparent_output_filter':'PASS','transparent_output_matches':len(matched),'reference':reference,'header_runs':runs,'header_median_ms':{n:statistics.median(r['elapsed_ns'] for r in rs)/1e6 for n,rs in runs.items()},'header_oracle_sha256':digest(public),'limitations':['Native read paths: full node RPC vs already ingested Prep archive, not engine-only speed.','RPC uses8persistent-connection workers and known block hashes; Prep128blockpages; reusedPrepHTTPconnection.','ClientPython, same shared host; warmcacheonewarmup; alternatingrunorder; full outputverification outside timer.','Full payload correctness reads have no timing winner; historical pre-Overwinter range does not prove modern network upgrade decoding.']}
 (a.out/'full-roundtrip.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({k:v for k,v in report.items() if k not in ['reference','header_runs']},indent=2));conn.close()

if __name__=='__main__':main()
