import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { PrepClient, PrepError, ProtocolError, ReorgError } from "../src/index.js";

const A = "11".repeat(32), B = "22".repeat(32), C = "33".repeat(32);
const fields = ["txid", "block_height", "index", "version", "locktime", "size_bytes", "transparent_input_count", "transparent_output_count"];
const request = (txids = [A]) => ({ from_block: 10, to_block: 13, txids });
const row = (overrides = {}) => ({ txid: A, block_height: 10, index: 0, version: 6, locktime: 0xffffffff, size_bytes: 12, transparent_input_count: 1, transparent_output_count: 2, ...overrides });
function result(query = request(), rows = [row()]) {
  const found = new Set(rows.map(tx => tx.txid));
  return { network: "regtest", epoch: "3", revision: "8", archive_height: 12,
    from_block: query.from_block, to_block: query.to_block, complete: true,
    snapshot: { network: "regtest", archive_start: 10, to_block: query.to_block, epoch: "3", boundary_hash: A },
    transactions: rows, missing_txids: [...new Set(query.txids)].filter(txid => !found.has(txid)) };
}
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const client = response => new PrepClient({ url: "http://localhost", fetch: async () => json(response) });
const capabilities = () => ({ api_version: 1, routes: ["/health", "/ready", "/height", "/query", "/transactions", "/capabilities"],
  limits: { max_request_bytes: 65536, max_active_queries: 2, query_timeout_ms: 30000 },
  query: { max_scan_blocks: 1000, max_response_bytes: 33554432, block_fields: ["height", "hash", "previous_hash", "time", "raw", "decoded"],
    transaction_fields: [...fields, "raw", "vin", "vout", "decoded"], transaction_filters: ["txids", "versions", "has_sapling", "has_orchard", "transparent_output_addresses"] },
  transactions: { max_ids: 128, max_range_blocks: 10000, max_records: 4096, max_response_bytes: 4194304, required_fields: fields.slice(0, 3), default_fields: fields } });

test("complete sparse lookup preserves repeated canonical IDs and input-order unique missing IDs", async () => {
  const query = request([B, A, B, C, A]);
  const response = result(query, [row(), row({ block_height: 12, index: 3 })]);
  assert.deepEqual((await client(response).getTransactions(query)).missing_txids, [B, C]);
  assert.equal((await client(response).getTransactions(query)).transactions.length, 2);
  const appended = { ...response, archive_height: 99, revision: "9" };
  assert.equal((await client(appended).getTransactions({ ...query, at: response.snapshot })).revision, "9");
});

test("empty ID sets and empty ranges still require coherent prefix snapshot metadata", async () => {
  const query = request([]);
  assert.deepEqual((await client(result(query, [])).getTransactions(query)).transactions, []);
  const emptyRange = { from_block: 12, to_block: 12, txids: [A] };
  assert.deepEqual((await client(result(emptyRange, [])).getTransactions(emptyRange)).missing_txids, [A]);
  const uninitialized = { from_block: 10, to_block: 10, txids: [] };
  const response = result(uninitialized, []);
  response.archive_height = null; response.snapshot.boundary_hash = "";
  assert.equal((await client(response).getTransactions(uninitialized)).archive_height, null);
  response.snapshot.boundary_hash = A;
  await assert.rejects(client(response).getTransactions(uninitialized), ProtocolError);
});

test("invalid sparse request bounds, IDs, fields and snapshots fail before transport", async () => {
  let calls = 0;
  const api = new PrepClient({ url: "http://localhost", fetch: async () => { calls++; return json(result()); } });
  for (const override of [{ to_block: undefined }, { to_block: null }, { from_block: -1 }, { to_block: 10011 }, { txids: Array(129).fill(A) },
    { txids: ["AA".repeat(32)] }, { txids: ["11"] }, { txids: null }, { fields: ["txid", "index"] }, { fields: [...fields, "txid"] },
    { fields: [...fields, "private_memo"] }, { fields: null }, { unknown: true }, { at: null },
    { at: { ...result().snapshot, to_block: 14 } }, { at: { ...result().snapshot, epoch: "18446744073709551616" } }]) {
    await assert.rejects(api.getTransactions({ ...request(), ...override }), TypeError);
  }
  assert.equal(calls, 0);
});

