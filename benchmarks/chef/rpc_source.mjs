// Benchmark-only, frozen-mainnet adapter. Same Chef runtime interface as Prep.
const check = (ok, code) => { if (!ok) throw new Error(code); };
const uint = value => { const n = Number(value); check(Number.isInteger(n) && n >= 0 && n <= 0xffffffff, 'RPC_INVALID_UINT'); return n; };
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

/** Preserve the original JSON number token; never round public monetary text. */
export function parseExactJson(raw) {
  return JSON.parse(raw, (_key, value, context) => {
    if (typeof value !== 'number') return value;
    check(typeof context?.source === 'string', 'NODE_JSON_SOURCE_CONTEXT_REQUIRED');
    return context.source;
  });
}

export class FrozenRpcSource {
  constructor({ url, headHeight, headHash, signal, request }) {
    this.url = new URL(url); this.headHeight = headHeight; this.headHash = headHash;
    this.signal = signal; this.transport = request;
    this.requests = 0; this.responseBytes = 0;
    check(['http:', 'https:'].includes(this.url.protocol) && !this.url.username && !this.url.password && !this.url.search && !this.url.hash, 'INVALID_RPC_SOURCE_URL');
  }
  async rpc(method, params, options = {}) {
    const signal = AbortSignal.any([...(this.signal ? [this.signal] : []), ...(options.signal ? [options.signal] : []), AbortSignal.timeout(20000)]);
    signal.throwIfAborted(); this.requests++;
    let raw;
    if (this.transport) raw = await this.transport(method, params, signal);
    else {
      const response = await fetch(this.url, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal });
      check(response.ok && response.body, 'RPC_SOURCE_HTTP_FAILURE');
      const reader = response.body.getReader(), chunks = []; let length = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          length += value.length;
          if (length > 16 * 1024 * 1024) { await reader.cancel(); throw new Error('RPC_SOURCE_RESPONSE_TOO_LARGE'); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      raw = Buffer.concat(chunks).toString('utf8');
    }
    this.responseBytes += Buffer.byteLength(raw);
    const body = parseExactJson(raw);
    check(!body.error && Object.hasOwn(body, 'result'), 'RPC_SOURCE_FAILURE'); return body.result;
  }
  async getHeight(options = {}) {
    const info = await this.rpc('getblockchaininfo', [], options);
    check(['main', 'mainnet'].includes(info.chain) && uint(info.blocks) === this.headHeight && info.bestblockhash === this.headHash, 'RPC_FROZEN_HEAD_MISMATCH');
    return { ready: true, network: 'mainnet', payload_kind: 'full-v1', start_block: 1, archive_height: this.headHeight, epoch: '0', revision: '0' };
  }
  async get(query, options = {}) {
    const from = uint(query.from_block), to = uint(query.to_block), limit = uint(query.limit);
    check(from >= 1 && from < to && to <= this.headHeight + 1 && limit >= 1 && limit <= 100, 'RPC_QUERY_OUTSIDE_FROZEN_RANGE');
    const transactionFields = query.field_selection?.transaction;
    check(Array.isArray(transactionFields), 'RPC_TRANSACTION_FIELDS_REQUIRED');
    const withTransactions = transactionFields.length > 0;
    const next = Math.min(to, from + limit), blocks = [], transactions = [];
    // Exactly one sequential in-flight request. No source preload/cache or concurrency.
    for (let height = from; height < next; height++) {
      const blockHash = await this.rpc('getblockhash', [height], options);
      const block = await this.rpc('getblock', [blockHash, withTransactions ? 2 : 1], options);
      check(hash(blockHash) && block.hash === blockHash && uint(block.height) === height && hash(block.previousblockhash), 'RPC_BLOCK_IDENTITY_MISMATCH');
      blocks.push({ height, hash: blockHash, previous_hash: block.previousblockhash, time: uint(block.time) });
      if (withTransactions) {
        check(Array.isArray(block.tx) && block.tx.length > 0, 'RPC_TRANSACTIONS_MISSING');
        for (const [index, tx] of block.tx.entries()) {
          check(tx && typeof tx === 'object' && hash(tx.txid) && Array.isArray(tx.vin) && Array.isArray(tx.vout), 'RPC_TRANSACTION_INVALID');
          let size = tx.size;
          if (tx.hex !== undefined) {
            check(typeof tx.hex === 'string' && /^[0-9a-f]+$/i.test(tx.hex) && tx.hex.length % 2 === 0, 'RPC_TRANSACTION_HEX_INVALID');
            const derived = String(tx.hex.length / 2);
            check(size === undefined || size === derived, 'RPC_TRANSACTION_SIZE_MISMATCH'); size = derived;
          }
          check(typeof size === 'string' && /^[1-9][0-9]*$/.test(size), 'RPC_TRANSACTION_SIZE_REQUIRED');
          transactions.push({ txid: tx.txid, block_height: height, index, version: uint(tx.version), locktime: uint(tx.locktime), decoded: { ...tx, size } });
        }
      }
    }
    return { network: 'mainnet', epoch: '0', revision: '0', archive_height: this.headHeight,
      from_block: from, to_block: to, next_block: next, cursor: next === to ? null : '00', data: { blocks, transactions } };
  }
}
