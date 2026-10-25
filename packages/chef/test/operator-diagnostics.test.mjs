import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {PrepError, ReorgError} from '@zeer-dev/prep-client';
import {artifactIdentity, normalizeArtifactIdentity, diagnosticAction, operatorDiagnostic} from '../dist/operator-diagnostics.js';
import {cliFailure, readStatus, formatOutput} from '../dist/cli-output.js';
import {CliError} from '../dist/cli-error.js';

const checkpoint={height:10,hash:'a'.repeat(64),anchorHash:'b'.repeat(64),status:'ready'};
const meta={network:'testnet',payload_kind:'full-v1',ready:true,archive_height:12,indexed_height:12,
  source_height:15,lag_blocks:3,source_observed_at:100,epoch:'2',start_block:1,source_mode:'follower'};

test('diagnostic actions distinguish authentication, temporary failures, identity and reorg without echoing details',()=>{
  const secret='https://private:password@example.invalid/?ufvk=PRIVATE_MEMO';
  for(const [error,knownCode,category,policy] of [
    [new PrepError(secret,401),undefined,'fix_authentication','after_operator_correction'],
    [new PrepError(secret,403),undefined,'fix_authentication','after_operator_correction'],
    [new PrepError(secret,429),undefined,'retry_transient','bounded_operator_policy'],
    [new PrepError('TRANSPORT_ERROR'),undefined,'retry_transient','bounded_operator_policy'],
    [new DOMException(secret,'TimeoutError'),undefined,'retry_transient','bounded_operator_policy'],
    [new PrepError(secret,503),undefined,'wait_for_source','bounded_operator_policy'],
    [new ReorgError(),undefined,'reconcile','bounded_operator_policy'],
    [{code:'28P01',message:secret},undefined,'fix_authentication','after_operator_correction'],
    [{code:'53300',message:secret},undefined,'retry_transient','bounded_operator_policy'],
    [new Error(secret),'SOURCE_NETWORK_OR_KIND_MISMATCH','restore_source_identity','after_operator_correction'],
    [new Error(secret),'REBUILD_REQUIRED','rebuild','after_operator_correction'],
    [new Error(secret),'RECONCILIATION_REQUIRED','reconcile','after_operator_correction'],
  ]){
    const result=cliFailure(error,knownCode);
    assert.equal(result.action.category,category);assert.equal(result.action.retryPolicy,policy);
    assert.equal(JSON.stringify(result).includes(secret),false);
  }
  assert.equal(cliFailure(new PrepError('RATE_LIMITED',429)).error.code,'SOURCE_UNAVAILABLE');
  assert.deepEqual(diagnosticAction('ARBITRARY_SECRET'),{category:'inspect',retryPolicy:'after_operator_correction'});
});

test('unavailable build provenance is explicit and malformed identity is never echoed',()=>{
  const fallback={packageName:'@zeer-dev/chef',packageVersion:'unknown',buildCommit:'unknown',sourceState:'unknown'};
  for(const value of [null,[],{},'private', {schemaVersion:1,packageName:'private',packageVersion:'token'}]) assert.deepEqual(normalizeArtifactIdentity(value),fallback);
  const normalized=normalizeArtifactIdentity({schemaVersion:1,packageName:'@zeer-dev/chef',packageVersion:'https://secret',buildCommit:'VIEWING_KEY',sourceState:'MEMO'});
  assert.deepEqual(normalized,fallback);
  assert.equal(normalizeArtifactIdentity({schemaVersion:1,packageName:'@zeer-dev/chef',packageVersion:'0.7.0',buildCommit:'unknown',sourceState:'clean'}).sourceState,'unknown');
  const valid={packageName:'@zeer-dev/chef',packageVersion:'0.7.0-rc.1',buildCommit:'a'.repeat(40),sourceState:'modified'};
  assert.deepEqual(normalizeArtifactIdentity({schemaVersion:1,...valid}),valid);
  const identity=artifactIdentity();identity.packageVersion='modified-by-caller';
  assert.notEqual(artifactIdentity().packageVersion,'modified-by-caller');
});

