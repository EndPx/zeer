/** Native fetch only. No wallet keys, native addon, or implicit reorg restart. */
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const MAX_CURSOR_CHARACTERS = 4096;
const BLOCK_FIELDS = ["height", "hash", "previous_hash", "time", "raw", "decoded"];
const SHIELDED_COUNT_FIELDS = ["sapling_spend_count", "sapling_output_count", "orchard_action_count", "ironwood_action_count"];
const TRANSACTION_FIELDS = [...SHIELDED_COUNT_FIELDS, "is_coinbase", "transaction_type", "expiry_height","txid", "block_height", "index", "version", "locktime", "size_bytes", "transparent_input_count", "transparent_output_count", "raw", "vin", "vout", "decoded"];
const TRANSACTION_IDENTITIES = ["txid", "block_height", "index"];
const DEFAULT_TRANSACTION_FIELDS = [...TRANSACTION_IDENTITIES, "version", "locktime", "size_bytes", "transparent_input_count", "transparent_output_count"];
const MAX_TRANSACTIONS_BODY_BYTES = 4 * 1024 * 1024;

export class PrepError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.name = "PrepError";
    this.code = code;
    this.status = status;
  }
}
export class ReorgError extends PrepError {
  constructor() { super("REORG", 409); this.name = "ReorgError"; }
}
export class ProtocolError extends PrepError {
  constructor(code = "INVALID_SERVER_RESPONSE") { super(code); this.name = "ProtocolError"; }
}

function integer(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}
function decimal(value) { return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) && value.length <= 20; }
function cursor(value) { return value === null || (typeof value === "string" && value.length > 0 && value.length <= MAX_CURSOR_CHARACTERS && value.length % 2 === 0 && /^[0-9a-f]+$/.test(value)); }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function hash(value) { return typeof value === "string" && /^[0-9a-f]{64}$/.test(value); }
function counter(value) { return decimal(value) && BigInt(value) <= 0xffffffffffffffffn; }
function snapshot(value, from, to) {
  return object(value) && Object.keys(value).length === 5
    && ["network", "archive_start", "to_block", "epoch", "boundary_hash"].every(key => Object.hasOwn(value, key))
    && ["mainnet", "testnet", "regtest"].includes(value.network)
    && integer(value.archive_start, 0, from) && value.to_block === to && counter(value.epoch)
    && (to === value.archive_start ? value.boundary_hash === "" : hash(value.boundary_hash));
}

function classification(tx) {
  return (!Object.hasOwn(tx,"is_coinbase") || typeof tx.is_coinbase === "boolean")
    && (!Object.hasOwn(tx,"transaction_type") || ["coinbase","transparent","shielded","mixed","unknown"].includes(tx.transaction_type))
    && (!(Object.hasOwn(tx,"is_coinbase") && Object.hasOwn(tx,"transaction_type")) || tx.is_coinbase === (tx.transaction_type === "coinbase"));
}
function liveMetadata(tx) {
  return object(tx) && hash(tx.txid) && typeof tx.is_coinbase === "boolean" && typeof tx.transaction_type === "string" && classification(tx)
    && integer(tx.version,1,0xffffffff) && integer(tx.size_bytes,1,0xffffffff)
    && SHIELDED_COUNT_FIELDS.every(field=>integer(tx[field],0,0xffffffff));
}
function validateTransactionsResult(value, request, fields) {
  const fail = () => { throw new ProtocolError("INVALID_TRANSACTIONS_RESPONSE"); };
  if (!object(value) || !["mainnet", "testnet", "regtest"].includes(value.network)
      || !counter(value.epoch) || !counter(value.revision) || value.complete !== true
      || value.from_block !== request.from_block || value.to_block !== request.to_block
      || !snapshot(value.snapshot, request.from_block, request.to_block)
      || value.snapshot.network !== value.network || value.snapshot.epoch !== value.epoch
      || !(value.archive_height === null ? request.from_block === request.to_block && value.snapshot.archive_start === request.from_block
        : integer(value.archive_height, value.snapshot.archive_start, 0xffffffff) && request.to_block <= value.archive_height + 1)
      || !Array.isArray(value.transactions) || value.transactions.length > 4096
      || !Array.isArray(value.missing_txids)) fail();
  if (request.at && Object.keys(request.at).some(key => request.at[key] !== value.snapshot[key])) fail();
  const requested = new Set(request.txids);
  const found = new Set();
  let previousHeight = -1, previousIndex = -1;
  for (const tx of value.transactions) {
    if (!object(tx) || fields.some(field => !Object.hasOwn(tx, field))
        || Object.keys(tx).some(field => !fields.includes(field))
        || !hash(tx.txid) || !requested.has(tx.txid)
        || !integer(tx.block_height, request.from_block, request.to_block - 1)
        || !integer(tx.index, 0, 0xffffffff)
        || tx.block_height < previousHeight || (tx.block_height === previousHeight && tx.index <= previousIndex)) fail();
    previousHeight = tx.block_height; previousIndex = tx.index; found.add(tx.txid);
    for (const field of [...SHIELDED_COUNT_FIELDS, "expiry_height", "version", "locktime", "size_bytes", "transparent_input_count", "transparent_output_count"]) {
      if (Object.hasOwn(tx, field) && !integer(tx[field], field === "size_bytes" ? 1 : 0, 0xffffffff)) fail();
    }
    if (Object.hasOwn(tx, "raw") && (typeof tx.raw !== "string" || tx.raw.length === 0 || tx.raw.length % 2 !== 0 || !/^[0-9a-f]+$/.test(tx.raw))) fail();
    if (!classification(tx)) throw new ProtocolError("INVALID_TRANSACTION_METADATA");
    for (const field of ["vin", "vout", "decoded"]) {
      if (Object.hasOwn(tx, field)) {
        if (field === "decoded" ? !object(tx[field]) : !Array.isArray(tx[field])) fail();
        ensureNestedNumbersAreStrings(tx[field]);
      }
    }
  }
  const expectedMissing = [...requested].filter(txid => !found.has(txid));
  if (value.missing_txids.length !== expectedMissing.length || value.missing_txids.some((txid, index) => txid !== expectedMissing[index])) fail();
  return value;
}

