import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const data = JSON.parse(await readFile(new URL('../static/benchmarks/2026-10-20-testnet.json', import.meta.url), 'utf8'));
const chefPage = await readFile(new URL('../content/chef-benchmarks.md', import.meta.url), 'utf8');
const prepPage = await readFile(new URL('../content/prep-benchmarks.md', import.meta.url), 'utf8');
const prepOverview = await readFile(new URL('../content/prep-overview.md', import.meta.url), 'utf8');
const chefOverview = await readFile(new URL('../content/chef-overview.md', import.meta.url), 'utf8');
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const expected = {headers: [99024, 0.967156, 0.689918], genesis_id: [1, 0.234639, 0.004171], orchard: [0, 0.418542, 0.108843]};
for (const page of [chefPage, prepPage, chefOverview, prepOverview]) assert.doesNotMatch(page, /\b(?:ms|milliseconds?)\b/i);
assert.ok(prepOverview.includes('[Benchmarks](/docs/prep/benchmarks/)'));
assert.ok(chefOverview.includes('[Benchmarks](/docs/chef/benchmarks/)'));
assert.doesNotMatch(prepOverview, /\/docs\/chef\/benchmarks/);
for (const product of ['prep', 'chef']) {
  const snapshot = JSON.parse(await readFile(new URL(`../static/benchmarks/2026-10-20-${product}-testnet.json`, import.meta.url), 'utf8'));
  assert.equal(snapshot.product, product);
  assert.deepEqual(snapshot[product], data[product]);
  assert.equal(Object.hasOwn(snapshot, product === 'prep' ? 'chef' : 'prep'), false);
  assert.deepEqual(snapshot.environment, data.environment);
  assert.equal(snapshot.source_commit, data.source_commit);
  for (const [name, hash] of Object.entries(snapshot.original_evidence_sha256)) assert.equal(hash, data.original_evidence_sha256[name]);
}
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
    assert.equal(Number((median(selected.map(run => run.elapsedMs)) / 1000).toFixed(6)), value);
    assert.ok(prepPage.includes(`${value.toFixed(6)} s`));
    assert.ok(prepOverview.includes(`${value.toFixed(6)} s`));
    assert.equal(chefPage.includes(`${value.toFixed(6)} s`), false);
    assert.equal(chefOverview.includes(`${value.toFixed(6)} s`), false);
  }
  const fixedMedian = median(runs.filter(run => run.mode === 'fixed').map(run => run.elapsedMs));
  const adaptiveMedian = median(runs.filter(run => run.mode === 'adaptive').map(run => run.elapsedMs));
  const speedup = (fixedMedian / adaptiveMedian).toFixed(2);
  assert.ok(prepOverview.includes(`| ${(fixedMedian / 1000).toFixed(6)} s | ${(adaptiveMedian / 1000).toFixed(6)} s | ${speedup}× |`));
}
for (const [profile, first, elapsed] of [['fixed', 1.201, 36.696], ['adaptive', 1.591, 35.215]]) {
  const run = data.chef[profile];
  assert.equal(run.blocks, 10000); assert.equal(run.from, 0); assert.equal(run.to, 9999);
  assert.equal(run.exactOracleMatch, true); assert.equal(run.graphqlCheckpoint.height, 9999);
  assert.equal(Number((run.firstDataMs / 1000).toFixed(3)), first);
  assert.equal(Number((run.elapsedMs / 1000).toFixed(3)), elapsed);
  assert.ok(chefPage.includes(`${first.toFixed(3)} s`));
  assert.ok(chefPage.includes(`${elapsed.toFixed(3)} s`));
  assert.ok(chefOverview.includes(`${first.toFixed(3)} s`));
  assert.ok(chefOverview.includes(`${elapsed.toFixed(3)} s`));
  assert.equal(prepPage.includes(`${elapsed.toFixed(3)} s`), false);
}
assert.deepEqual(data.chef.fixed.graphqlCheckpoint, data.chef.adaptive.graphqlCheckpoint);
console.log('Separate Prep retrieval and Chef indexing pages, overview values and product-only evidence match the original samples.');
