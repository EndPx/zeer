"""Replay a checksum-pinned synthetic block archive into an isolated regtest node."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import time
from benchmarks.scripts.prepare_regtest import call


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--endpoint',required=True)
    p.add_argument('--archive',type=Path,required=True)
    p.add_argument('--metadata',type=Path,required=True)
    a=p.parse_args()
    meta=json.loads(a.metadata.read_text()); raw=a.archive.read_bytes()
    if meta.get('network')!='regtest' or hashlib.sha256(raw).hexdigest()!=meta['sha256']:raise ValueError('Archive identity mismatch')
    records=[json.loads(line) for line in gzip.decompress(raw).splitlines()]
    if len(records)!=meta['blocks'] or len(records)>2048:raise ValueError('Invalid block count')
    deadline=time.monotonic()+1200
    genesis=call(a.endpoint,'getblockhash',[0],deadline)
    if genesis!=meta['genesis_hash'] or genesis!='029f11d80ef9765602235e1bc9727e3eb6ba20839319f761fee920d63401e327':raise ValueError('Refusing non-benchmark chain')
    height=call(a.endpoint,'getblockchaininfo',[],deadline)['blocks']
    if height>len(records):raise ValueError('Existing chain exceeds fixture')
    for n,record in enumerate(records,1):
        if record['height']!=n:raise ValueError('Noncontiguous archive')
        if n>height:
            result=call(a.endpoint,'submitblock',[record['hex']],deadline)
            if result is not None:raise ValueError('Block rejected')
        if call(a.endpoint,'getblockhash',[n],deadline)!=record['hash']:raise ValueError('Replay hash mismatch')
    print(json.dumps({'status':'PASS','replayed_blocks':len(records),'tip_hash':records[-1]['hash']}))


if __name__=='__main__':main()
