import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyBytes,validateCapabilities,release,ownerOnly} from './install-scanner.mjs';
test('corrupted, truncated and oversized artifacts fail before execution',()=>{
 const bytes=Buffer.from('known fixture'),expected={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 verifyBytes(bytes,expected);for(const bad of [Buffer.from('unknown!!!!!!'),bytes.subarray(1),Buffer.concat([bytes,Buffer.from('x')])])assert.throws(()=>verifyBytes(bad,expected));
});
test('a private mode does not make another UID an owner-controlled installation',()=>{
 assert.equal(ownerOnly({uid:1001,mode:0o700},0),false);assert.equal(ownerOnly({uid:0,mode:0o777},0),false);assert.equal(ownerOnly({uid:0,mode:0o700},0),true);
 assert.equal(ownerOnly({uid:0,mode:0o755},0,0o022),true);assert.equal(ownerOnly({uid:0,mode:0o755},0),false);
});
test('version, network, protocol and note pools must match the keyless release profile',()=>{
 const value={scanner_version:release.scanner_version,protocol_version:1,network:'testnet',watch_only:true,stateless:true,key_file_required:true,max_frame_bytes:4100000,pools:['sapling','orchard','ironwood']};validateCapabilities(value);
 for(const changes of [{protocol_version:2},{network:'mainnet'},{scanner_version:'999'},{pools:['orchard']},{watch_only:false}])assert.throws(()=>validateCapabilities({...value,...changes}));
});
