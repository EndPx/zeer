"""Bounded public-provider reference capture, independent of the Rust importer.

Uses generated pinned upstream Python bindings. No wallet keys or broadcasts.
This capture trusts provider data; it is not independent consensus validation.
"""
import argparse, grpc, json, hashlib, pathlib, struct, time
import service_pb2 as p, service_pb2_grpc as g
from google.protobuf import json_format
args=argparse.ArgumentParser(description=__doc__)
args.add_argument('--output',type=pathlib.Path,required=True)
args.add_argument('--endpoint',default='zec.rocks:443')
args=args.parse_args()
out=args.output; endpoint=args.endpoint
if any(c in endpoint for c in '/@?#') or ':' not in endpoint:
 raise ValueError('Expected a public TLS host:port without credentials or a path')
out.mkdir(parents=True,exist_ok=False)
ch=grpc.secure_channel(endpoint,grpc.ssl_channel_credentials(),options=[('grpc.max_receive_message_length',4*1024*1024)])
c=g.CompactTxStreamerStub(ch)
info=c.GetLightdInfo(p.Empty(),timeout=15)
a,b=2700000,2700255
before=c.GetBlock(p.BlockID(height=b),timeout=15)
prev=c.GetBlock(p.BlockID(height=a-1),timeout=15)
records=[]; raw=bytearray(); counts={'blocks':0,'transactions':0,'sapling_outputs':0,'orchard_actions':0}
t=time.monotonic()
for x in c.GetBlockRange(p.BlockRange(start=p.BlockID(height=a),end=p.BlockID(height=b)),timeout=120):
 assert len(records) < b-a+1, 'unexpected_extra_block'
 assert x.height==a+len(records) and x.prevHash==prev.hash
 payload=x.SerializeToString(deterministic=True)
 assert len(raw)+len(payload)+4 <= 16*1024*1024, 'reference_exceeds_smoke_bound'
 raw += struct.pack('<I',len(payload))+payload
 records.append({'height':x.height,'hash':x.hash[::-1].hex(),'payload_sha256':hashlib.sha256(payload).hexdigest(),'payload_bytes':len(payload)})
 counts['blocks']+=1; counts['transactions']+=len(x.vtx)
 counts['sapling_outputs']+=sum(len(tx.outputs) for tx in x.vtx)
 counts['orchard_actions']+=sum(len(tx.actions) for tx in x.vtx)
 prev=x
elapsed=time.monotonic()-t
after=c.GetBlock(p.BlockID(height=b),timeout=15)
assert len(records)==256 and before.hash==after.hash==prev.hash
assert info.chainName=='main'
result={'schema_version':1,'captured_at_unix':int(time.time()),'source':endpoint,'transport':'TLS gRPC, verified certificate','source_info':json_format.MessageToDict(info,preserving_proto_field_name=True),'start':a,'end':b,'expected_end_hash':after.hash[::-1].hex(),'counts':counts,'raw_sha256':hashlib.sha256(raw).hexdigest(),'source_fetch_seconds':elapsed,'records':records,'limitation':'Public-provider capture, not independently validated full-node consensus; network timing is not a local engine benchmark.'}
(out/'mainnet-2700000-2700255.pbframes').write_bytes(raw)
(out/'modern-source.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='records'},indent=2)); ch.close()
