import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyRows, verifyCheckpoint } from './verify.mjs';

test('persisted JSON equals encoded null-prototype values while changed data fails', () => {
  const data = Object.assign(Object.create(null), { id: '1', transactionCount: 2, time: '1477671596' });
  const expected = [{ entity: 'Block', id: '1', data }];
  const persisted = JSON.parse(JSON.stringify(expected));
  assert.equal(typeof verifyRows(persisted, expected), 'string');
  persisted[0].data.transactionCount++;
  assert.throws(() => verifyRows(persisted, expected), /^Error: FINAL_ROW_VALUES_MISMATCH$/);
  assert.throws(() => verifyRows([], expected), /^Error: FINAL_ROW_COUNT_MISMATCH$/);
});

test('checkpoint and identity failures retain distinct safe classifications', () => {
  const state = { height: '3', hash: 'last', anchor_hash: 'anchor', status: 'ready', fingerprint: 'handler', model: 'model', network: 'mainnet', start_height: '1', reorg_window: 100 };
  const options = { fingerprint: 'handler', startHeight: 1, reorgWindow: 100 }, model = { fingerprint: 'model' }, last = { id: '3', hash: 'last' };
  verifyCheckpoint(state, options, model, last, 'anchor');
  assert.throws(() => verifyCheckpoint({ ...state, height: '2' }, options, model, last, 'anchor'), /^Error: FINAL_CHECKPOINT_MISMATCH$/);
  assert.throws(() => verifyCheckpoint({ ...state, fingerprint: 'changed' }, options, model, last, 'anchor'), /^Error: FINAL_STORE_IDENTITY_MISMATCH$/);
});
