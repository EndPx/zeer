/** Native fetch only. No wallet keys, native addon, or implicit reorg restart. */
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const MAX_CURSOR_CHARACTERS = 4096;

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

async function readJson(response) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && (!/^[0-9]+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) {
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
      if (length > MAX_BODY_BYTES) { await reader.cancel(); throw new ProtocolError("RESPONSE_TOO_LARGE"); }
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

  async #request(path, query, options = {}) {
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
      const value = await readJson(response);
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

  async get(query, options = {}) {
    if (!object(query) || !integer(query.from_block, 0, 0xffffffff)) throw new TypeError("from_block must be a bounded integer");
    if (query.to_block !== undefined && query.to_block !== null && !integer(query.to_block, query.from_block, 0x100000000)) throw new TypeError("Invalid exclusive to_block");
    if (query.limit !== undefined && !integer(query.limit, 1, 1000)) throw new TypeError("limit must be 1..1000 scanned blocks");
    return validateQueryResult(await this.#request("query", query, options), query);
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