function validateCapabilities(value) {
  const list = (values, required) => Array.isArray(values) && values.length <= 256
    && values.every(item => typeof item === "string" && item.length > 0 && item.length <= 128)
    && new Set(values).size === values.length && required.every(item => values.includes(item));
  const bounds = (value, keys) => object(value) && keys.every(key => integer(value[key], 1, 0x100000000));
  if (!object(value) || value.api_version !== 1
      || !list(value.routes, ["/health", "/ready", "/height", "/query", "/transactions", "/capabilities"])
      || !bounds(value.limits, ["max_request_bytes", "max_active_queries", "query_timeout_ms"])
      || ["max_waiting_queries", "queue_timeout_ms"].some(key => object(value.limits) && Object.hasOwn(value.limits, key) && !integer(value.limits[key], 1, 0x100000000))
      || !bounds(value.query, ["max_scan_blocks", "max_response_bytes"])
      || ["max_adaptive_scan_blocks", "adaptive_scan_ms", "max_adaptive_response_bytes", "adaptive_target_response_bytes"].some(key => object(value.query) && Object.hasOwn(value.query, key) && !integer(value.query[key], 1, 0x100000000))
      || !list(value.query.block_fields, BLOCK_FIELDS) || !list(value.query.transaction_fields, TRANSACTION_FIELDS.filter(field => ![...SHIELDED_COUNT_FIELDS, "is_coinbase", "transaction_type", "expiry_height"].includes(field)))
      || !list(value.query.transaction_filters, ["txids", "versions", "has_sapling", "has_orchard", "transparent_output_addresses"])
      || !bounds(value.transactions, ["max_ids", "max_range_blocks", "max_records", "max_response_bytes"])
      || !list(value.transactions.required_fields, TRANSACTION_IDENTITIES)
      || !list(value.transactions.default_fields, DEFAULT_TRANSACTION_FIELDS)
      || value.transactions.required_fields.some(field => !value.query.transaction_fields.includes(field))
      || value.transactions.default_fields.some(field => !value.query.transaction_fields.includes(field))) throw new ProtocolError("INVALID_CAPABILITIES_RESPONSE");
  if (Object.hasOwn(value, "live") && (!object(value.live)
      || typeof value.live.source_required !== "boolean" || typeof value.live.configured !== "boolean"
      || !integer(value.live.max_response_bytes, 1, MAX_TRANSACTIONS_BODY_BYTES)
      || !integer(value.live.max_mempool_rows, 1, 20)
      || typeof value.live.scope !== "string" || !value.live.scope.length)) throw new ProtocolError("INVALID_CAPABILITIES_RESPONSE");
  return value;
}
function validateTimeout(value) {
  if (!integer(value, 1, 2_147_483_647)) throw new TypeError("timeoutMs must be a positive bounded integer");
  return value;
}
function ensureNestedNumbersAreStrings(value) {
  if (typeof value === "number") throw new ProtocolError("UNSAFE_DECODED_NUMBER");
  if (Array.isArray(value)) { for (const item of value) ensureNestedNumbersAreStrings(item); }
  else if (object(value)) { for (const item of Object.values(value)) ensureNestedNumbersAreStrings(item); }
}
function validateQueryResult(value, query) {
  if (!object(value) || !["mainnet", "testnet", "regtest"].includes(value.network)
      || !decimal(value.epoch) || !decimal(value.revision)
      || !(value.archive_height === null || integer(value.archive_height, 0, 0xffffffff))
      || !integer(value.from_block, 0, 0xffffffff) || value.from_block !== query.from_block
      || !integer(value.to_block, value.from_block, 0x100000000)
      || !integer(value.next_block, value.from_block, value.to_block)
      || (query.to_block !== undefined && query.to_block !== null && value.to_block !== query.to_block)
      || !cursor(value.cursor) || !object(value.data)
      || !Array.isArray(value.data.blocks) || !Array.isArray(value.data.transactions)
      || !value.data.blocks.every(object) || !value.data.transactions.every(object)) {
    throw new ProtocolError();
  }
  for (const tx of value.data.transactions) {
    for (const field of [...SHIELDED_COUNT_FIELDS, "expiry_height", "size_bytes", "transparent_input_count", "transparent_output_count"]) {
      if (Object.hasOwn(tx, field) && !integer(tx[field], field === "size_bytes" ? 1 : 0, 0xffffffff)) throw new ProtocolError("INVALID_TRANSACTION_METADATA");
    }
    if (!classification(tx)) throw new ProtocolError("INVALID_TRANSACTION_METADATA");
    for (const field of ["vin", "vout", "decoded"]) {
      if (Object.hasOwn(tx, field)) ensureNestedNumbersAreStrings(tx[field]);
    }
  }
  for (const block of value.data.blocks) {
    if (Object.hasOwn(block, "decoded")) ensureNestedNumbersAreStrings(block.decoded);
  }
  if ((value.next_block === value.to_block) !== (value.cursor === null)) {
    throw new ProtocolError("INVALID_CONTINUATION");
  }
  return value;
}

