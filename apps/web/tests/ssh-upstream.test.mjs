// Synthetic SSH server verifies transport lifecycle, not blockchain correctness.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import ssh2 from 'ssh2';
import {sshUpstream} from '../src/lib/ssh-upstream.ts';
const {Server,utils}=ssh2;
test('pinned connection reuse, isolated cancellation, bounded replies and reconnect',async()=>{
 const host=utils.generateKeyPairSync('ed25519'), user=utils.generateKeyPairSync('ed25519');
 const allowed=utils.parseKey(user.public), fingerprint=createHash('sha256').update(utils.parseKey(host.public).getPublicSSH()).digest('hex');
 let connections=0;const clients=new Set();
 const server=new Server({hostKeys:[host.private]},client=>{
  connections++;clients.add(client);client.on('error',()=>{});client.on('close',()=>clients.delete(client));
  client.on('authentication',ctx=>{
   if(ctx.username==='test-reader'&&ctx.method==='publickey'&&ctx.key.data.equals(allowed.getPublicSSH())&&(!ctx.signature||allowed.verify(ctx.blob,ctx.signature,ctx.hashAlgo)))ctx.accept();else ctx.reject();
  });
  client.on('ready',()=>client.on('session',accept=>{
   const session=accept();session.on('exec',(accept,reject,info)=>{
    assert.equal(info.command,'zeer-query');const stream=accept();let input='';stream.on('error',()=>{});stream.on('data',chunk=>input+=chunk);
    stream.on('end',async()=>{const q=JSON.parse(input);await delay(q.body?.delay??0);if(stream.destroyed)return;
     const response=q.body?.large?'x'.repeat(9*1024*1024):JSON.stringify({status:200,body:{id:q.body?.id,service:q.service}});
     stream.write(response);stream.exit(0);stream.end();
    });
   });
  }));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const previous={...process.env};
 Object.assign(process.env,{ZEER_SSH_HOST:'127.0.0.1',ZEER_SSH_PORT:String(server.address().port),ZEER_SSH_USER:'test-reader',ZEER_SSH_PRIVATE_KEY:user.private,ZEER_SSH_HOST_KEY_SHA256:fingerprint});
 try {
  for(const id of [1,2,3])assert.equal((await(await sshUpstream('prep','/query',{id})).json()).id,id);
  assert.equal(connections,1,'sequential queries reuse one verified connection and return fresh responses');
  const controller=new AbortController();const cancelled=assert.rejects(sshUpstream('prep','/query',{delay:200,id:4},controller.signal),/aborted/);
  const simultaneous=sshUpstream('chef','/graphql',{delay:60,id:5});await delay(10);controller.abort();await cancelled;
  assert.equal((await(await simultaneous).json()).id,5);assert.equal(connections,1,'cancelling one channel preserves the other');
  await assert.rejects(sshUpstream('prep','/query',{large:true}),/too large/);
  assert.equal((await(await sshUpstream('prep','/height',{id:6})).json()).id,6);
  for(const client of clients)client.end();await delay(100);
  assert.equal((await(await sshUpstream('prep','/height',{id:7})).json()).id,7);assert.equal(connections,2);
  process.env.ZEER_SSH_HOST_KEY_SHA256='0'.repeat(64);
  await assert.rejects(sshUpstream('prep','/height'),/closed|connection/);
  process.env.ZEER_SSH_HOST_KEY_SHA256=fingerprint;
  assert.equal((await(await sshUpstream('prep','/height',{id:8})).json()).id,8);
  await assert.rejects(sshUpstream('prep','/query',{large:'x'.repeat(17000)}),/too large/);
 }finally{
  for(const name of ['ZEER_SSH_HOST','ZEER_SSH_PORT','ZEER_SSH_USER','ZEER_SSH_PRIVATE_KEY','ZEER_SSH_HOST_KEY_SHA256']){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}
  for(const client of clients)client.end();await new Promise(r=>server.close(r));
 }
});
