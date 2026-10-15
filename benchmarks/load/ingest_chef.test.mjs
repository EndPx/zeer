import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { privateOrigin, ignoredPath, cleanupFailures } from './ingest_chef.mjs';

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
