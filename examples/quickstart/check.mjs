// Independent fixture-to-API checks. No database-derived expected values.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { PrepClient } from '@zeer/prep-client';

const prepOnly = process.argv[2] === '--prep-only';
const height = prepOnly ? 1687108 : Number(process.argv[2] ?? '1687108');
assert.ok([1687106, 1687108].includes(height), 'Expected fixture checkpoint');
const fixture = JSON.parse(await readFile('benchmarks/fixtures/mainnet-nu5-full-v1/fixture.json', 'utf8'));
const blocks = fixture.blocks.filter(block => block.decoded.height <= height);
const expectedBlocks = blocks.map(({ decoded: b }) => ({
  id: String(b.height), hash: b.hash, time: String(b.time), transactionCount: b.tx.length,
})).sort((a, b) => a.id.localeCompare(b.id));
const expectedTx = blocks.flatMap(({ decoded: b }) => b.tx.map(tx => ({
  id: tx.txid, minedHeight: b.height, version: tx.version, locktime: String(tx.locktime),
  sizeBytes: tx.hex.length / 2, transparentInputCount: tx.vin.length, transparentOutputCount: tx.vout.length,
}))).sort((a, b) => a.id.localeCompare(b.id));
const prep = new PrepClient({ url: process.env.PREP_URL, token: process.env.PREP_API_TOKEN });

async function waitFor(read) {
  let last;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { return await read(); } catch (error) { last = error; await delay(500); }
  }
  throw last;
}
const meta = await waitFor(() => prep.getHeight({ signal: AbortSignal.timeout(2000) }));
assert.equal(meta.ready, true);
assert.equal(meta.archive_height, 1687108);
const page = await prep.get({ from_block: 1687106, to_block: 1687109,
  field_selection: { block: ['height', 'hash', 'raw'], transaction: ['txid', 'block_height', 'index', 'raw'] },
  limit: 3,
});
assert.equal(page.next_block, 1687109);
assert.deepEqual(page.data.blocks, fixture.blocks.map(b => ({ height: b.decoded.height, hash: b.decoded.hash, raw: b.raw })));
assert.deepEqual(page.data.transactions, fixture.blocks.flatMap(b => b.decoded.tx.map((tx, index) => ({
  txid: tx.txid, block_height: b.decoded.height, index, raw: tx.hex,
}))));
if (prepOnly) {
  console.log(JSON.stringify({ status: 'PASS', prepRawEqualsFixture: true }));
  process.exit(0);
}

const body = { query: '{ _meta { height hash status } BlockList(first: 100) { items { id hash time transactionCount } nextCursor } PublicTransactionList(first: 100) { items { id minedHeight version locktime sizeBytes transparentInputCount transparentOutputCount } nextCursor } }' };
const endpoint = `${process.env.CHEF_URL}/graphql`;
const data = await waitFor(async () => {
  const response = await fetch(endpoint, { method: 'POST', signal: AbortSignal.timeout(2000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CHEF_API_TOKEN}` }, body: JSON.stringify(body) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.errors, undefined);
  return result.data;
});
assert.deepEqual(data._meta, { height, hash: blocks.at(-1).decoded.hash, status: 'ready' });
assert.deepEqual(data.BlockList, { items: expectedBlocks, nextCursor: null });
assert.deepEqual(data.PublicTransactionList, { items: expectedTx, nextCursor: null });
for (const [url, options] of [[`${process.env.PREP_URL}/height`, {}], [endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }]]) {
  const denied = await fetch(url, { ...options, signal: AbortSignal.timeout(2000) });
  assert.equal(denied.status, 401, 'Unauthenticated request must be rejected');
}
console.log(JSON.stringify({ status: 'PASS', source: 'historical public fixture replay; not a live node',
  checkpoint: height, blocks: expectedBlocks.length, transactions: expectedTx.length,
  prepRawEqualsFixture: true, allGraphqlEntitiesEqualFixture: true, unauthenticatedRequestsRejected: true }));
