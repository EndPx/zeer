import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyQuery, installQueryProfiler, verifyProfileObserved } from './instrument.mjs';

test('profile guard rejects missing or duplicate transaction SQL and accepts observed apply counts', async () => {
  for (const sql of [{}, { BEGIN: { count: 1 } }, { BEGIN: { count: 2 }, COMMIT: { count: 1 } }]) {
    assert.throws(() => verifyProfileObserved({ sql }), /^Error: PROFILE_SQL_NOT_OBSERVED$/);
  }
  class Client { query() { return Promise.resolve({ rows: [] }); } }
  const sample = { sql: {} }, profiler = installQueryProfiler(Client), client = new Client();
  try {
    await profiler.run(sample, async () => { await client.query('BEGIN'); await client.query('SELECT * FROM "chef_wp_0123".state WHERE singleton = true FOR UPDATE'); await client.query('COMMIT'); });
    verifyProfileObserved(sample);
    assert.equal(sample.sql.state_for_update.count, 1);
  } finally { profiler.restore(); }
});

test('historical history-pruning SQL remains classified and rejects boundary or namespace drift', () => {
  const ns = '"chef_wp_0123"';
  const sql = `WITH pruned_undo AS (
    DELETE FROM ${ns}.undo WHERE height <= $1
  ) DELETE FROM ${ns}.blocks WHERE height < $1`;
  assert.equal(classifyQuery(sql), 'history_prune');
  assert.equal(classifyQuery({ text: sql, values: ['private'] }), 'history_prune');
  assert.equal(classifyQuery(sql.replace('height < $1', 'height <= $1')), 'other');
  assert.equal(classifyQuery(sql.replace('height <= $1', 'height < $1')), 'other');
  assert.equal(classifyQuery(sql.replace('"chef_wp_0123".blocks', '"chef_other".blocks')), 'other');
});

test('historical four-operation bookkeeping profiles retain their distinct category', () => {
  const ns = '"chef_wp_0123"';
  const sql = `WITH recorded_block AS (
    INSERT INTO ${ns}.blocks VALUES($1,$2)
  ), pruned_undo AS (
    DELETE FROM ${ns}.undo WHERE height <= $4
  ), pruned_blocks AS (
    DELETE FROM ${ns}.blocks WHERE height < $4
  ) UPDATE ${ns}.state SET height=$1,hash=$2,anchor_hash=COALESCE(anchor_hash,$3) WHERE singleton=true`;
  assert.equal(classifyQuery(sql), 'block_bookkeeping');
  assert.equal(classifyQuery({ text: sql, values: ['private'] }), 'block_bookkeeping');
  assert.equal(classifyQuery(sql.replace('height < $4', 'height <= $4')), 'other');
  assert.equal(classifyQuery(sql.replace('pruned_undo AS', 'unrecognized AS')), 'other');
  assert.equal(classifyQuery(sql.replace('"chef_wp_0123".state', '"chef_other".state')), 'other');
});

test('classifies actual apply statements without confusing tables, status reads or arbitrary SQL', () => {
  const ns = '"chef_wp_0123"';
  for (const [sql, expected] of [
    [' BEGIN ', 'BEGIN'], ['COMMIT', 'COMMIT'], ['ROLLBACK', 'ROLLBACK'],
    [`SELECT * FROM ${ns}.state WHERE singleton = true FOR UPDATE`, 'state_for_update'],
    [`SELECT data FROM ${ns}.entities WHERE entity=$1 AND id=$2`, 'entity_get'],
    [`INSERT INTO ${ns}.undo(height,entity,id,previous) SELECT $1,r.entity,r.id,e.data FROM jsonb_to_recordset($2::jsonb) r`, 'undo_insert'],
    [`INSERT INTO ${ns}.entities(entity,id,data) SELECT r.entity,r.id,r.data FROM jsonb_to_recordset($1::jsonb) r`, 'entities_upsert'],
    [`DELETE FROM ${ns}.entities e USING jsonb_to_recordset($1::jsonb) r`, 'entities_delete'],
    [`INSERT INTO ${ns}.blocks VALUES($1,$2)`, 'block_insert'],
    [`UPDATE ${ns}.state SET height=$1,hash=$2 WHERE singleton=true`, 'state_update'],
    [`DELETE FROM ${ns}.undo WHERE height <= $1`, 'undo_delete'],
    [`DELETE FROM ${ns}.blocks WHERE height < $1`, 'blocks_delete'],
    [`SELECT * FROM ${ns}.state WHERE singleton = true`, 'other'],
    [`UPDATE ${ns}.state SET status=$1 WHERE singleton=true`, 'other'],
    [`DELETE FROM ${ns}.blocks WHERE height <= $1`, 'other'],
    [`INSERT INTO ${ns}.entities_backup VALUES($1)`, 'other'],
    ['INSERT INTO public.entities VALUES($1)', 'other'],
    ['SELECT 1 /* INSERT INTO "chef_wp_0123".undo */', 'other'],
    [undefined, 'other'],
  ]) {
    assert.equal(classifyQuery(sql), expected, String(sql));
    if (sql) assert.equal(classifyQuery({ text: sql, values: ['secret'] }), expected);
  }
});

test('instrumentation isolates concurrent async contexts and restores exact original method', async () => {
  const secret = { secret: true };
  class Client { query(sql, parameters) { assert.equal(parameters, secret); return Promise.resolve(sql); } }
  const original = Client.prototype.query, client = new Client(), profile = installQueryProfiler(Client);
  const first = { sql: {} }, second = { sql: {} };
  try {
    await client.query('BEGIN', secret);
    await Promise.all([
      profile.run(first, async () => { await Promise.resolve(); assert.equal(await client.query('BEGIN', secret), 'BEGIN'); await client.query('COMMIT', secret); }),
      profile.run(second, async () => { await client.query('ROLLBACK', secret); }),
    ]);
    assert.deepEqual(Object.keys(first.sql).sort(), ['BEGIN', 'COMMIT']);
    assert.deepEqual(Object.keys(second.sql), ['ROLLBACK']);
    for (const value of [...Object.values(first.sql), ...Object.values(second.sql)]) {
      assert.equal(value.count, 1); assert.equal(value.failures, 0); assert.ok(value.totalMs >= 0);
    }
    assert.ok(!JSON.stringify(first).includes('secret'));
  } finally { profile.restore(); }
  assert.equal(Client.prototype.query, original);
});

test('query failures retain their identity and count once for synchronous, rejected and callback paths', async () => {
  const failure = new Error('private failure details');
  class Client {
    query(sql, callback) {
      if (sql === 'sync') throw failure;
      if (callback) { queueMicrotask(() => callback(failure)); return undefined; }
      return Promise.reject(failure);
    }
  }
  const profile = installQueryProfiler(Client), sample = { sql: {} }, client = new Client();
  try {
    await profile.run(sample, async () => {
      assert.throws(() => client.query('sync'), error => error === failure);
      await assert.rejects(client.query('BEGIN'), error => error === failure);
      await new Promise(resolve => client.query('ROLLBACK', error => { assert.equal(error, failure); resolve(); }));
    });
    assert.equal(sample.sql.other.failures, 1); assert.equal(sample.sql.BEGIN.failures, 1); assert.equal(sample.sql.ROLLBACK.failures, 1);
    assert.equal(sample.sql.ROLLBACK.count, 1);
    assert.ok(!JSON.stringify(sample).includes('private'));
  } finally { profile.restore(); }
});
