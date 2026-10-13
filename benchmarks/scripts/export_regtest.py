"""Export exact public synthetic block bytes so the frozen hashes can be replayed."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import time
from benchmarks.scripts.prepare_regtest import call
from benchmarks.runner import validate_manifest


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--endpoint',required=True)
    p.add_argument('--manifest',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args()
    manifest=json.loads(a.manifest.read_text())
    records=validate_manifest(manifest)
    if manifest['network']!='regtest':raise ValueError('Regtest only')
    deadline=time.monotonic()+300
    if call(a.endpoint,'getblockhash',[0],deadline)!=manifest['genesis_hash']:raise ValueError('Genesis mismatch')
    lines=[]
    for record in records:
        raw=call(a.endpoint,'getblock',[record['hash'],0],deadline)
        bytes.fromhex(raw)
        lines.append(json.dumps({'height':record['height'],'hash':record['hash'],'hex':raw},separators=(',',':'))+'\n')
    compressed=gzip.compress(''.join(lines).encode(),mtime=0)
    a.output.write_bytes(compressed)
    info={'file':a.output.name,'sha256':hashlib.sha256(compressed).hexdigest(),'blocks':len(lines),'compressed_bytes':len(compressed),'network':'regtest','genesis_hash':manifest['genesis_hash']}
    a.output.with_suffix(a.output.suffix+'.manifest.json').write_text(json.dumps(info,indent=2)+'\n')
    print(json.dumps(info))


if __name__=='__main__':main()
