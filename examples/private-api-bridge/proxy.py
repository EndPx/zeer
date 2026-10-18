#!/usr/bin/env python3
"""Forced-command bridge: fixed read-only API routes, never a shell or raw RPC."""
import fcntl,json,os,resource,signal,sys,time,urllib.request,urllib.error
from pathlib import Path
ROOT=Path('/opt/zeer-api-bridge')
MAX=8*1024*1024
resource.setrlimit(resource.RLIMIT_AS,(128*1024*1024,128*1024*1024))
resource.setrlimit(resource.RLIMIT_CPU,(5,5))
signal.alarm(18)
def emit(status,body):
    sys.stdout.write(json.dumps({'status':status,'body':body},separators=(',',':'),ensure_ascii=False));sys.stdout.flush()
def fail(status):emit(status,{'error':'Request unavailable'})
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None
def main():
    if os.environ.get('SSH_ORIGINAL_COMMAND')!='zeer-query':return fail(403)
    raw=sys.stdin.buffer.read(16385)
    if len(raw)>16384:return fail(413)
    try:q=json.loads(raw)
    except ValueError:return fail(400)
    if not isinstance(q,dict) or set(q)-{'service','route','body'}:return fail(400)
    service,route=q.get('service'),q.get('route')
    allowed={'prep':{'/height','/health','/ready','/capabilities','/query','/transactions'},'chef':{'/graphql'}}
    if service not in allowed or route not in allowed[service]:return fail(403)
    body=q.get('body')
    if route in ('/height','/health','/ready','/capabilities') and body is not None:return fail(400)
    if route not in ('/height','/health','/ready','/capabilities') and not isinstance(body,dict):return fail(400)
    slots=[]
    for index in range(2):
        f=(ROOT/'state'/f'slot-{index}').open('a')
        try:fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);slots.append(f);break
        except BlockingIOError:f.close()
    if not slots:return fail(429)
    with (ROOT/'state/rate').open('a+') as rate:
        fcntl.flock(rate,fcntl.LOCK_EX)
        rate.seek(0)
        try:state=json.load(rate)
        except ValueError:state={'minute':0,'count':0}
        minute=int(time.time()//60)
        if state['minute']!=minute:state={'minute':minute,'count':0}
        if state['count']>=120:return fail(429)
        state['count']+=1;rate.seek(0);rate.truncate();json.dump(state,rate);rate.flush()
    config=json.loads((ROOT/'config.json').read_text()).get(service)
    if not config:return fail(503)
    # Targets are operator-owned fixed loopback endpoints, not request input.
    target=('http://127.0.0.1:39368' if service=='prep' else 'http://127.0.0.1:39370')+route
    req=urllib.request.Request(target,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+config['token']})
    try:
        with urllib.request.build_opener(NoRedirect()).open(req,timeout=12) as result:
            data=result.read(MAX+1)
            if len(data)>MAX:return fail(413)
            emit(result.status,json.loads(data))
    except urllib.error.HTTPError as e:
        if e.code==409:
            try:
                data=e.read(8193)
                if len(data)<=8192 and json.loads(data).get('error',{}).get('code')=='REORG':return emit(409,{'error':{'code':'REORG'}})
            except Exception:pass
        fail(e.code if e.code in (400,401,403,409,413,416,429,503) else 502)
    except Exception:fail(503)
try:main()
except Exception:fail(503)
