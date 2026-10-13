import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { PrepClient, PrepError, ProtocolError, ReorgError } from "../src/index.js";

function page(next, to = 13, extra = {}) {
  return { archive_height: to - 1, network: "regtest", epoch: "3", revision: "8", from_block: 10,
    to_block: to, next_block: next, cursor: next < to ? "aa" : null,
    canonicality: "historical_snapshot_not_independently_consensus_validated",
    data: { blocks: [], transactions: [] }, ...extra };
}
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); }

test("finite stream advances through empty filtered pages and freezes the first head", async () => {
  const calls = [];
  const client = new PrepClient({ url: "http://localhost:1234", fetch: async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return json(calls.length === 1 ? page(12) : page(13, 13, { archive_height: 99, revision: "9" }));
  } });
  const pages = [];
  for await (const result of client.stream({ from_block: 10, limit: 2, transaction_filter: { txids: [] } })) pages.push(result);
  assert.equal(pages.length, 2);
  assert.equal(calls[1].to_block, 13);
  assert.equal(calls[1].cursor, "aa");
  assert.equal(calls[1].from_block, 10);
});

test("HTTP409 throws typed ReorgError without retry", async () => {
  let count = 0;
  const client = new PrepClient({ url: "http://localhost", fetch: async () => {
    count++;
    return count === 1 ? json(page(12)) : json({ error: { code: "REORG" } }, 409);
  } });
  await assert.rejects(async () => { for await (const _ of client.stream({ from_block: 10 })) {} }, ReorgError);
  assert.equal(count, 2);
});

test("a server returning200 with another epoch is also rejected", async () => {
  let count = 0;
  const client = new PrepClient({ url: "http://localhost", fetch: async () => json(++count === 1 ? page(12) : page(13, 13, { epoch: "4" })) });
  await assert.rejects(async () => { for await (const _ of client.stream({ from_block: 10 })) {} }, ReorgError);
});

test("nonadvancing continuation stops instead of looping", async () => {
  let count = 0;
  const client = new PrepClient({ url: "http://localhost", fetch: async () => { count++; return json(page(12)); } });
  await assert.rejects(async () => { for await (const _ of client.stream({ from_block: 10 })) {} }, { code: "NONADVANCING_CURSOR" });
  assert.equal(count, 2);
});

test("empty completed range is a finite single page", async () => {
  let count = 0;
  const client = new PrepClient({ url: "http://localhost", fetch: async () => { count++; return json(page(10, 10)); } });
  const pages = [];
  for await (const value of client.stream({ from_block: 10, to_block: 10 })) pages.push(value);
  assert.equal(count, 1);
  assert.equal(pages.length, 1);
});

test("nested decoded amounts remain decimal strings and numeric amounts fail closed", async () => {
  const result = page(13);
  result.data.transactions = [{ vout: [{ value: "0.123456789123456789", n: "0" }] }];
  const client = new PrepClient({ url: "http://localhost", fetch: async () => json(result) });
  assert.equal((await client.get({ from_block: 10 })).data.transactions[0].vout[0].value, "0.123456789123456789");
  result.data.transactions[0].vout[0].value = 0.1;
  await assert.rejects(client.get({ from_block: 10 }), { code: "UNSAFE_DECODED_NUMBER" });
});

test("request cancellation is preserved without printing transport secrets", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("Cancelled by caller", "AbortError"));
  let count = 0;
  const client = new PrepClient({ url: "http://localhost", fetch: async () => { count++; throw new Error("private URL token"); } });
  await assert.rejects(client.get({ from_block: 10 }, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(count, 0);
  await assert.rejects(client.get({ from_block: 10 }), error => error instanceof PrepError && error.message === "TRANSPORT_ERROR");
});

test("whole decoded block preserves source fields and rejects numeric nested tokens", async () => {
  const result = page(13);
  result.data.blocks = [{ height: 10, decoded: { nonce: "node-nonce", bits: "1d00ffff", future_field: { value: "0.123456789123456789", height: "10" }, tx: [{ version: "1" }] } }];
  const client = new PrepClient({ url: "http://localhost", fetch: async () => json(result) });
  const query = { from_block: 10, field_selection: { block: ["height", "decoded"], transaction: [] } };
  const returned = await client.get(query);
  assert.equal(returned.data.blocks[0].decoded.nonce, "node-nonce");
  assert.equal(returned.data.blocks[0].decoded.future_field.value, "0.123456789123456789");
  result.data.blocks[0].decoded.tx[0].version = 1;
  await assert.rejects(client.get(query), { code: "UNSAFE_DECODED_NUMBER" });
});

test("request timeout aborts a pending native-fetch-compatible transport", async () => {
  const client = new PrepClient({ url: "http://localhost", timeoutMs: 10, fetch: async (_url, { signal }) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(json(page(13))), 1000);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  }) });
  await assert.rejects(client.get({ from_block: 10 }), { name: "TimeoutError" });
});

test("oversized response and invalid cursor contract are rejected", async () => {
  const oversized = new PrepClient({ url: "http://localhost", fetch: async () => new Response("{}", { headers: { "content-length": String(32 * 1024 * 1024 + 1) } }) });
  await assert.rejects(oversized.get({ from_block: 10 }), { code: "RESPONSE_TOO_LARGE" });
  const invalid = new PrepClient({ url: "http://localhost", fetch: async () => json(page(13, 13, { cursor: "aa" })) });
  await assert.rejects(invalid.get({ from_block: 10 }), ProtocolError);
});

test("maxPages bounds a progressing but unexpectedly long stream", async () => {
  let next = 10;
  const client = new PrepClient({ url: "http://localhost", fetch: async () => json(page(++next, 100)) });
  await assert.rejects(async () => { for await (const _ of client.stream({ from_block: 10 }, { maxPages: 2 })) {} }, { code: "MAX_PAGES_EXCEEDED" });
});

test("real local HTTP roundtrip forwards auth and address filter", async () => {
  const requests = [];
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.headers.authorization !== "Bearer fixture-token") { response.writeHead(401); response.end(JSON.stringify({ error: { code: "UNAUTHORIZED" } })); return; }
    if (request.url === "/height") {
      response.end(JSON.stringify({ archive_height: 12, indexed_height: 12, source_height: 15, lag_blocks: 3, source_observed_at: 1700000000, start_block: 10, network: "regtest", epoch: "3", revision: "8", payload_kind: "full-v1", ready: true }));
      return;
    }
    let body = "";
    for await (const part of request) body += part.toString();
    requests.push(JSON.parse(body));
    response.end(JSON.stringify(page(13)));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const client = new PrepClient({ url: `http://127.0.0.1:${server.address().port}`, token: "fixture-token" });
    assert.equal((await client.getHeight()).lag_blocks, 3);
    await client.get({ from_block: 10, transaction_filter: { transparent_output_addresses: ["tExampleAddress"] } });
    assert.deepEqual(requests[0].transaction_filter.transparent_output_addresses, ["tExampleAddress"]);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test("URLs containing secrets are rejected before transport", () => {
  for (const url of ["http://user:secret@localhost", "http://localhost/?token=secret", "http://localhost/#secret"]) {
    assert.throws(() => new PrepClient({ url }), TypeError);
  }
});
