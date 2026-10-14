import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { parseModel, encodeEntity } from '@zeer/chef';
import { digest, hash, publicFixture, syntheticFixture, page, workloads, sqlQuery } from './fixture.mjs';

test('committed public input yields complete example projections with all four application workflows', async () => {
  const bytes = await readFile(new URL('../../fixtures/mainnet-public-2048/oracle.json.gz', import.meta.url));
  assert.equal(hash(bytes), 'fd230e62f1f4909f394c3a2c21f6cc9f0e651bc707bc05e924701a8a82a7cc73');
  const fixture = publicFixture(JSON.parse(gunzipSync(bytes).toString('utf8')));
  assert.equal(fixture.blocks.length, 2048);
  assert.equal(fixture.transactions.length, 16962);
  assert.equal(fixture.head.height, 2048);
  assert.equal(fixture.provenance.kind, 'public_oracle_projection');
  const model = parseModel(await readFile(new URL('../../../examples/chef-public/schema.graphql', import.meta.url), 'utf8'));
  for (const row of fixture.transactions) assert.equal(encodeEntity(model, 'PublicTransaction', row).locktime, row.locktime);
  for (const row of fixture.blocks) assert.equal(encodeEntity(model, 'Block', row).time, row.time);
  const cases = workloads(fixture);
  assert.deepEqual([...new Set(cases.map(item => item.workflow))].sort(), ['block_summaries', 'block_transactions', 'transaction_detail', 'version_browser']);
  assert.ok(cases.some(item => item.name === 'block_transactions_second'));
  assert.ok(cases.some(item => item.name.includes('deep_cursor')));
});

test('synthetic selectivity data is deterministic and explicitly distinct from chain provenance', () => {
  const fixture = syntheticFixture(5000);
  assert.equal(fixture.transactions.length, 5000);
  assert.equal(fixture.provenance.kind, 'synthetic_selectivity_only');
  assert.equal(digest(fixture), digest(syntheticFixture(5000)));
  assert.equal(new Set(fixture.transactions.map(row => row.id)).size, 5000);
  assert.equal(fixture.transactions.filter(row => row.version === 2).length, 5);
  assert.equal(fixture.transactions.filter(row => row.version === 4).length, 245);
  assert.equal(fixture.transactions.filter(row => row.version === 5).length, 4750);
  assert.equal(fixture.blocks.reduce((count, block) => count + block.transactionCount, 0), 5000);
  assert.ok(fixture.transactions.some(row => row.locktime === '4294967295'));
  for (const count of [999, 1000001, 2.5]) assert.throws(() => syntheticFixture(count), /INVALID_SYNTHETIC_ROW_COUNT/);
});

test('page oracle uses lexical ID order and a cursor only if a further row exists', () => {
  const rows = [{ id: '1', version: 2 }, { id: '10', version: 2 }, { id: '2', version: 2 }, { id: '3', version: 5 }];
  assert.deepEqual(page(rows, { first: 2, where: { version: 2 } }), { items: rows.slice(0, 2), nextCursor: '10' });
  assert.deepEqual(page(rows, { first: 2, after: '10', where: { version: 2 } }), { items: [rows[2]], nextCursor: null });
  assert.deepEqual(page(rows, { first: 2, after: '3', where: {} }), { items: [], nextCursor: null });
});

test('plan SQL uses the production parameterized JSONB equality and bounded keyset shape', () => {
  const namespace = 'chef_q_0123456789abcdef';
  const query = sqlQuery(namespace, { entity: 'PublicTransaction', options: { first: 100, after: 'abc', where: { minedHeight: 500 } } });
  assert.equal(query.text, 'SELECT data FROM "chef_q_0123456789abcdef".entities WHERE entity=$1 AND id > $2 AND data -> $3::text = $4::jsonb ORDER BY id ASC LIMIT $5');
  assert.deepEqual(query.values, ['PublicTransaction', 'abc', 'minedHeight', '500', 101]);
  assert.deepEqual(sqlQuery(namespace, { entity: 'Block', byId: '500' }).values, ['Block', '500']);
  assert.throws(() => sqlQuery('chef_existing_project', { entity: 'Block', byId: '500' }), /UNSAFE_QUERY_NAMESPACE/);
});

test('public fixture rejects contradictory counts and duplicate transaction identities', () => {
  const oracle = { blocks: [{ id: '1', hash: 'a'.repeat(64), time: '1000', transactionCount: 1 }], transactions: [{ id: 'b'.repeat(64), minedHeight: 1 }] };
  assert.equal(publicFixture(oracle).head.height, 1);
  assert.throws(() => publicFixture({ ...oracle, transactions: [...oracle.transactions, ...oracle.transactions] }), /DUPLICATE_FIXTURE_ID/);
  assert.throws(() => publicFixture({ ...oracle, blocks: [{ ...oracle.blocks[0], transactionCount: 2 }] }), /PUBLIC_BLOCK_COUNT_MISMATCH/);
});
