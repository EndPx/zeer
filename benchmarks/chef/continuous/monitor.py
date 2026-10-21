"""Linux cgroup counters; launch inside the same externally bounded study group."""
from pathlib import Path
import json,os,signal,sys,time

output=Path(sys.argv[1]);relative=Path('/proc/self/cgroup').read_text().strip().split('::',1)[1].lstrip('/')
group=Path('/sys/fs/cgroup')/relative;assert 'zeer-testnet-web-build.service' in group.parts
stopped=False
def stop(*_):
 global stopped
 stopped=True
signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
def numbers(path):return {parts[0]:int(parts[1]) for line in path.read_text().splitlines() if len(parts:=line.split())==2}
proof={'format':'zeer-study-cgroup-v1','clock':'host monotonic; counters cumulative since group creation','samples':[]}
started=time.monotonic()
while True:
 sample={'at_unix':time.time(),'cpu':numbers(group/'cpu.stat'),'memory_bytes':int((group/'memory.current').read_text()),'memory_peak_bytes':int((group/'memory.peak').read_text()),'memory_events':numbers(group/'memory.events')}
 proof['samples'].append(sample);proof['captured_at_unix']=sample['at_unix'];proof['stopped']=stopped
 temporary=output.with_suffix('.tmp');temporary.write_text(json.dumps(proof,indent=2)+'\n');os.replace(temporary,output)
 if stopped or time.monotonic()-started>4500:break
 for _ in range(100):
  if stopped:break
  time.sleep(.1)