test('source observation ages use original Prep timestamp and clock skew remains unknown',()=>{
  const source={availability:'available',archiveStart:1,archiveHeight:12,indexedHeight:12,sourceObservedAt:100,sourceHeight:15};
  const options={project:'inbox',network:'testnet',startHeight:1,checkpoint,source,code:'OK',nowSeconds:150};
  const result=operatorDiagnostic(options);
  assert.equal(result.sourceObservationAgeSeconds,50);assert.equal(result.sourceObservedAt,100);
  assert.equal(result.observedAt,150);assert.equal(result.lastCommitAt,null);
  assert.equal(result.observationClock,'ordered');assert.equal(result.coverage.archiveStartHeight,1);
  for(const at of [null,NaN,-1,151]){
    const value=operatorDiagnostic({...options,source:{...source,sourceObservedAt:at}});
    assert.equal(value.sourceObservationAgeSeconds,null);
    assert.equal(value.observationClock,at===151?'future_observation':'unknown');
  }
  const secret='PRIVATE_URL_UFVK_MEMO';
  const malformed=operatorDiagnostic({...options,project:secret,network:secret,startHeight:secret,
    checkpoint:{height:secret,hash:secret,anchorHash:secret,status:secret,undoFloor:secret,reconcileKind:secret,memo:secret},
    source:{...source,archiveStart:secret,archiveHeight:secret,indexedHeight:secret},projectGeneration:secret,dataRevision:secret,lastCommitAt:secret});
  assert.equal(JSON.stringify(malformed).includes(secret),false);
});

test('status uses one persisted consumption snapshot when available and preserves transient diagnosis',async()=>{
  const state={checkpoint,generation:'a'.repeat(8)+'-aaaa-aaaa-aaaa-'+'a'.repeat(12),revision:'9007199254740993',lastCommitAt:'2026-10-25T00:00:00.000Z'};
  const result=await readStatus({project:'inbox',network:'testnet',startHeight:1,
    store:{checkpoint(){assert.fail('Must use checkpoint from the same consumption snapshot');},async consumptionStatus(){return state;}},
    client:{async getHeight(){throw new PrepError('PRIVATE_TOKEN',429);}}});
  assert.deepEqual(result.checkpoint,checkpoint);assert.equal(result.diagnostic.project,'inbox');
  assert.equal(result.diagnostic.lastCommitAt,state.lastCommitAt);assert.equal(result.diagnostic.dataRevision,state.revision);
  assert.equal(result.diagnostic.projectGeneration,state.generation);
  assert.equal(result.diagnostic.action.category,'retry_transient');assert.equal(result.readGate,'ready');
  assert.equal(result.diagnostic.coverage.prepIndexedHeight,null);assert.equal(result.diagnostic.sourceObservationAgeSeconds,null);
  assert.equal(JSON.stringify(result).includes('PRIVATE_TOKEN'),false);
  const blocked=await readStatus({network:'testnet',startHeight:1,
    store:{async checkpoint(){return {...checkpoint,status:'blocked'};}},client:{async getHeight(){throw new PrepError('AUTH',401);}}});
  assert.equal(blocked.diagnostic.action.category,'rebuild');assert.equal(blocked.readGate,'blocked');
});

test('status and terminal error preserve the same normalized action without changing legacy codes',async()=>{
  for(const [error,expectedCode,category] of [
    [new PrepError('PRIVATE_AUTH_BODY',401),'PREP_UNAUTHORIZED','fix_authentication'],
    [new PrepError('PRIVATE_RATE_BODY',429),'SOURCE_UNAVAILABLE','retry_transient'],
    [new PrepError('TRANSPORT_ERROR'),'SOURCE_UNAVAILABLE','retry_transient'],
    [new DOMException('PRIVATE_TIMEOUT_BODY','TimeoutError'),'SOURCE_UNAVAILABLE','retry_transient'],
    [new PrepError('PRIVATE_503_BODY',503),'SOURCE_UNAVAILABLE','wait_for_source'],
    [null,'SOURCE_NETWORK_OR_KIND_MISMATCH','restore_source_identity'],
  ]){
    const status=await readStatus({network:'testnet',startHeight:1,store:{async checkpoint(){return checkpoint;}},
      client:{async getHeight(){if(error)throw error;return {...meta,network:'mainnet'};}}});
    const code=status.source.availability==='unavailable'?status.source.errorCode:'SOURCE_NETWORK_OR_KIND_MISMATCH';
    const terminal=cliFailure(new CliError(code,{retryTransient:status.diagnostic.action.category==='retry_transient'}),code);
    assert.equal(code,expectedCode);assert.equal(terminal.error.code,expectedCode);
    assert.equal(status.diagnostic.action.category,category);assert.deepEqual(terminal.action,status.diagnostic.action);
    assert.equal(JSON.stringify(terminal).includes('PRIVATE_'),false);
  }
  // An arbitrary object/action cannot smuggle in a retry classification.
  assert.equal(cliFailure({retryTransient:true},'SOURCE_UNAVAILABLE').action.category,'wait_for_source');
  assert.equal(cliFailure(new CliError('PREP_UNAUTHORIZED',{retryTransient:true}),'PREP_UNAUTHORIZED').action.category,'fix_authentication');
});

