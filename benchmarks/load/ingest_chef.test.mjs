import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { PrepError } from '@zeer-dev/prep-client';
import { privateOrigin, ignoredPath, cleanupFailures, ingestRange, contiguousFixture, ingestDecision, sameSource, verifyProgressCheckpoint } from './ingest_chef.mjs';

test('cleanup failures retain safe resource names and exclude exception messages', () => {
  const error = new Error('postgres://user:secret@private');
  assert.deepEqual(cleanupFailures([{ status: 'fulfilled' }, { status: 'rejected', reason: error }], ['writer', 'reader']),
    [{ resource: 'reader', errorName: 'Error' }]);
});

test('actual-ingest helper only admits numeric private IPv4 HTTP origins', () => {
  for (const value of ['http://127.0.0.1:39368', 'http://10.5.1.2:80', 'http://172.31.1.1:8000', 'http://192.168.1.1'])
    assert.equal(privateOrigin(value), new URL(value).origin);
  for (const value of ['http://8.8.8.8', 'http://172.32.1.1', 'http://localhost:39368', 'https://127.0.0.1',
    'http://127.0.0.1/path', 'http://user:pass@127.0.0.1', 'http://127.0.0.1?token=secret', 'http://[::1]'])
    assert.throws(() => privateOrigin(value), /PRIVATE_NUMERIC_HTTP_ORIGIN_REQUIRED/);
});

test('writer reports and start signals remain inside ignored results', () => {
  const root = resolve('test-root');
  assert.equal(ignoredPath(resolve(root, 'benchmarks/results/run/active.json'), root), resolve(root, 'benchmarks/results/run/active.json'));
  for (const value of [resolve(root, 'benchmarks/results'), resolve(root, 'benchmarks/active.json'), resolve(root, 'benchmarks/results/../outside.json')])
    assert.throws(() => ignoredPath(value, root), /PATH_MUST_BE_IGNORED_RESULTS/);
});

function modernOracle(start = 1_687_106, count = 3) {
  return { range: { from: start, to: start + count - 1 }, source: { kind: 'test-only' },
    blocks: Array.from({ length: count }, (_, index) => ({ id: String(start + index), hash: String(index).padStart(64, '0'),
      time: String(1_700_000_000 + index), transactionCount: 1 })),
    transactions: Array.from({ length: count }, (_, index) => ({ id: String(index + 100).padStart(64, '0'),
      minedHeight: start + index, version: 5, locktime: '0', sizeBytes: 100, transparentInputCount: 0, transparentOutputCount: 0 })) };
}

test('range derives a modern prefix and preserves legacy warmup height', () => {
  assert.deepEqual(ingestRange(modernOracle()), { start: 1_687_106, end: 1_687_108, initial: 1_687_106 });
  assert.deepEqual(ingestRange(modernOracle(1, 2048)), { start: 1, end: 2048, initial: 128 });
  assert.deepEqual(ingestRange(modernOracle(2_000_000, 256)), { start: 2_000_000, end: 2_000_255, initial: 2_000_127 });
  assert.equal(ingestRange(modernOracle(), 1_687_107, 1_687_108).initial, 1_687_107);
  for (const initial of [1_687_105, 1_687_108, '1687106', 1_687_106.5])
    assert.throws(() => ingestRange(modernOracle(), initial), /INITIAL_HEIGHT_OUTSIDE_ORACLE_PREFIX/);
  assert.throws(() => ingestRange(modernOracle(), undefined, 1_687_107), /EXACT_ORACLE_RANGE_REQUIRED/);
});

test('captured height bounds apply to span and retain an active append suffix', () => {
  for (const range of [{ from: 0, to: 2 }, { from: 1, to: 1 }, { from: 5, to: 4 },
    { from: '1', to: 3 }, { from: 1, to: 32769 }, { from: 0xffff_fffe, to: 0xffff_ffff }])
    assert.throws(() => ingestRange({ range }), /BOUNDED_ORACLE_RANGE_REQUIRED/);
  assert.deepEqual(ingestRange({ range: { from: 0xffff_fffd, to: 0xffff_fffe } }),
    { start: 0xffff_fffd, end: 0xffff_fffe, initial: 0xffff_fffd });
});

