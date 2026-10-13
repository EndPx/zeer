"""Read public protocol metadata and boundary blocks for compatibility diagnosis."""
import argparse
import json
import time
from benchmarks.adapters.compact_grpc import CompactGrpcAdapter


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--endpoint',required=True)
    a=p.parse_args()
    adapter=CompactGrpcAdapter(a.endpoint)
    try:
        info=adapter.stub.GetLightdInfo(adapter.pb.Empty(),timeout=15)
        print(json.dumps({'info':{k:getattr(info,k) for k in ('version','vendor','gitCommit','chainName','blockHeight')}}))
        for h in (0,1,2,1024):
            try:
                b=adapter.stub.GetBlock(adapter.pb.BlockID(height=h),timeout=15)
                print(json.dumps({'height':b.height,'hash':b.hash[::-1].hex(),'prev_hash':b.prevHash[::-1].hex(),'compact_transactions':len(b.vtx)}))
            except adapter.grpc.RpcError as e:
                print(json.dumps({'requested_height':h,'grpc_status':e.code().name}))
    finally:
        adapter.close()


if __name__=='__main__':main()