async function readJson(response, maxBytes = MAX_BODY_BYTES) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && (!/^[0-9]+$/.test(declaredLength) || Number(declaredLength) > maxBytes)) {
    await response.body?.cancel();
    throw new ProtocolError("RESPONSE_TOO_LARGE");
  }
  if (!response.body) throw new ProtocolError("EMPTY_RESPONSE");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new ProtocolError("RESPONSE_TOO_LARGE"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new ProtocolError("INVALID_RESPONSE_JSON"); }
}

export class PrepClient {
  #base;
  #token;
  #fetch;
  #timeoutMs;

  constructor({ url, token, timeoutMs = 30_000, fetch: fetchImpl = globalThis.fetch }) {
    let parsed;
    try { parsed = new URL(url); } catch { throw new TypeError("Invalid Prep URL"); }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new TypeError("Prep URL must be HTTP(S) without embedded credentials, query, or fragment");
    }
    if (token !== undefined && (typeof token !== "string" || token.length === 0)) throw new TypeError("Invalid API token");
    if (typeof fetchImpl !== "function") throw new TypeError("A native-fetch-compatible implementation is required");
    if (!parsed.pathname.endsWith("/")) parsed.pathname += "/";
    this.#base = parsed;
    this.#token = token;
    this.#fetch = fetchImpl;
    this.#timeoutMs = validateTimeout(timeoutMs);
  }

  async #request(path, query, options = {}, maxBytes = MAX_BODY_BYTES) {
    const timeout = AbortSignal.timeout(validateTimeout(options.timeoutMs ?? this.#timeoutMs));
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    signal.throwIfAborted();
    const headers = { accept: "application/json" };
    if (this.#token !== undefined) headers.authorization = `Bearer ${this.#token}`;
    if (query !== undefined) headers["content-type"] = "application/json";
    try {
      const response = await this.#fetch(new URL(path, this.#base), {
        method: query === undefined ? "GET" : "POST", headers, signal,
        redirect: "error", ...(query === undefined ? {} : { body: JSON.stringify(query) }),
      });
      const value = await readJson(response, maxBytes);
      signal.throwIfAborted();
      if (!response.ok) {
        const reported = value?.error?.code;
        const code = typeof reported === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(reported) ? reported : "HTTP_ERROR";
        if (response.status === 409 && code === "REORG") throw new ReorgError();
        throw new PrepError(code, response.status);
      }
      return value;
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof PrepError) throw error;
      // Fetch failures may contain tokens or URLs. Do not propagate third-party messages.
      throw new PrepError("TRANSPORT_ERROR");
    }
  }

  async getHeight(options = {}) {
    const result = await this.#request("height", undefined, options);
    if (!object(result) || !(result.archive_height === null || integer(result.archive_height, 0, 0xffffffff))
        || !integer(result.start_block, 0, 0xffffffff) || !decimal(result.epoch) || !decimal(result.revision)
        || !["mainnet", "testnet", "regtest"].includes(result.network) || typeof result.ready !== "boolean") {
      throw new ProtocolError();
    }
    for (const field of ["indexed_height", "source_height", "lag_blocks"]) {
      if (!(result[field] === null || integer(result[field], 0, 0xffffffff))) throw new ProtocolError();
    }
    if (!(result.source_observed_at === null || integer(result.source_observed_at, 0, Number.MAX_SAFE_INTEGER))) throw new ProtocolError();
    return result;
  }

  /** Compiled API support and bounds; readiness is obtained separately via getHeight. */
  async getCapabilities(options = {}) {
    return validateCapabilities(await this.#request("capabilities", undefined, options));
  }

  async get(query, options = {}) {
    if (!object(query) || !integer(query.from_block, 0, 0xffffffff)) throw new TypeError("from_block must be a bounded integer");
    if (query.to_block !== undefined && query.to_block !== null && !integer(query.to_block, query.from_block, 0x100000000)) throw new TypeError("Invalid exclusive to_block");
    if (query.scan_mode !== undefined && query.scan_mode !== null && query.scan_mode !== "adaptive") throw new TypeError("Unsupported scan_mode");
    const maxScan = query.scan_mode === "adaptive" ? 1000000 : 1000;
    if (query.limit !== undefined && !integer(query.limit, 1, maxScan)) throw new TypeError(`limit must be 1..${maxScan} scanned blocks`);
    if (query.field_selection !== undefined) {
      if (!object(query.field_selection) || Object.keys(query.field_selection).some(key => !["block", "transaction"].includes(key))) throw new TypeError("Invalid field_selection");
      for (const [key, fields] of [["block", BLOCK_FIELDS], ["transaction", TRANSACTION_FIELDS]]) {
        const selected = query.field_selection[key];
        if (selected !== undefined && (!Array.isArray(selected) || new Set(selected).size !== selected.length || selected.some(field => !fields.includes(field)))) throw new TypeError("Invalid selected fields");
      }
    }
    const pools = query.transaction_filter?.shielded_pools;
    if (pools !== undefined && pools !== null && (!Array.isArray(pools) || pools.length > 3 || new Set(pools).size !== pools.length || pools.some(pool => !["sapling", "orchard", "ironwood"].includes(pool)))) throw new TypeError("Invalid shielded_pools filter");
    return validateQueryResult(await this.#request("query", query, options), query);
  }

  /** Optional live-node observation, separate from archive queries. */
  async getTransaction(txid, options = {}) {
    if (!hash(txid)) throw new TypeError("Invalid transaction ID");
    const value=await this.#request("transaction",{txid},options);
    if (!object(value) || value.network!=="testnet" || value.txid!==txid || !integer(value.observed_at,1,Number.MAX_SAFE_INTEGER) || !["pending","mined","not_observed"].includes(value.status)) throw new ProtocolError("INVALID_LIVE_OBSERVATION");
    if (value.status==="not_observed") { if(value.transaction!==null || value.block_height!=null || value.block_hash!=null || value.confirmations!=null) throw new ProtocolError("INVALID_LIVE_OBSERVATION");return value; }
    if (!liveMetadata(value.transaction) || value.transaction.txid!==txid || !object(value.decoded)) throw new ProtocolError("INVALID_LIVE_OBSERVATION");
    ensureNestedNumbersAreStrings(value.decoded);
    if (value.status==="pending" ? value.block_height!==null || value.confirmations!==null || value.block_hash!==null || value.transaction.is_coinbase
      : !integer(value.block_height,0,0xffffffff) || !hash(value.block_hash) || !integer(value.source_height,value.block_height,0xffffffff) || value.confirmations!==value.source_height-value.block_height+1) throw new ProtocolError("INVALID_LIVE_OBSERVATION");
    return value;
  }
  async getMempool(options = {}) {
    const value=await this.#request("mempool",undefined,options);
    if (!object(value) || value.network!=="testnet" || !integer(value.observed_at,1,Number.MAX_SAFE_INTEGER) || !integer(value.source_total,0,50000)
      || !integer(value.max_rows,1,100) || !integer(value.raced_out,0,100) || !Array.isArray(value.transactions) || value.transactions.length>Math.min(value.max_rows,value.source_total)
      || value.has_more!==(value.source_total>value.max_rows) || value.transactions.some(tx=>!liveMetadata(tx)||tx.is_coinbase!==false) || new Set(value.transactions.map(tx=>tx.txid)).size!==value.transactions.length) throw new ProtocolError("INVALID_MEMPOOL_OBSERVATION");
    return value;
  }

  /** Complete bounded sparse lookup. Rows are ordered by mined height and index. */
  async getTransactions(request, options = {}) {
    if (!object(request) || Object.keys(request).some(key => !["from_block", "to_block", "txids", "fields", "at"].includes(key))
        || !integer(request.from_block, 0, 0xffffffff)
        || !integer(request.to_block, request.from_block, 0x100000000)
        || request.to_block - request.from_block > 10000
        || !Array.isArray(request.txids) || request.txids.length > 128 || request.txids.some(txid => !hash(txid))) throw new TypeError("Invalid bounded transactions request");
    const fields = request.fields === undefined ? DEFAULT_TRANSACTION_FIELDS : request.fields;
    if (!Array.isArray(fields) || new Set(fields).size !== fields.length || fields.some(field => !TRANSACTION_FIELDS.includes(field))
        || TRANSACTION_IDENTITIES.some(field => !fields.includes(field))) throw new TypeError("Transaction fields must include txid, block_height and index");
    if (request.at !== undefined && !snapshot(request.at, request.from_block, request.to_block)) throw new TypeError("Invalid transactions snapshot");
    // Freeze the validated request while awaiting the transport; caller mutations
    // must not change the completeness or snapshot comparison after dispatch.
    const captured = structuredClone(request);
    const capturedFields = [...fields];
    return validateTransactionsResult(await this.#request("transactions", captured, options, MAX_TRANSACTIONS_BODY_BYTES), captured, capturedFields);
  }

  /** Finite pagination at a captured exclusive head. Empty filtered pages advance.
   *  The stream never silently restarts after a rollback or mixes epochs. */
  async *stream(query, options = {}) {
    const current = structuredClone(query);
    const maxPages = options.maxPages ?? 100_000;
    if (!integer(maxPages, 1, 1_000_000)) throw new TypeError("Invalid maxPages");
    const totalSignal = AbortSignal.timeout(validateTimeout(options.totalTimeoutMs ?? 120_000));
    const signal = options.signal ? AbortSignal.any([options.signal, totalSignal]) : totalSignal;
    let epoch, network, fixedTo, previousNext = current.from_block;
    for (let page = 0; page < maxPages; page++) {
      signal.throwIfAborted();
      const response = await this.get(current, { signal, timeoutMs: options.timeoutMs });
      if (epoch === undefined) { epoch = response.epoch; network = response.network; fixedTo = response.to_block; }
      else if (response.epoch !== epoch) { throw new ReorgError(); }
      if (response.network !== network || response.to_block !== fixedTo) throw new ProtocolError("SNAPSHOT_RANGE_CHANGED");
      const complete = response.next_block === fixedTo;
      if (response.next_block < previousNext || (!complete && response.next_block <= previousNext)) {
        throw new ProtocolError("NONADVANCING_CURSOR");
      }
      previousNext = response.next_block;
      yield response;
      if (complete) return;
      current.to_block = fixedTo;
      current.cursor = response.cursor;
    }
    throw new ProtocolError("MAX_PAGES_EXCEEDED");
  }
}
