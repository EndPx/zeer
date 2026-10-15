import { AsyncLocalStorage } from 'node:async_hooks';

const table = '"chef_[a-z0-9_]+"\\.';
const patterns = [
  ['BEGIN', /^BEGIN$/i], ['COMMIT', /^COMMIT$/i], ['ROLLBACK', /^ROLLBACK$/i],
  ['history_prune', /^WITH pruned_undo AS \( DELETE FROM ("chef_[a-z0-9_]+")\.undo WHERE height <= \$1 \) DELETE FROM \1\.blocks WHERE height < \$1$/i],
  ['block_bookkeeping', /^WITH recorded_block AS \( INSERT INTO ("chef_[a-z0-9_]+")\.blocks VALUES\(\$1,\$2\) \), pruned_undo AS \( DELETE FROM \1\.undo WHERE height <= \$4 \), pruned_blocks AS \( DELETE FROM \1\.blocks WHERE height < \$4 \) UPDATE \1\.state SET height=\$1,hash=\$2,anchor_hash=COALESCE\(anchor_hash,\$3\) WHERE singleton=true$/i],
  ['state_for_update', new RegExp(`^SELECT \\* FROM ${table}state WHERE singleton = true FOR UPDATE$`, 'i')],
  ['entity_get', new RegExp(`^SELECT data FROM ${table}entities WHERE entity=\\$1 AND id=\\$2$`, 'i')],
  ['undo_insert', new RegExp(`^INSERT INTO ${table}undo(?:\\s|\\()`, 'i')],
  ['entities_upsert', new RegExp(`^INSERT INTO ${table}entities(?:\\s|\\()`, 'i')],
  ['entities_delete', new RegExp(`^DELETE FROM ${table}entities(?:\\s|$)`, 'i')],
  ['block_insert', new RegExp(`^INSERT INTO ${table}blocks(?:\\s|\\()`, 'i')],
  ['state_update', new RegExp(`^UPDATE ${table}state SET height=`, 'i')],
  ['undo_delete', new RegExp(`^DELETE FROM ${table}undo WHERE height <= \\$1$`, 'i')],
  ['blocks_delete', new RegExp(`^DELETE FROM ${table}blocks WHERE height < \\$1$`, 'i')],
];
export function classifyQuery(query) {
  const text = typeof query === 'string' ? query : query?.text;
  if (typeof text !== 'string') return 'other';
  const normalized = text.trim().replace(/\s+/g, ' ');
  return patterns.find(([, pattern]) => pattern.test(normalized))?.[0] ?? 'other';
}

/** A module using another pg installation cannot silently produce an empty profile. */
export function verifyProfileObserved(sample) {
  if (sample.sql.BEGIN?.count !== 1 || sample.sql.COMMIT?.count !== 1) throw new Error('PROFILE_SQL_NOT_OBSERVED');
}

/** Measurement only. No SQL text, parameters or connection strings are retained. */
export function installQueryProfiler(Client) {
  const context = new AsyncLocalStorage(), original = Client.prototype.query;
  function wrapped(...args) {
    const sample = context.getStore();
    if (!sample) return original.apply(this, args);
    const category = classifyQuery(args[0]), started = performance.now();
    let recorded = false;
    const finish = failed => {
      if (recorded) return;
      recorded = true;
      const bucket = sample.sql[category] ??= { count: 0, totalMs: 0, failures: 0 };
      bucket.count++; bucket.totalMs += performance.now() - started; bucket.failures += Number(failed);
    };
    const last = args.length - 1;
    if (typeof args[last] === 'function') {
      const callback = args[last];
      args[last] = function(error, ...rest) { finish(Boolean(error)); return callback.call(this, error, ...rest); };
    }
    try {
      const result = original.apply(this, args);
      if (result && typeof result.then === 'function') return result.then(value => { finish(false); return value; }, error => { finish(true); throw error; });
      return result;
    } catch (error) { finish(true); throw error; }
  }
  Client.prototype.query = wrapped;
  return {
    run: (sample, fn) => context.run(sample, fn),
    restore() {
      if (Client.prototype.query !== wrapped) throw new Error('PROFILER_WRAPPER_CHANGED');
      Client.prototype.query = original;
    },
  };
}
