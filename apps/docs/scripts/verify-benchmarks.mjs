import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const data = JSON.parse(await readFile(new URL('../static/benchmarks/2026-10-20-testnet.json', import.meta.url), 'utf8'));
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const expected = {headers: [99024, 967.156, 689.918], genesis_id: [1, 234.639, 4.171], orchard: [0, 418.542, 108.843]};
assert.equal(data.network, 'testnet');
assert.equal(data.prep.runs.length, 18);
for (const [name, [rows, fixed, adaptive]] of Object.entries(expected)) {
  const runs = data.prep.runs.filter(run => run.name === name);
  assert.equal(new Set(runs.map(run => run.digest)).size, 1);
  for (const [mode, value] of [['fixed', fixed], ['adaptive', adaptive]]) {
    const selected = runs.filter(run => run.mode === mode);
    assert.equal(selected.length, 3);
    assert.deepEqual(selected.map(run => run.round).sort(), [0, 1, 2]);
    for (const run of selected) {
      assert.equal(run.rows, rows); assert.equal(run.from, 0); assert.equal(run.to, 99024);
      assert.equal(run.errors, 0); assert.ok(run.elapsedMs > 0); assert.match(run.digest, /^[a-f0-9]{64}$/);
    }
    assert.equal(Number(median(selected.map(run => run.elapsedMs)).toFixed(3)), value);
  }
}
for (const [profile, first, elapsed] of [['fixed', 1.201, 36.696], ['adaptive', 1.591, 35.215]]) {
  const run = data.chef[profile];
  assert.equal(run.blocks, 10000); assert.equal(run.from, 0); assert.equal(run.to, 9999);
  assert.equal(run.exactOracleMatch, true); assert.equal(run.graphqlCheckpoint.height, 9999);
  assert.equal(Number((run.firstDataMs / 1000).toFixed(3)), first);
  assert.equal(Number((run.elapsedMs / 1000).toFixed(3)), elapsed);
}
assert.deepEqual(data.chef.fixed.graphqlCheckpoint, data.chef.adaptive.graphqlCheckpoint);
console.log('Published benchmark sample counts, equality checks and displayed aggregates match.');
