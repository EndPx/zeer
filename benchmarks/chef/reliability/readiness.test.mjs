import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertObserverReady} from './readiness.mjs';

const live = {pid: process.pid, exitCode: null, signalCode: null, killed: false};
test('a source becoming unready during bootstrap cannot publish readiness', async () => {
  let inspected = false;
  await assert.rejects(assertObserverReady({state: 'source_unavailable'}, {checkpoint: async () => {inspected = true; return {status: 'reconciling'};}}, live), /BOOTSTRAP_NOT_READY/);
  assert.equal(inspected, false);
});
test('readiness requires a ready persisted gate and a running child', async () => {
  await assert.rejects(assertObserverReady({state: 'progress'}, {checkpoint: async () => ({status: 'reconciling'})}, live), /CHECKPOINT_NOT_READY/);
  await assert.rejects(assertObserverReady({state: 'caught_up'}, {checkpoint: async () => ({status: 'ready'})}, {...live, exitCode: 1}), /CONSUMER_NOT_RUNNING/);
  await assertObserverReady({state: 'progress'}, {checkpoint: async () => ({status: 'ready'})}, live);
});