test("legal inclusive limits accept 128 filter entries, 10000-block span and 4096 rows", async () => {
  const query = { from_block: 0x100000000 - 10000, to_block: 0x100000000, txids: Array(128).fill(A) };
  const response = result(query, Array.from({ length: 4096 }, (_, index) => row({ block_height: 0xffffffff, index })));
  response.archive_height = 0xffffffff;
  assert.equal((await client(response).getTransactions(query)).transactions.length, 4096);
});

test("partial, unrequested, unsorted, duplicate-location and incomplete accounting responses fail closed", async () => {
  const cases = [
    { complete: false }, { transactions: [row({ txid: B })] }, { transactions: [row({ index: 1 }), row({ index: 0 })] },
    { transactions: [row(), row()] }, { transactions: [row({ block_height: 13 })] }, { transactions: [row({ index: 1.5 })] },
    { transactions: [], missing_txids: [] }, { missing_txids: [A] }, { transactions: [], missing_txids: [A, A] },
    { transactions: [row({ size_bytes: "12" })] }, { transactions: [row({ version: 0x100000000 })] }, { transactions: [row({ transparent_input_count: -1 })] },
    { transactions: [row({ locktime: true })] }, { epoch: "18446744073709551616" }, { revision: "-1" }, { archive_height: 11 },
    { transactions: Array.from({ length: 4097 }, (_, index) => row({ index })) },
  ];
  const missingField = row(); delete missingField.size_bytes;
  cases.push({ transactions: [missingField] });
  for (const override of cases) await assert.rejects(client({ ...result(), ...override }).getTransactions(request()), ProtocolError);
  const query = request([B, C]);
  await assert.rejects(client({ ...result(query, []), missing_txids: [C, B] }).getTransactions(query), ProtocolError);
});

test("successful snapshot changes are protocol errors; actual 409 REORG remains typed", async () => {
  const before = result();
  for (const override of [{ epoch: "4" }, { boundary_hash: B }, { network: "mainnet" }, { archive_start: 9 }]) {
    const response = structuredClone(before);
    Object.assign(response.snapshot, override);
    response.epoch = response.snapshot.epoch; response.network = response.snapshot.network;
    await assert.rejects(client(response).getTransactions({ ...request(), at: before.snapshot }), error => error instanceof ProtocolError && !(error instanceof ReorgError));
  }
  const reorg = new PrepClient({ url: "http://localhost", fetch: async () => json({ error: { code: "REORG" } }, 409) });
  await assert.rejects(reorg.getTransactions(request()), ReorgError);
  const mismatch = new PrepClient({ url: "http://localhost", fetch: async () => json({ error: { code: "LOOKUP_SNAPSHOT_MISMATCH" } }, 409) });
  await assert.rejects(mismatch.getTransactions(request()), error => error instanceof PrepError && !(error instanceof ReorgError) && error.code === "LOOKUP_SNAPSHOT_MISMATCH");
});

test("raw and nested projections require valid hex, shapes and lossless numeric strings", async () => {
  const query = { ...request(), fields: [...fields.slice(0, 3), "raw", "vin", "vout", "decoded"] };
  const tx = { txid: A, block_height: 10, index: 0, raw: "0011", vin: [{ n: "0" }], vout: [{ value: "0.123456789123456789" }], decoded: { version: "6" } };
  assert.equal((await client(result(query, [tx])).getTransactions(query)).transactions[0].vout[0].value, tx.vout[0].value);
  for (const override of [{ raw: "0" }, { raw: "GG" }, { vin: {} }, { decoded: [] }, { decoded: { version: 6 } }]) {
    await assert.rejects(client(result(query, [{ ...tx, ...override }])).getTransactions(query), ProtocolError);
  }
});

test("sparse lookup freezes the caller request across asynchronous transport", async () => {
  const query = request();
  let respond;
  const api = new PrepClient({ url: "http://localhost", fetch: async () => new Promise(resolve => { respond = resolve; }) });
  const pending = api.getTransactions(query);
  query.txids[0] = B; query.to_block = 11;
  respond(json(result()));
  assert.equal((await pending).transactions[0].txid, A);
});

test("sparse lookup has its own 4 MiB declared and streamed response cap", async () => {
  const declared = new PrepClient({ url: "http://localhost", fetch: async () => new Response("{}", { headers: { "content-length": String(4194305) } }) });
  await assert.rejects(declared.getTransactions(request()), { code: "RESPONSE_TOO_LARGE" });
  let cancelled = false;
  const streamed = new PrepClient({ url: "http://localhost", fetch: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(4194304)); controller.enqueue(new Uint8Array(1)); },
    cancel() { cancelled = true; },
  })) });
  await assert.rejects(streamed.getTransactions(request()), { code: "RESPONSE_TOO_LARGE" });
  assert.equal(cancelled, true);
});

