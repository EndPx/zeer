import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.argv[2];
assert.ok(directory, 'Supply the local verification directory');
const readLines = async name => (await readFile(join(directory, name), 'utf8')).trim().split('\n').map(JSON.parse);
const initial = (await readLines('initial.jsonl')).at(-1);
assert.equal(initial.checkpoint.height, null, 'Verification requires fresh project volumes');
const fixture = JSON.parse(await readFile('benchmarks/fixtures/mainnet-nu5-full-v1/fixture.json', 'utf8'));
for (const [file, from, to, blocks, txs] of [
  ['first.jsonl', null, 1687106, 1, fixture.blocks[0].decoded.tx.length],
  ['resume.jsonl', 1687106, 1687108, 2, fixture.blocks.slice(1).reduce((n, b) => n + b.decoded.tx.length, 0)],
  ['repeat.jsonl', 1687108, 1687108, 0, 0],
]) {
  const result = (await readLines(file)).at(-1);
  assert.equal(result.state, 'complete');
  assert.equal(result.initialHeight, from);
  assert.equal(result.finalHeight, to);
  assert.equal(result.blocks, blocks);
  assert.equal(result.transactions, txs);
}
const failure = (await readLines('outside-range.jsonl')).at(-1);
assert.equal(failure.error.code, 'REQUESTED_RANGE_NOT_AVAILABLE');
console.log(JSON.stringify({ status: 'PASS', freshDatabase: true, resumedOnlyRemainingBlocks: true,
  repeatedSyncCommitsZeroBlocks: true, unavailableRangeRejected: true }));
