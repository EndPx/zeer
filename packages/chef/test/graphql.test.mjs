import test from "node:test";
import assert from "node:assert/strict";
import { createChefServer } from "../dist/graphql.js";
import { parseModel } from "../dist/schema.js";
import { StoreNotReadyError } from "../dist/store.js";

const token = "chef-test-token-0123456789";
const model = parseModel("type Payment { id: ID! amount: BigInt! height: Int! memo: String }");
const checkpoint = { height: 42, hash: "abc", anchorHash: "start", status: "ready" };
async function fixture(t, overrides = {}) {
  const calls = [];
  const rows = ["a", "b", "c"].map((id) => ({ id, amount: "9007199254740993123", height: 42, memo: null }));
  const view = {
    checkpoint: { ...checkpoint },
    async get(name, id) { calls.push(["get", name, id]); return rows.find((r) => r.id === id) ?? null; },
    async list(name, options) {
      calls.push(["list", name, options]);
      return rows.filter((row) => (!options.after || row.id > options.after) && Object.entries(options.where ?? {}).every(([key, value]) => row[key] === value)).slice(0, options.first);
    },
    ...overrides.view,
  };
  const store = { async read(fn) { calls.push(["read"]); return fn(view); }, ...overrides.store };
  const server = createChefServer({ store, model, token });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}/graphql`;
  const request = async (query, options = {}) => {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...options.headers }, body: JSON.stringify({ query, ...options.payload }), ...options.fetch });
    return { status: response.status, body: await response.json() };
  };
  return { request, calls, view, url };
}

test("GraphQL shares one read view, returns exact integers and stable ID pagination", async (t) => {
  const { request, calls } = await fixture(t);
  const first = await request('{ PaymentList(first: 2) { items { id amount } nextCursor } PaymentById(id:"a") { height } _meta { height hash status } }');
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.data.PaymentList, { items: [{id:"a",amount:"9007199254740993123"},{id:"b",amount:"9007199254740993123"}], nextCursor:"b" });
  assert.deepEqual(first.body.data._meta, {height:42,hash:"abc",status:"ready"});
  assert.equal(calls.filter(([kind]) => kind === "read").length, 1);
  assert.equal(calls.find(([kind]) => kind === "list")[2].first, 3);
  const second = await request('query($after: ID!) { PaymentList(first: 2, after: $after) { items { id } nextCursor } }', { payload:{variables:{after:"b"}} });
  assert.deepEqual(second.body.data.PaymentList, {items:[{id:"c"}], nextCursor:null});
});

test("equality filters use exact BigInt decimal operands", async (t) => {
  const { request, calls } = await fixture(t);
  const result = await request('query($amount: BigInt!) { PaymentList(where:{amount:$amount,id:"b"}) { items { id amount } } }', {payload:{variables:{amount:"9007199254740993123"}}});
  assert.equal(result.status, 200);
  assert.equal(result.body.data.PaymentList.items.length, 1);
  assert.equal(calls.find(([kind]) => kind === "list")[2].where.amount, "9007199254740993123");
  for (const amount of [9007199254740992, "01", "-0", "1e3"]) {
    assert.equal((await request('query($amount: BigInt!) { PaymentList(where:{amount:$amount}) { items { id } } }', {payload:{variables:{amount}}})).status, 400);
  }
});

test("auth and restricted GraphQL surface reject requests before database access", async (t) => {
  const { request, calls } = await fixture(t);
  assert.equal((await request("{ _meta { height } }", {headers:{authorization:"Bearer incorrect-token"}})).status, 401);
  for (const query of [
    "{ __schema { queryType { name } } }",
    '{ PaymentById(id:"a") { __typename } }',
    'mutation { PaymentById(id:"a") { id } }',
    'query A { _meta { height } } query B { _meta { height } }',
    '{ ...X } fragment X on Query { _meta { height } }',
    '{ ... on Query { _meta { height } } }',
    '{ _meta @skip(if:true) { height } }',
    `{ ${Array.from({length:6}, (_,i) => `a${i}: _meta { height }`).join(" ")} }`,
    `{ _meta { ${Array.from({length:101}, (_,i) => `a${i}: height`).join(" ")} } }`,
  ]) assert.equal((await request(query)).status, 400, query);
  assert.equal(calls.length, 0);
});

test("argument/body limits, unavailable state and database errors are bounded and sanitized", async (t) => {
  const { request, view } = await fixture(t);
  for (const query of ['{ PaymentList(first:0) { items { id } } }','{ PaymentList(first:101) { items { id } } }','{ PaymentById(id:"") { id } }','{ PaymentList(where:{amount:123}) { items { id } } }']) assert.equal((await request(query)).status, 400);
  assert.equal((await request("x".repeat(65537))).status, 400);
  view.checkpoint.status = "reconciling";
  assert.equal((await request("{ _meta { height } }")).status, 503);
  view.checkpoint.status = "ready";
  view.get = async () => { throw new Error("SQL secret password=supersecret SELECT..."); };
  const result = await request('{ PaymentById(id:"a") { id } }');
  assert.equal(result.status, 500);
  assert.doesNotMatch(JSON.stringify(result.body), /SQL|supersecret|SELECT/);
});

test("two active store reads occupy capacity until completion", async (t) => {
  let resolve;
  const gate = new Promise((done) => { resolve = done; });
  let entered = 0;
  let notify;
  const both = new Promise((done) => { notify = done; });
  const { request } = await fixture(t, {store:{ async read(fn) { entered++; if (entered === 2) notify(); await gate; return fn({checkpoint}); } }});
  const pending = [request("{ _meta { height } }"), request("{ _meta { height } }")];
  try { await both; assert.equal((await request("{ _meta { height } }")).status, 503); }
  finally { resolve(); }
  assert.deepEqual((await Promise.all(pending)).map((r) => r.status), [200,200]);
  assert.equal((await request("{ _meta { height } }")).status, 200);
});

test("PostgreSQL readiness errors thrown before the read callback return sanitized 503", async (t) => {
  for (const status of ["reconciling", "blocked"]) {
    const { request, calls } = await fixture(t, { store: { async read() { throw new StoreNotReadyError(status); } } });
    const result = await request('{ PaymentList { items { id } } _meta { height } }');
    assert.equal(result.status, 503);
    assert.deepEqual(result.body, { errors: [{ message: "Indexer is not ready" }] });
    assert.equal(calls.length, 0);
  }
});

test("response ceiling rejects oversized successful results", async (t) => {
  const rows = Array.from({length:100},(_,i)=>({id:String(i),amount:"0",height:1,memo:"x".repeat(16384)}));
  const { request } = await fixture(t,{view:{ async list(){ return rows; } }});
  const result = await request('{ a: PaymentList(first:100) { items { memo } } b: PaymentList(first:100) { items { memo } } }');
  assert.equal(result.status,400);
  assert.match(result.body.errors[0].message,/2 MiB/);
  assert.ok(JSON.stringify(result.body).length < 200);
});

test("short server tokens are rejected before listening", () => {
  assert.throws(() => createChefServer({store:{},model,token:"short"}), /token/);
});

test("repeated documents retain fresh arguments, operation selection and snapshot gates", async (t) => {
  const { request, view, calls } = await fixture(t);
  const query = 'query Payment($id:ID!){ PaymentById(id:$id){id} _meta {height hash status} }';
  assert.equal((await request(query, {payload:{variables:{id:"a"},operationName:"Payment"}})).body.data.PaymentById.id, "a");
  view.checkpoint.height = 43; view.checkpoint.hash = "new-branch";
  const changed = await request(query, {payload:{variables:{id:"b"},operationName:"Payment"}});
  assert.equal(changed.body.data.PaymentById.id, "b");
  assert.deepEqual(changed.body.data._meta, {height:43,hash:"new-branch",status:"ready"});
  for (const payload of [{variables:{}}, {variables:{id:"a"},operationName:"Other"}, {variables:{id:""}}]) assert.equal((await request(query,{payload})).status,400);
  for (const status of ["reconciling", "blocked"]) {
    view.checkpoint.status = status;
    assert.equal((await request(query,{payload:{variables:{id:"a"}}})).status,503);
  }
  view.checkpoint.status = "ready";
  assert.equal((await request(query,{payload:{variables:{id:"c"}}})).body.data.PaymentById.id,"c");
  assert.equal(calls.filter(([kind]) => kind === "read").length,8);
  const before = calls.length;
  assert.equal((await request(query,{headers:{authorization:"Bearer incorrect-token"}})).status,401);
  assert.equal(calls.length,before);
});
