import assert from 'node:assert/strict';

// A resolved syncStep can still have closed the read gate. Never advertise a
// funding-ready observer until its persisted projection and child are usable.
export async function assertObserverReady(bootstrap, store, child) {
  assert.ok(['progress', 'caught_up'].includes(bootstrap.state), 'BOOTSTRAP_NOT_READY');
  const checkpoint = await store.checkpoint();
  assert.equal(checkpoint.status, 'ready', 'CHECKPOINT_NOT_READY');
  assert.ok(child?.pid && child.exitCode === null && child.signalCode === null && !child.killed, 'CONSUMER_NOT_RUNNING');
  process.kill(child.pid, 0);
}
