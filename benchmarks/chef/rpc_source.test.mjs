import test from 'node:test';
import assert from 'node:assert/strict';
import { FrozenRpcSource, parseExactJson } from './rpc_source.mjs';
const hash = '1'.repeat(64), parent = '0'.repeat(64), txid = '2'.repeat(64);

test('native JSON token context preserves decimals, exponent notation and unsafe integers', () => {
  const parsed = parseExactJson('{"value":0.00000001,"exponent":1e-8,"large":9007199254740993,"nested":[-0,2.00],"bool":true}');
  assert.deepEqual(parsed, { value: '0.00000001', exponent: '1e-8', large: '9007199254740993', nested: ['-0', '2.00'], bool: true });
});

test('RPC pages preserve every decoded numeric token and use sequential block verbosity 2', async () => {
  const calls = [];
  const client = new FrozenRpcSource({ url: 'http://127.0.0.1:1', headHeight: 6764, headHash: hash,
    request: async (method, params) => {
      calls.push([method, params]);
      if (method === 'getblockhash') return JSON.stringify({ result: hash });
      return `{"result":{"hash":"${hash}","height":1,"previousblockhash":"${parent}","time":123,"tx":[{"txid":"${txid}","version":1,"locktime":0,"size":10,"vin":[{"coinbase":"aa"}],"vout":[{"value":0.00000001,"n":0}]}]}}`;
    } });
  const page = await client.get({ from_block: 1, to_block: 2, limit: 16, field_selection: { transaction: ['decoded'] } });
  assert.deepEqual(calls, [['getblockhash', [1]], ['getblock', [hash, 2]]]);
  assert.equal(page.next_block, 2); assert.equal(page.cursor, null);
  assert.equal(page.data.blocks[0].height, 1);
  assert.equal(page.data.transactions[0].version, 1);
  assert.equal(page.data.transactions[0].decoded.vout[0].value, '0.00000001');
  assert.equal(page.data.transactions[0].decoded.version, '1');
  assert.equal(client.requests, 2); assert.ok(client.responseBytes > 0);
});

test('header query uses verbosity 1 and emits no transaction rows', async () => {
  const client = new FrozenRpcSource({ url: 'http://127.0.0.1:1', headHeight: 6764, headHash: hash,
    request: async (method, params) => {
      if (method === 'getblockhash') return JSON.stringify({ result: hash });
      assert.equal(params[1], 1);
      return JSON.stringify({ result: { hash, height: 1, previousblockhash: parent, time: 123, tx: [txid] } });
    } });
  const page = await client.get({ from_block: 1, to_block: 3, limit: 1, field_selection: { transaction: [] } });
  assert.equal(page.next_block, 2); assert.equal(page.cursor, '00'); assert.deepEqual(page.data.transactions, []);
});

test('frozen source rejects changed head and benchmark range excludes genesis', async () => {
  const client = new FrozenRpcSource({ url: 'http://127.0.0.1:1', headHeight: 6764, headHash: hash,
    request: async () => JSON.stringify({ result: { chain: 'main', blocks: 6765, bestblockhash: hash } }) });
  await assert.rejects(client.getHeight(), /RPC_FROZEN_HEAD_MISMATCH/);
  await assert.rejects(client.get({ from_block: 0, to_block: 2, limit: 1, field_selection: { transaction: [] } }), /RPC_QUERY_OUTSIDE_FROZEN_RANGE/);
});

test('exact raw length rejects conflicting RPC size rather than repairing provider output', async () => {
  const client = new FrozenRpcSource({ url: 'http://127.0.0.1:1', headHeight: 6764, headHash: hash,
    request: async method => JSON.stringify({ result: method === 'getblockhash' ? hash : {
      hash, height: 1, previousblockhash: parent, time: 123, tx: [{ txid, version: 1, locktime: 0, size: 11, hex: '00'.repeat(10), vin: [{}], vout: [{}] }] } }) });
  await assert.rejects(client.get({ from_block: 1, to_block: 2, limit: 1, field_selection: { transaction: ['decoded'] } }), /RPC_TRANSACTION_SIZE_MISMATCH/);
});

test('legacy v2 public transactions retain JoinSplit numeric tokens and runtime locktime', async () => {
  const client = new FrozenRpcSource({ url: 'http://127.0.0.1:1', headHeight: 6764, headHash: hash,
    request: async method => method === 'getblockhash' ? JSON.stringify({ result: hash }) :
      `{"result":{"hash":"${hash}","height":1,"previousblockhash":"${parent}","time":123,"tx":[{"txid":"${txid}","version":2,"locktime":4294967295,"size":100,"vin":[],"vout":[],"vjoinsplit":[{"vpub_old":0.00000001,"vpub_new":1e-8}]}]}}` });
  const page = await client.get({ from_block: 1, to_block: 2, limit: 1, field_selection: { transaction: ['decoded'] } });
  const tx = page.data.transactions[0];
  assert.equal(tx.version, 2); assert.equal(tx.locktime, 4294967295);
  assert.deepEqual(tx.decoded.vjoinsplit, [{ vpub_old: '0.00000001', vpub_new: '1e-8' }]);
});
