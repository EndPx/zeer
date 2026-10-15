import { check, digest } from '../query/fixture.mjs';

/** Compare persisted JSON values; encoder object prototypes are not SQL data. */
export function verifyRows(rows, expected) {
  check(rows.length === expected.length, 'FINAL_ROW_COUNT_MISMATCH');
  const actualDigest = digest(rows);
  check(actualDigest === digest(expected), 'FINAL_ROW_VALUES_MISMATCH');
  return actualDigest;
}

export function verifyCheckpoint(state, options, model, last, anchor) {
  check(state && Number(state.height) === Number(last.id) && state.hash === last.hash && state.anchor_hash === anchor && state.status === 'ready', 'FINAL_CHECKPOINT_MISMATCH');
  check(state.fingerprint === options.fingerprint && state.model === model.fingerprint && state.network === 'mainnet' && Number(state.start_height) === options.startHeight && state.reorg_window === options.reorgWindow, 'FINAL_STORE_IDENTITY_MISMATCH');
}
