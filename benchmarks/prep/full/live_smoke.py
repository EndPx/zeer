"""Isolated Regtest-only live follow check. Mines two disposable local blocks.

Never point this tool at a production chain. Both RPC chain alias and known
Regtest genesis are checked before invoking the regtest generate method.
"""
import argparse,json,os,time,urllib.request,pathlib
REGTEST_GENESIS='029f11d80ef9765602235e1bc9727e3eb6ba20839319f761fee920d63401e327'

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',default='http://live-zebra:18232');p.add_argument('--prep',default='http://zeer-prep-live-http:39368');p.add_argument('--out',type=pathlib.Path,required=True);a=p.parse_args()
 if a.out.exists():raise ValueError('refusing_existing_result')
 def rpc(method,params):
  data=json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':params}).encode()
  x=json.load(urllib.request.urlopen(urllib.request.Request(a.source,data=data,headers={'Content-Type':'application/json'}),timeout=30))
  assert x.get('error') is None and x['id']==1,x.get('error');return x['result']
 def api(path,body=None):
  headers={'Authorization':'Bearer '+os.environ['PREP_API_TOKEN'],'Content-Type':'application/json'}
  return json.load(urllib.request.urlopen(urllib.request.Request(a.prep+path,data=json.dumps(body).encode() if body is not None else None,headers=headers),timeout=15))
 chain=rpc('getblockchaininfo',[]);assert chain['chain'] in ['regtest','test'];assert rpc('getblockhash',[0])==REGTEST_GENESIS
 initial=chain['blocks'];assert initial==1024,'fresh copy of frozen1024fixture required'
 before=api('/height');assert before['ready'] and before['archive_height']==initial and before['network']=='regtest'
 q={'from_block':1020,'limit':1,'field_selection':{'block':['height','hash','raw'],'transaction':['txid','version','raw']}}
 first=api('/query',q);assert first['cursor'] and first['to_block']==1025
 mined=rpc('generate',[2]);assert len(mined)==2
 deadline=time.monotonic()+40
 while time.monotonic()<deadline:
  now=api('/height')
  if now['ready'] and now['archive_height']==initial+2:break
  time.sleep(.5)
 else:raise AssertionError('follower did not reach generated blocks')
 # Continuation remains bounded by the old capturedhead despite new data.
 resumed=api('/query',{**q,'to_block':first['to_block'],'cursor':first['cursor']})
 assert resumed['to_block']==1025 and resumed['epoch']==first['epoch']
 new=api('/query',{'from_block':1025,'to_block':1027,'limit':2,'field_selection':{'block':['height','hash','raw','decoded'],'transaction':['txid','version','raw','decoded']}})
 assert [b['height'] for b in new['data']['blocks']]==[1025,1026]
 assert [b['hash'] for b in new['data']['blocks']]==mined
 for b in new['data']['blocks']:assert b['raw']==rpc('getblock',[b['hash'],0])
 result={'schema_version':1,'status':'PASS','network':'isolated-regtest','initial_head':initial,'generated_blocks':mined,'final_source_height':now['source_height'],'final_indexed_height':now['archive_height'],'lag_blocks':now['lag_blocks'],'append_preserved_cursor_epoch':new['epoch']==first['epoch'],'old_cursor_captured_to':resumed['to_block'],'new_full_blocks':len(new['data']['blocks']),'new_full_transactions':len(new['data']['transactions']),'transaction_versions':sorted(set(t['version'] for t in new['data']['transactions'])),'limits':'Real Zebra regtest growth; no real funds, public-network live-follow proof or real-node reorg claim'}
 a.out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))

if __name__=='__main__':main()