test('modern oracle requires exactly one canonical block per inclusive range height', () => {
  const oracle = modernOracle();
  const fixture = contiguousFixture(oracle);
  assert.equal(fixture.blocks.length, 3);
  assert.equal(fixture.head.height, 1_687_108);
  assert.equal(fixture.head.hash, oracle.blocks[2].hash);
  // A valid public projection is insufficient when the captured range has a gap.
  oracle.blocks.splice(1, 1); oracle.transactions.splice(1, 1);
  assert.throws(() => contiguousFixture(oracle), /CONTIGUOUS_ORACLE_BLOCKS_REQUIRED/);
  const outside = modernOracle(); outside.range = { from: 1_687_105, to: 1_687_107 };
  assert.throws(() => contiguousFixture(outside), /CONTIGUOUS_ORACLE_BLOCKS_REQUIRED/);
});


test('follow mode waits only for known idle states and runtime-classified source errors', () => {
  for (const follow of [false, true]) assert.equal(ingestDecision({ state: 'progress', blocks: 8 }, follow), 'commit');
  for (const state of ['caught_up', 'source_unavailable']) {
    assert.equal(ingestDecision({ state, blocks: 0 }, true), 'wait');
    assert.throws(() => ingestDecision({ state, blocks: 0 }, false), /INGEST_DID_NOT_ADVANCE/);
  }
  for (const status of [429, 500, 503]) {
    const error = new PrepError('SOURCE_NOT_READY', status);
    assert.equal(ingestDecision(undefined, true, error), 'wait');
    assert.throws(() => ingestDecision(undefined, false, error), item => item === error);
  }
  for (const error of [new Error('SQL failure'), new PrepError('TRANSPORT_ERROR'), new PrepError('UNAUTHORIZED', 401),
    new DOMException('source timeout', 'TimeoutError'), Object.assign(new Error('spoof'), { status: 503 })])
    assert.throws(() => ingestDecision(undefined, true, error), item => item === error);
  for (const step of [{ state: 'progress', blocks: 0 }, { state: 'blocked', blocks: 0 },
    { state: 'caught_up', blocks: 1 }, undefined])
    assert.throws(() => ingestDecision(step, true), /INGEST_DID_NOT_ADVANCE/);
});

test('follow final source permits append growth but rejects epoch or identity changes', () => {
  const before = { network: 'mainnet', epoch: '7', revision: '11', archive_height: 1_687_137, payload_kind: 'full-v1', ready: true };
  const after = { ...before, revision: '123', archive_height: 1_687_361 };
  assert.equal(sameSource(before, before, false, 1_687_361), true);
  assert.equal(sameSource(before, after, false, 1_687_361), false);
  assert.equal(sameSource(before, after, true, 1_687_361), true);
  for (const change of [{ epoch: '8' }, { revision: '10' }, { revision: 'bad' }, { archive_height: 1_687_360 },
    { ready: false }, { network: 'testnet' }, { payload_kind: 'compact-v1' }])
    assert.equal(sameSource(before, { ...after, ...change }, true, 1_687_361), false);
});


test('follow recovery admits canonical reconciling progress while frozen mode requires ready', () => {
  const step = { state: 'progress', blocks: 8, height: 1_687_145 };
  const checkpoint = { height: step.height, hash: 'canonical-hash', status: 'reconciling' };
  const block = { hash: checkpoint.hash };
  assert.doesNotThrow(() => verifyProgressCheckpoint(step, checkpoint, block, true));
  assert.throws(() => verifyProgressCheckpoint(step, checkpoint, block, false), /WRITER_CHECKPOINT_NOT_READY/);
  for (const follow of [false, true]) {
    assert.doesNotThrow(() => verifyProgressCheckpoint(step, { ...checkpoint, status: 'ready' }, block, follow));
    assert.throws(() => verifyProgressCheckpoint(step, { ...checkpoint, height: step.height - 1 }, block, follow), /WRITER_CHECKPOINT_NOT_READY/);
    assert.throws(() => verifyProgressCheckpoint(step, { ...checkpoint, status: 'blocked' }, block, follow), /WRITER_CHECKPOINT_NOT_READY/);
    assert.throws(() => verifyProgressCheckpoint(step, { ...checkpoint, status: 'ready', hash: 'other' }, block, follow), /WRITER_CHECKPOINT_HASH_MISMATCH/);
    assert.throws(() => verifyProgressCheckpoint(step, { ...checkpoint, status: 'ready' }, undefined, follow), /WRITER_CHECKPOINT_HASH_MISMATCH/);
  }
});
