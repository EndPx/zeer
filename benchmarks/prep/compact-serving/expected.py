import argparse,pathlib,json,gzip,hashlib,struct
parser=argparse.ArgumentParser(description='Derive expected hashes from verified capture frames, not the service.')
parser.add_argument('--root',type=pathlib.Path,required=True)
root=parser.parse_args().root.resolve()
lo,upper,tip=280000,4382797,4382897
heights={int(x['height']) for x in json.loads((root/'reference/data-heights.json').read_text())}
samples={};chunks=[];whole=hashlib.sha256();chunk=hashlib.sha256();chunk_start=lo;chunk_count=0;total=0
for index in range(42):
 proof=json.loads((root/f'frames-{index:03d}.json').read_text());check=hashlib.sha256()
 with gzip.open(root/f'frames-{index:03d}.pb.gz','rb') as f:
  for height in range(proof['start'],proof['end']+1):
   prefix=f.read(4);assert len(prefix)==4;size=struct.unpack('<I',prefix)[0];assert 0<size<=4*1024**2
   raw=f.read(size);assert len(raw)==size;check.update(prefix);check.update(raw)
   if height in heights:samples[str(height)]=hashlib.sha256(raw).hexdigest()
   if height<=upper:
    framed=size.to_bytes(8,'big')+raw;whole.update(framed);chunk.update(framed);chunk_count+=1;total+=1
    if chunk_count==10000 or height==upper:
     chunks.append({'start':chunk_start,'end':height,'blocks':chunk_count,'digest':chunk.hexdigest()});chunk_start=height+1;chunk_count=0;chunk=hashlib.sha256()
  assert not f.read(1)
 assert check.hexdigest()==proof['sha256']
assert total==4102798 and len(chunks)==411 and set(map(int,samples))==heights
result={'lower':lo,'upper':upper,'tip':tip,'blocks':total,'samples':samples,'chunks':chunks,'digest':whole.hexdigest(),'digestEncoding':'SHA-256 of 8-byte big-endian payload length + deterministic protobuf, same as reference lw.digest'}
(root/'expected.json').write_text(json.dumps(result,indent=2));print(json.dumps({'blocks':total,'chunks':len(chunks),'uniqueHeights':len(samples),'digest':whole.hexdigest()}))