test("sparse and capability calls preserve caller cancellation and transport timeouts", async () => {
  const abort = new AbortController(); abort.abort(new DOMException("Stopped", "AbortError"));
  let calls = 0;
  const api = new PrepClient({ url: "http://localhost", fetch: async () => { calls++; throw new Error("credential-secret"); } });
  await assert.rejects(api.getTransactions(request(), { signal: abort.signal }), { name: "AbortError" });
  await assert.rejects(api.getCapabilities({ signal: abort.signal }), { name: "AbortError" });
  assert.equal(calls, 0);
  await assert.rejects(api.getTransactions(request()), error => error.code === "TRANSPORT_ERROR" && !error.message.includes("credential"));
  const timeout = new PrepClient({ url: "http://localhost", timeoutMs: 10, fetch: async (_url, { signal }) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(json(result())), 1000);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  }) });
  await assert.rejects(timeout.getTransactions(request()), { name: "TimeoutError" });
});

test("capabilities validates compiled support and bounds while allowing future additional fields", async () => {
  const response = capabilities(); response.extra = "future"; response.routes.push("/future");
  assert.equal((await client(response).getCapabilities()).api_version, 1);
  for (const mutate of [value => { value.api_version = 2; }, value => { value.routes.pop(); value.routes.pop(); }, value => { value.limits.max_active_queries = 0; },
    value => { value.query.max_response_bytes = 1.5; }, value => { value.query.block_fields.push("height"); }, value => { value.transactions.default_fields = ["txid"]; },
    value => { value.transactions.max_ids = "128"; }, value => { value.query.transaction_filters = []; }]) {
    const changed = capabilities(); mutate(changed);
    await assert.rejects(client(changed).getCapabilities(), { code: "INVALID_CAPABILITIES_RESPONSE" });
  }
});

test("queue capabilities are optional for older servers and validated when present", async () => {
  for (const limits of [{}, { max_waiting_queries: 8, queue_timeout_ms: 250 }]) {
    const value = capabilities(); Object.assign(value.limits, limits);
    const api = new PrepClient({ url: "http://localhost", fetch: async () => new Response(JSON.stringify(value)) });
    assert.deepEqual((await api.getCapabilities()).limits, value.limits);
  }
  for (const field of ["max_waiting_queries", "queue_timeout_ms"]) {
    for (const invalid of [0, -1, 1.5, true, "250"]) {
      const value = capabilities(); value.limits[field] = invalid;
      const api = new PrepClient({ url: "http://localhost", fetch: async () => new Response(JSON.stringify(value)) });
      await assert.rejects(api.getCapabilities(), { code: "INVALID_CAPABILITIES_RESPONSE" });
    }
  }
});

test("real HTTP sparse/capabilities routes forward auth and reuse a snapshot", async () => {
  const calls = [];
  const server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.headers.authorization !== "Bearer fixture-token") { res.writeHead(401); res.end(JSON.stringify({ error: { code: "UNAUTHORIZED" } })); return; }
    if (req.url === "/capabilities" && req.method === "GET") { res.end(JSON.stringify(capabilities())); return; }
    let body = ""; for await (const bytes of req) body += bytes.toString();
    const query = JSON.parse(body); calls.push({ path: req.url, method: req.method, query });
    res.end(JSON.stringify(result(query)));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const api = new PrepClient({ url: `http://127.0.0.1:${server.address().port}`, token: "fixture-token" });
    await api.getCapabilities();
    const first = await api.getTransactions(request());
    await api.getTransactions({ ...request(), at: first.snapshot });
    assert.equal(calls[0].path, "/transactions"); assert.equal(calls[0].method, "POST");
    assert.deepEqual(calls[1].query.at, first.snapshot);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});


test("live capabilities remain optional and validate advertised observation budgets", async () => {
  const value = capabilities();
  value.live = {source_required:true,configured:true,max_response_bytes:4194304,max_mempool_rows:20,scope:"testnet_node_observations_not_archive_or_finality"};
  assert.deepEqual((await client(value).getCapabilities()).live, value.live);
  for (const mutate of [v => {v.configured="true";}, v => {v.max_mempool_rows=21;}, v => {v.max_response_bytes=0;}]) {
    const changed=structuredClone(value);mutate(changed.live);
    await assert.rejects(client(changed).getCapabilities(), {code:"INVALID_CAPABILITIES_RESPONSE"});
  }
});
