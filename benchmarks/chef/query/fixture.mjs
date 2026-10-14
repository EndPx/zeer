import { createHash } from 'node:crypto';

export const check = (ok, code) => { if (!ok) throw new Error(code); };
export const hash = value => createHash('sha256').update(value).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
export const digest = rows => hash(JSON.stringify(canonical(rows)));
const order = (left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0;

export function publicFixture(oracle) {
  check(oracle && Array.isArray(oracle.blocks) && Array.isArray(oracle.transactions) && oracle.blocks.length && oracle.transactions.length, 'INVALID_PUBLIC_ORACLE');
  const blocks = oracle.blocks.map(row => ({ ...row })).sort(order);
  const transactions = oracle.transactions.map(row => ({ ...row })).sort(order);
  check(new Set(blocks.map(row => row.id)).size === blocks.length && new Set(transactions.map(row => row.id)).size === transactions.length, 'DUPLICATE_FIXTURE_ID');
  const heights = new Set(blocks.map(row => Number(row.id)));
  const counts = new Map();
  for (const row of transactions) {
    check(typeof row.id === 'string' && /^[0-9a-f]{64}$/.test(row.id) && heights.has(row.minedHeight), 'INVALID_PUBLIC_TRANSACTION_IDENTITY');
    counts.set(row.minedHeight, (counts.get(row.minedHeight) ?? 0) + 1);
  }
  for (const row of blocks) check(row.transactionCount === counts.get(Number(row.id)), 'PUBLIC_BLOCK_COUNT_MISMATCH');
  const last = blocks.reduce((a, b) => Number(a.id) > Number(b.id) ? a : b);
  return { blocks, transactions, head: { height: Number(last.id), hash: last.hash },
    provenance: { kind: 'public_oracle_projection', source: oracle.source, range: oracle.range } };
}

/** Selectivity stress data, never asserted to be real chain blocks or transactions. */
export function syntheticFixture(count) {
  check(Number.isInteger(count) && count >= 1000 && count <= 1_000_000, 'INVALID_SYNTHETIC_ROW_COUNT');
  const transactions = [], blocks = [];
  let offset = 0, height = 1;
  while (offset < count) {
    // Repeated thin blocks and occasional busy blocks exercise both block lookups and summaries.
    const size = Math.min(height % 17 === 0 ? 256 : 1 + height % 19, count - offset);
    blocks.push({ id: String(height), hash: hash(`synthetic-block:${height}`), time: String(1_700_000_000 + height), transactionCount: size });
    for (let index = 0; index < size; index++, offset++) transactions.push({ id: hash(`synthetic-transaction:${offset}`),
      minedHeight: height, version: offset % 1000 === 0 ? 2 : offset % 20 === 0 ? 4 : 5,
      locktime: String(offset % 500 === 0 ? 4_294_967_295 : 0), sizeBytes: 192 + offset % 4096,
      transparentInputCount: offset % 3, transparentOutputCount: offset % 7 });
    height++;
  }
  return { blocks: blocks.sort(order), transactions: transactions.sort(order),
    head: { height: height - 1, hash: hash(`synthetic-block:${height - 1}`) },
    provenance: { kind: 'synthetic_selectivity_only', generator: 'chef-query-selectivity-v1', requestedTransactions: count,
      versionDistribution: 'v2: 1/1000; v4: 49/1000; v5: 950/1000; not a chain distribution' } };
}

export function page(rows, { first, after, where = {} }) {
  const matched = rows.filter(row => (after === undefined || row.id > after) && Object.entries(where).every(([field, value]) => same(row[field], value)));
  const selected = matched.slice(0, first);
  return { items: selected, nextCursor: matched.length > first ? selected.at(-1).id : null };
}
const transactionFields = 'id minedHeight version locktime sizeBytes transparentInputCount transparentOutputCount';
const blockFields = 'id hash time transactionCount';

export function workloads(fixture) {
  const result = [];
  for (const fraction of [0, 0.5, 0.99]) {
    const row = fixture.transactions[Math.floor((fixture.transactions.length - 1) * fraction)];
    result.push({ workflow: 'transaction_detail', name: `transaction_detail_${fraction}`, entity: 'PublicTransaction', byId: row.id,
      query: `query($id:ID!){ _meta { height hash status } PublicTransactionById(id:$id){ ${transactionFields} } }`, variables: { id: row.id }, expected: row });
  }
  const addPage = (workflow, name, entity, where, rows, after) => {
    const first = 100, options = { first, where, ...(after === undefined ? {} : { after }) };
    result.push({ workflow, name, entity, options, matchingRows: rows.filter(row => Object.entries(where).every(([key, value]) => same(row[key], value))).length,
      query: `query($first:Int!,$after:ID,$where:${entity}Filter){ _meta { height hash status } ${entity}List(first:$first,after:$after,where:$where){ items { ${entity === 'Block' ? blockFields : transactionFields} } nextCursor } }`,
      variables: { first, where, ...(after === undefined ? {} : { after }) }, expected: page(rows, options) });
  };
  const busiest = [...fixture.blocks].sort((a, b) => b.transactionCount - a.transactionCount || order(a, b))[0];
  const heightRows = fixture.transactions.filter(row => row.minedHeight === Number(busiest.id));
  addPage('block_transactions', 'block_transactions_first', 'PublicTransaction', { minedHeight: Number(busiest.id) }, fixture.transactions);
  if (heightRows.length > 100) addPage('block_transactions', 'block_transactions_second', 'PublicTransaction', { minedHeight: Number(busiest.id) }, fixture.transactions, heightRows[99].id);
  const versions = [...new Set(fixture.transactions.map(row => row.version))].map(version => ({ version, count: fixture.transactions.filter(row => row.version === version).length })).sort((a, b) => a.count - b.count || a.version - b.version);
  for (const [label, version] of [['rare', versions[0].version], ['common', versions.at(-1).version]]) {
    const matching = fixture.transactions.filter(row => row.version === version);
    addPage('version_browser', `version_${label}_first`, 'PublicTransaction', { version }, fixture.transactions);
    if (matching.length > 100) addPage('version_browser', `version_${label}_deep_cursor`, 'PublicTransaction', { version }, fixture.transactions, matching[Math.floor(matching.length / 2)].id);
  }
  addPage('block_summaries', 'busy_block_summaries', 'Block', { transactionCount: busiest.transactionCount }, fixture.blocks);
  addPage('block_summaries', 'block_summaries_id_order', 'Block', {}, fixture.blocks, fixture.blocks[Math.floor(fixture.blocks.length / 2)].id);
  return result;
}

/** Keep parameterized JSONB equality and ID-order keysets identical to PostgresStore.list. */
export function sqlQuery(namespace, workload) {
  check(/^chef_q_[0-9a-f]{16}$/.test(namespace), 'UNSAFE_QUERY_NAMESPACE');
  if (workload.byId) return { text: `SELECT data FROM "${namespace}".entities WHERE entity=$1 AND id=$2`, values: [workload.entity, workload.byId] };
  const values = [workload.entity], clauses = ['entity=$1'];
  if (workload.options.after !== undefined) { values.push(workload.options.after); clauses.push(`id > $${values.length}`); }
  for (const [field, value] of Object.entries(workload.options.where)) {
    values.push(field, JSON.stringify(value));
    clauses.push(`data -> $${values.length - 1}::text = $${values.length}::jsonb`);
  }
  values.push(workload.options.first + 1);
  return { text: `SELECT data FROM "${namespace}".entities WHERE ${clauses.join(' AND ')} ORDER BY id ASC LIMIT $${values.length}`, values };
}