test('human heartbeat separates advisory pending work, heartbeat and acknowledged checkpoint',()=>{
  const progress={phase:'scanning',phaseSince:'2026-10-25T00:00:00Z',lastProgressAt:'2026-10-25T00:00:01Z',heartbeatAt:'2026-10-25T00:00:06Z',
    committedHeight:10,processingRange:{from:11,to:12},prepArchiveHeight:15,prepIndexedHeight:15,sourceObservedHeight:16,sourceObservedAt:100};
  const value={command:'sync',state:'heartbeat',progress};
  const human=formatOutput(value,true);
  assert.match(human,/Active phase: scanning/);assert.match(human,/Committed height: 10; pending range \(not committed\): 11-12/);
  assert.match(human,/Last progress: 2026-10-25T00:00:01Z; heartbeat: 2026-10-25T00:00:06Z/);
  assert.match(human,/heartbeat does not establish new committed progress/);
  assert.deepEqual(JSON.parse(formatOutput(value,false)),value);
});

test('build identity is deterministic, labels modified sources and does not inherit unrelated checkout identity',async t=>{
  const root=await mkdtemp(join(tmpdir(),'chef-artifact-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const script=fileURLToPath(new URL('../scripts/write-build-identity.mjs',import.meta.url));
  const metadata={name:'@zeer-dev/chef',version:'0.7.0'};
  await mkdir(join(root,'dist'));await mkdir(join(root,'src'));await writeFile(join(root,'src','runtime.ts'),'// source\n');
  await writeFile(join(root,'package.json'),JSON.stringify(metadata));await writeFile(join(root,'.gitignore'),'dist/\n');
  const build=()=>{execFileSync(process.execPath,[script,join(root,'package.json')],{stdio:'pipe'});return readFile(join(root,'dist','build-identity.json'),'utf8');};
  const unknown=JSON.parse(await build());assert.equal(unknown.buildCommit,'unknown');assert.equal(unknown.sourceState,'unknown');
  const git=args=>execFileSync('git',['-C',root,...args],{stdio:'pipe',encoding:'utf8'}).trim();
  git(['init']);git(['add','.']);git(['-c','user.name=Chef Test','-c','user.email=test@example.invalid','commit','-m','source']);
  const clean=await build();assert.equal(clean,await build());assert.equal(JSON.parse(clean).buildCommit,git(['rev-parse','HEAD']));assert.equal(JSON.parse(clean).sourceState,'clean');
  await writeFile(join(root,'src','runtime.ts'),'// changed\n');assert.equal(JSON.parse(await build()).sourceState,'modified');
  const copied=join(root,'copied');await mkdir(copied);await mkdir(join(copied,'dist'));await mkdir(join(copied,'src'));await writeFile(join(copied,'src','runtime.ts'),'// copied\n');await writeFile(join(copied,'package.json'),JSON.stringify(metadata));
  execFileSync(process.execPath,[script,join(copied,'package.json')],{stdio:'pipe'});
  assert.equal(JSON.parse(await readFile(join(copied,'dist','build-identity.json'),'utf8')).buildCommit,'unknown');
  const redirected=join(root,'redirected');await mkdir(redirected);await mkdir(join(redirected,'dist'));await mkdir(join(redirected,'src'));
  await writeFile(join(redirected,'package.json'),JSON.stringify(metadata));await writeFile(join(redirected,'src','runtime.ts'),'// different untracked source\n');
  execFileSync(process.execPath,[script,join(redirected,'package.json')],{stdio:'pipe',env:{...process.env,GIT_DIR:join(root,'.git'),GIT_WORK_TREE:root}});
  const safe=JSON.parse(await readFile(join(redirected,'dist','build-identity.json'),'utf8'));
  assert.equal(safe.buildCommit,'unknown');assert.equal(safe.sourceState,'unknown');
});
