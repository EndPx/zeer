import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

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
    assert.equal(chefPage.includes(`${value.toFixed(6)} s`), false);
    assert.equal(chefOverview.includes(`${value.toFixed(6)} s`), false);
  }
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

const modern = JSON.parse(await readFile(new URL('../static/benchmarks/2026-10-21-prep-zebra-rpc.json', import.meta.url), 'utf8'));
const referenceRaw = await readFile(new URL(`../static/benchmarks/${modern.reference_file}`, import.meta.url));
const reference = JSON.parse(referenceRaw);
const hash = raw => createHash('sha256').update(raw).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = rows => hash(JSON.stringify(canonical(rows)));
assert.equal(modern.product, 'prep'); assert.equal(modern.network, 'testnet');
assert.equal(modern.manifest_sha256, hash(referenceRaw));
assert.equal(Object.hasOwn(modern, 'chef'), false);
assert.deepEqual(modern.range, {from_block: 4522544, to_block_exclusive: 4522800});
assert.equal(reference.from_block, modern.range.from_block); assert.equal(reference.to_block, modern.range.to_block_exclusive);
assert.deepEqual(reference.coverage_transactions, {sapling: 2, orchard: 2, ironwood: 181, transparent: 419, non_coinbase_transparent: 163});
assert.equal(reference.boundary_raw_header_hashes_verified, true);
assert.equal(modern.rpc_workers, 4); assert.equal(modern.repetitions_per_candidate, 3);
const counts = {headers: 256, transactions: 531, txids: 16, address: 200, sapling: 2, orchard: 2, ironwood: 181};
for (const trial of [modern, modern.earlier_trial]) {
  assert.equal(trial.status, 'PASS'); assert.equal(trial.runs.length, 42); assert.equal(trial.warmups.length, 14);
  assert.equal(trial.manifest_sha256, modern.manifest_sha256);
  for (const [workload, rows] of Object.entries(counts)) {
    assert.equal(reference.expected[workload].length, rows);
    assert.equal(digest(reference.expected[workload]), reference.expected_sha256[workload]);
    for (const candidate of ['prep', 'rpc']) {
      const selected = trial.runs.filter(run => run.workload === workload && run.candidate === candidate);
      assert.equal(selected.length, 3); assert.deepEqual(selected.map(run => run.round).sort(), [0, 1, 2]);
      const warmups = trial.warmups.filter(run => run.workload === workload && run.candidate === candidate);
      assert.equal(warmups.length, 1);
      for (const run of [...selected, ...warmups]) {
        assert.equal(run.status, 'PASS'); assert.equal(run.rows, rows); assert.equal(run.sha256, reference.expected_sha256[workload]);
        assert.ok(run.elapsed_seconds > 0 && run.elapsed_seconds < 90); assert.ok(run.verification_seconds >= 0);
        assert.ok(Number.isInteger(run.requests) && run.requests > 0);
        assert.ok(Number.isInteger(run.response_bytes) && run.response_bytes > 0);
      }
      const summary = trial.summary[workload][candidate];
      assert.equal(summary.median_seconds, median(selected.map(run => run.elapsed_seconds)));
      assert.equal(summary.median_requests, median(selected.map(run => run.requests)));
      assert.equal(summary.median_response_bytes, median(selected.map(run => run.response_bytes)));
      assert.equal(summary.rows, rows); assert.equal(summary.sha256, reference.expected_sha256[workload]);
    }
  }
}
for (const [workload, candidates] of Object.entries(modern.summary)) {
  const p = candidates.prep, r = candidates.rpc;
  const timeCells = `| ${p.median_seconds.toFixed(6)} s | ${r.median_seconds.toFixed(6)} s |`;
  assert.ok(prepPage.includes(timeCells), workload); assert.ok(prepOverview.includes(timeCells), workload);
  const bytes = value => value.toLocaleString('en-US');
  assert.ok(prepPage.includes(`| ${p.median_requests} / ${r.median_requests} | ${bytes(p.median_response_bytes)} / ${bytes(r.median_response_bytes)} |`));
  assert.equal(chefPage.includes(timeCells), false); assert.equal(chefOverview.includes(timeCells), false);
}
assert.ok(modern.summary.txids.rpc.median_seconds < modern.summary.txids.prep.median_seconds);
assert.ok(modern.earlier_trial.summary.address.rpc.median_seconds < modern.earlier_trial.summary.address.prep.median_seconds);
assert.ok(modern.summary.address.prep.median_seconds < modern.summary.address.rpc.median_seconds);
assert.match(prepPage, /address lookup winner changed/i); assert.match(prepPage, /unequal service allocations/i);
assert.match(prepPage, /Zebra RPC is faster for the 16 selected TX IDs/);
for (const [file, expectedHash] of Object.entries(modern.source_files_sha256)) {
  assert.equal(hash(await readFile(new URL(`../../../${file}`, import.meta.url))), expectedHash, file);
}
assert.equal(modern.harness_sha256, modern.source_files_sha256['benchmarks/prep/rpc/compare.py']);
assert.equal(modern.preparation.status, 'PASS'); assert.equal(modern.preparation.repetitions, 1);
assert.equal(modern.preparation.end_hash, reference.end_hash);
assert.equal(modern.preparation.prep_binary_sha256, modern.prep_binary_sha256);
assert.ok(prepPage.includes(`${modern.preparation.elapsed_seconds.toFixed(6)} s`));
assert.ok(prepPage.includes(modern.preparation.archive_file_bytes.toLocaleString('en-US')));
console.log('Prep/Zebra samples, reference hashes, medians, traffic, preparation and separate Chef evidence verified.');
