import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { parseModel, queryIndexes } from "../dist/schema.js";
import { PostgresStore } from "../dist/store.js";

const url = process.env.CHEF_TEST_DATABASE_URL;
const model = parseModel("type Account { id: ID! balance: BigInt! label: String active: Boolean! count: Int! }");
const h = number => BigInt(number).toString(16).padStart(64, "0");
const block = (height, hash = h(height + 1), previousHash = h(height)) => ({ height, hash, previousHash, time: 1000 + height });
const account = (id, balance = 1n, label = null) => ({ id, balance, label, active: true, count: 1 });

async function fixture(t, overrides = {}) {
  const options = { project: `t_${randomUUID().replaceAll("-", "").slice(0, 24)}`, fingerprint: "handler-v1", startHeight: 0, network: "regtest", reorgWindow: 3, model, ...overrides };
  const store = new PostgresStore(url, options);
  const extras = [];
  t.after(async () => {
    for (const item of extras) await item.close();
    await store.close();
    const cleanup = new pg.Client({ connectionString: url });
    await cleanup.connect();
    try {
      // Generated test project only. Never enumerate or remove other schemas.
      assert.match(options.project, /^t_[0-9a-f]{24}$/);
      await cleanup.query(`DROP SCHEMA IF EXISTS "chef_${options.project}" CASCADE`);
    } finally { await cleanup.end(); }
  });
  await store.migrate();
  await store.acquire();
  return { store, options, extra: changes => { const value = new PostgresStore(url, { ...options, ...changes }); extras.push(value); return value; } };
}

test("PostgreSQL: batch commits atomically and preserves per-block before-images inside the batch", { skip: !url }, async t => {
  const { store } = await fixture(t, { reorgWindow: 4 });
  let escaped;
  const seen = [];
  await store.applyBatch([0, 1, 2, 3].map(height => block(height)), async (b, entities) => {
    escaped = entities;
    const previous = await entities.get("Account", "a");
    seen.push(previous?.balance ?? 0n);
    await entities.set("Account", account("a", (previous?.balance ?? 0n) + BigInt(b.height + 1)));
    if (b.height === 1) await entities.set("Account", account("temporary", 20n));
    if (b.height === 2) await entities.delete("Account", "temporary");
  });
  assert.deepEqual(seen, [0n, 1n, 3n, 6n]);
  assert.equal((await store.checkpoint()).height, 3);
  assert.equal((await store.read(v => v.get("Account", "a"))).balance, "10");
  await assert.rejects(escaped.get("Account", "a"), /no longer active/);
  await store.markReconciling(); await store.rollback(1, h(2)); await store.markReady();
  assert.equal((await store.read(v => v.get("Account", "a"))).balance, "3");
  assert.equal((await store.read(v => v.get("Account", "temporary"))).balance, "20");
  await store.markReconciling(); await store.rollback(-1, h(0)); await store.markReady();
  assert.equal((await store.checkpoint()).height, null);
  assert.equal(await store.read(v => v.get("Account", "a")), null);
});

test("PostgreSQL: failure/caught error in a later batch block preserves the preceding commit and journal", { skip: !url }, async t => {
  const { store } = await fixture(t);
  await store.apply(block(0), e => e.set("Account", account("a", 5n)));
  for (const caught of [false, true]) {
    await assert.rejects(store.applyBatch([block(1), block(2)], async (b, e) => {
      await e.set("Account", account("a", 100n));
      if (b.height === 2) {
        if (caught) await e.set("Missing", account("b")).catch(() => {});
        else throw new Error("batch handler failed");
      }
    }), caught ? /Unknown entity/ : /batch handler failed/);
    assert.equal((await store.checkpoint()).height, 0);
    assert.equal((await store.read(v => v.get("Account", "a"))).balance, "5");
    assert.equal(await store.blockHash(1), null);
  }
  await store.applyBatch([block(1), block(2)], async (_b, e) => {
    const previous = await e.get("Account", "a");
    await e.set("Account", account("a", previous.balance + 1n));
  });
  assert.equal((await store.read(v => v.get("Account", "a"))).balance, "7");
  await store.markReconciling(); await store.rollback(0, h(1)); await store.markReady();
  assert.equal((await store.read(v => v.get("Account", "a"))).balance, "5");
});

test("PostgreSQL: long empty batches retain a bounded exact undo window and stable snapshots", { skip: !url }, async t => {
  const { store, options } = await fixture(t);
  await store.apply(block(0), e => e.set("Account", account("a", 1n)));
  let release, started;
  const wait = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { started = resolve; });
  const work = store.applyBatch(Array.from({ length: 100 }, (_, i) => block(i + 1)), async (b, e) => {
    if (b.height === 1) { await e.set("Account", account("a", 2n)); started(); await wait; }
  });
  await entered;
  try {
    const before = await store.read(async v => [v.checkpoint.height, (await v.get("Account", "a")).balance]);
    assert.deepEqual(before, [0, "1"]);
  } finally { release(); }
  await work;
  assert.equal((await store.checkpoint()).height, 100);
  assert.equal(await store.blockHash(96), null);
  assert.equal(await store.blockHash(97), h(98));
  const inspect = new pg.Client({ connectionString: url }); await inspect.connect();
  try {
    assert.equal((await inspect.query(`SELECT count(*)::int AS n FROM "chef_${options.project}".blocks`)).rows[0].n, 4);
    assert.equal((await inspect.query(`SELECT count(*)::int AS n FROM "chef_${options.project}".undo`)).rows[0].n, 0);
  } finally { await inspect.end(); }
  await store.markReconciling();
  await assert.rejects(store.rollback(96, h(97)), /outside retained window/);
  await store.rollback(97, h(98)); await store.markReady();
  assert.equal((await store.read(v => v.get("Account", "a"))).balance, "2");
  await assert.rejects(store.applyBatch([block(98), block(100)], async () => {}), /Non-contiguous batch/);
  await assert.rejects(store.applyBatch([], async () => {}), /1..100/);
});

test("PostgreSQL: rollback does not resurrect pruned undo, including the genesis anchor after restart", { skip: !url }, async t => {
  const { store, extra } = await fixture(t);
  await store.applyBatch([0, 1, 2, 3].map(height => block(height)), async (b, e) => {
    await e.set("Account", account("a", BigInt(b.height + 1)));
  });
  assert.equal((await store.checkpoint()).undoFloor, 0);
  await store.markReconciling(); await store.rollback(1, h(2)); await store.markReady();
  await store.release();
  const restarted = extra({}); await restarted.acquire();
  await restarted.markReconciling();
  await assert.rejects(restarted.rollback(-1, h(0)), /outside retained window/);
  assert.equal((await restarted.checkpoint()).height, 1);
  await restarted.rollback(0, h(1)); await restarted.markReady();
  assert.equal((await restarted.read(v => v.get("Account", "a"))).balance, "1");
});

test("PostgreSQL: legacy undo-floor migration preserves data and refuses unproven anchor rollback", { skip: !url }, async t => {
  const { store, options } = await fixture(t);
  await store.applyBatch([0, 1, 2, 3].map(height => block(height)), async (b, e) => {
    await e.set("Account", account("a", BigInt(b.height + 1)));
  });
  await store.markReconciling(); await store.rollback(1, h(2)); await store.markReady();
  const inspect = new pg.Client({ connectionString: url }); await inspect.connect();
  try { await inspect.query(`ALTER TABLE "chef_${options.project}".state DROP COLUMN undo_floor`); }
  finally { await inspect.end(); }
  await assert.rejects(store.checkpoint(), /state migration required/);
  await store.migrate();
  assert.equal((await store.checkpoint()).undoFloor, 0);
  assert.equal((await store.read(v => v.get("Account", "a"))).balance, "2");
  await store.markReconciling();
  await assert.rejects(store.rollback(-1, h(0)), /outside retained window/);
});

test("PostgreSQL: explicit opt-in indexes are partial, idempotent and identity-bound", { skip: !url }, async t => {
  const indexed = parseModel("type Account { id: ID! balance: BigInt! @index count: Int @index active: Boolean @index owner: ID @index }");
  const { store, options, extra } = await fixture(t, { model: indexed });
  const inspect = new pg.Client({ connectionString: url }); await inspect.connect();
  t.after(() => inspect.end());
  const readIndexes = async () => (await inspect.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=$1 AND tablename='entities' ORDER BY indexname", [`chef_${options.project}`])).rows;
  const first = await readIndexes();
  assert.equal(first.length, 5); // Primary key plus four explicitly declared field indexes.
  for (const { name, entity, field } of queryIndexes(indexed)) {
    const definition = first.find(row => row.indexname === name)?.indexdef;
    assert.ok(definition, `Missing declared index ${name}`);
    assert.match(definition, /USING btree/);
    assert.ok(definition.includes(`data -> '${field}'::text`), definition);
    assert.ok(definition.includes(`WHERE (entity = '${entity}'::text)`), definition);
    assert.match(definition, /, id\) WHERE/);
  }
  await store.migrate();
  assert.deepEqual(await readIndexes(), first);
  const plain = parseModel("type Account { id: ID! balance: BigInt! count: Int active: Boolean owner: ID }");
  const changed = extra({ model: plain });
  await assert.rejects(changed.migrate(), /identity mismatch/);
  await assert.rejects(changed.checkpoint(), /identity mismatch/);
  assert.deepEqual(await readIndexes(), first);
  const unindexed = await fixture(t, { model: plain });
  await assert.rejects(unindexed.extra({ model: indexed }).migrate(), /identity mismatch/);
  const ordinary = (await inspect.query("SELECT count(*)::int AS count FROM pg_indexes WHERE schemaname=$1 AND tablename='entities'", [`chef_${unindexed.options.project}`])).rows[0].count;
  assert.equal(ordinary, 1, "Unannotated models must not gain default field indexes");
});

test("PostgreSQL: legacy state requires additive migration and keeps unknown reconciliation closed", { skip: !url }, async t => {
  const { store, options } = await fixture(t);
  await store.markReconciling("reorg");
  const inspect = new pg.Client({ connectionString: url }); await inspect.connect();
  t.after(() => inspect.end());
  await inspect.query(`ALTER TABLE "chef_${options.project}".state DROP COLUMN reconcile_kind`);
  await assert.rejects(store.checkpoint(), /state migration required/);
  await store.migrate();
  assert.equal((await store.checkpoint()).reconcileKind, "unknown");
  await store.markReconciling("source");
  assert.equal((await store.checkpoint()).reconcileKind, "unknown");
  await assert.rejects(store.read(async () => null), /reconciling/);
});

test("PostgreSQL: indexed exact/null scalar filters and ID pages track updates, failure and rollback", { skip: !url }, async t => {
  const indexed = parseModel("type Account { id: ID! balance: BigInt! @index count: Int @index active: Boolean @index owner: ID @index }");
  const { store } = await fixture(t, { model: indexed });
  const exact = 9007199254740993123456789n;
  const a = { id: "a", balance: exact, count: 7, active: false, owner: "owner" };
  const b = { id: "b", balance: exact, count: 7, active: false, owner: null };
  const c = { id: "c", balance: exact + 1n, count: null, active: null, owner: null };
  await store.apply(block(0), async entities => { for (const row of [a, b, c]) await entities.set("Account", row); });
  const ids = where => store.read(async view => (await view.list("Account", { first: 10, where })).map(row => row.id));
  assert.deepEqual(await ids({ balance: exact }), ["a", "b"]);
  assert.deepEqual(await ids({ balance: exact.toString() }), ["a", "b"]);
  assert.deepEqual(await ids({ count: null }), ["c"]);
  assert.deepEqual(await ids({ active: false }), ["a", "b"]);
  assert.deepEqual(await ids({ active: null }), ["c"]);
  assert.deepEqual(await ids({ owner: null }), ["b", "c"]);
  assert.deepEqual(await ids({ owner: "owner" }), ["a"]);
  assert.deepEqual(await ids({ balance: exact, count: 7, active: false }), ["a", "b"]);
  const initial = await store.read(view => view.list("Account", { first: 10 }));
  assert.equal(initial[0].balance, exact.toString());
  const first = await store.read(view => view.list("Account", { first: 1, where: { count: 7 } }));
  const second = await store.read(view => view.list("Account", { first: 1, after: first[0].id, where: { count: 7 } }));
  assert.deepEqual(first.map(row => row.id), ["a"]); assert.deepEqual(second.map(row => row.id), ["b"]);
  await assert.rejects(store.apply(block(1), async entities => {
    await entities.set("Account", { ...a, count: 99, balance: exact + 2n });
    await entities.delete("Account", "b");
    throw new Error("indexed block failed");
  }), /indexed block failed/);
  assert.deepEqual(await store.read(view => view.list("Account", { first: 10 })), initial);
  await store.apply(block(1), async entities => {
    await entities.set("Account", { ...a, count: 8, active: true, owner: null });
    await entities.delete("Account", "b");
    await entities.set("Account", { id: "d", balance: exact, count: 8, active: true, owner: "next" });
  });
  assert.deepEqual(await ids({ count: 7 }), []);
  assert.deepEqual(await ids({ count: 8 }), ["a", "d"]);
  assert.deepEqual(await ids({ active: false }), []);
  assert.deepEqual(await ids({ owner: "owner" }), []);
  await store.markReconciling();
  await assert.rejects(store.read(view => view.list("Account", { first: 10, where: { count: 8 } })), /reconciling/);
  await store.rollback(0, h(1)); await store.markReady();
  assert.deepEqual(await store.read(view => view.list("Account", { first: 10 })), initial);
  assert.deepEqual(await ids({ count: 7 }), ["a", "b"]);
  assert.deepEqual(await ids({ count: 8 }), []);
  assert.deepEqual(await ids({ balance: exact }), ["a", "b"]);
});

test("PostgreSQL: atomic block failure, exact BigInt, restart and retained duplicate", { skip: !url }, async t => {
  const { store, extra } = await fixture(t);
  let context;
  const exact = 9007199254740993123456789n;
  await assert.rejects(store.apply(block(0), async entities => {
    await entities.set("Account", account("alice", exact));
    throw new Error("handler failed");
  }), /handler failed/);
  assert.equal((await store.checkpoint()).height, null);
  assert.equal(await store.read(view => view.get("Account", "alice")), null);
  await store.apply(block(0), async entities => {
    context = entities;
    await entities.set("Account", account("alice", exact));
    assert.equal((await entities.get("Account", "alice")).balance, exact);
  });
  assert.equal((await store.read(view => view.get("Account", "alice"))).balance, exact.toString());
  await assert.rejects(context.set("Account", account("late")), /no longer active/);
  await store.apply(block(0), async () => { assert.fail("Duplicate must not call handler"); });
  await assert.rejects(store.apply(block(0, h(999)), async () => {}), /conflicts/);
  await assert.rejects(store.apply(block(2), async () => {}), /Non-contiguous/);
  await assert.rejects(store.apply(block(1, h(2), h(999)), async () => {}), /parent/);
  await store.release();
  const restarted = extra({});
  await restarted.migrate();
  await restarted.acquire();
  assert.equal((await restarted.checkpoint()).height, 0);
  await restarted.apply(block(1), async entities => {
    const value = await entities.get("Account", "alice");
    await entities.set("Account", { ...value, balance: value.balance + 1n });
  });
  assert.equal((await restarted.read(view => view.get("Account", "alice"))).balance, (exact + 1n).toString());
});

test("PostgreSQL: first before-image, delete undo, reconciling gate and genesis anchor", { skip: !url }, async t => {
  const { store } = await fixture(t);
  await store.apply(block(0), async entities => {
    await entities.set("Account", account("alice", 5n));
    await entities.set("Account", account("delete-me", 7n));
  });
  await store.apply(block(1), async entities => {
    await entities.set("Account", account("alice", 6n));
    await entities.set("Account", account("alice", 8n));
    await entities.delete("Account", "alice");
    await entities.set("Account", account("alice", 10n));
    await entities.delete("Account", "delete-me");
    await entities.set("Account", account("new", 9n));
  });
  await store.markReconciling();
  await assert.rejects(store.read(view => view.list("Account", { first: 10 })), /reconciling/);
  await store.rollback(0, h(1));
  assert.equal((await store.checkpoint()).status, "reconciling");
  // Replacement blocks may be applied behind the durable read gate.
  await store.apply(block(1, h(200), h(1)), async entities => {
    assert.equal((await entities.get("Account", "alice")).balance, 5n);
    assert.equal((await entities.get("Account", "delete-me")).balance, 7n);
    assert.equal(await entities.get("Account", "new"), null);
  });
  await assert.rejects(store.read(view => view.get("Account", "alice")), /reconciling/);
  await store.rollback(-1, h(0));
  assert.equal((await store.checkpoint()).height, null);
  assert.equal((await store.checkpoint()).anchorHash, h(0));
  await store.apply(block(0), async entities => { assert.equal(await entities.get("Account", "alice"), null); });
  await store.markReady();
  assert.deepEqual(await store.read(view => view.list("Account", { first: 10 })), []);
});

test("PostgreSQL: bounded undo retains ancestor boundary and rejects deep rollback", { skip: !url }, async t => {
  const { store } = await fixture(t, { startHeight: 10, reorgWindow: 2 });
  for (let height = 10; height <= 14; height++) await store.apply(block(height), async entities => entities.set("Account", account("counter", BigInt(height))));
  assert.equal(await store.blockHash(12), h(13));
  assert.equal(await store.blockHash(11), null);
  await store.markReconciling();
  await assert.rejects(store.rollback(11, h(12)), /outside retained/);
  await assert.rejects(store.rollback(12, h(999)), /hash mismatch/);
  assert.equal((await store.checkpoint()).height, 14);
  await store.rollback(12, h(13));
  await store.markReady();
  assert.equal((await store.read(view => view.get("Account", "counter"))).balance, "12");
  await store.markBlocked();
  await assert.rejects(store.read(view => view.get("Account", "counter")), /blocked/);
  await assert.rejects(store.apply(block(13), async () => {}), /blocked/);
});

test("PostgreSQL: single writer, identity mismatch and independent projects", { skip: !url }, async t => {
  const { store, extra } = await fixture(t);
  const second = extra({});
  await assert.rejects(second.acquire(), /active writer/);
  // API processes can verify an existing namespace while a writer owns it.
  await second.migrate();
  const bad = extra({ fingerprint: "different-handler" });
  await assert.rejects(bad.read(view => view.list("Account", { first: 1 })), /identity mismatch/);
  await store.release();
  await assert.rejects(bad.migrate(), /identity mismatch/);
  await second.acquire();
  const independent = await fixture(t);
  await second.apply(block(0), async entities => entities.set("Account", account("shared-id", 1n)));
  await independent.store.apply(block(0), async entities => entities.set("Account", account("shared-id", 99n)));
  assert.equal((await second.read(view => view.get("Account", "shared-id"))).balance, "1");
  assert.equal((await independent.store.read(view => view.get("Account", "shared-id"))).balance, "99");
});

test("PostgreSQL: snapshot reads, ordered pagination and parameterized equality filters", { skip: !url }, async t => {
  const { store } = await fixture(t);
  await store.apply(block(0), async entities => {
    await entities.set("Account", account("B", 1n, "x' OR TRUE --"));
    await entities.set("Account", account("a", 2n));
    await entities.set("Account", account("z", 2n));
  });
  let oldView;
  await store.read(async view => {
    oldView = view;
    assert.equal(view.checkpoint.height, 0);
    assert.equal((await view.get("Account", "a")).balance, "2");
    await store.apply(block(1), async entities => entities.set("Account", account("a", 3n)));
    assert.equal((await view.get("Account", "a")).balance, "2");
  });
  await assert.rejects(oldView.get("Account", "a"), /no longer active/);
  const ids = options => store.read(async view => (await view.list("Account", options)).map(row => row.id));
  assert.deepEqual(await ids({ first: 2 }), ["B", "a"]);
  assert.deepEqual(await ids({ first: 2, after: "a" }), ["z"]);
  assert.deepEqual(await ids({ first: 10, where: { label: "x' OR TRUE --" } }), ["B"]);
  assert.deepEqual(await ids({ first: 10, where: { balance: 2n } }), ["z"]);
  assert.deepEqual(await ids({ first: 10, where: { label: null } }), ["a", "z"]);
  await assert.rejects(ids({ first: 102 }), /first/);
  await assert.rejects(ids({ first: 1, where: { "id') OR TRUE --": "a" } }), /Unknown filter/);
  await assert.rejects(store.read(view => view.get("unknown", "id")), /Unknown entity/);
});

test("PostgreSQL: discarded entity promises still finish or roll back the whole block", { skip: !url }, async t => {
  const { store } = await fixture(t);
  await store.apply(block(0), async entities => { void entities.set("Account", account("a", 1n)); });
  assert.equal((await store.read(view => view.get("Account", "a"))).balance, "1");
  await assert.rejects(store.apply(block(1), async entities => {
    void entities.set("Account", account("a", 2n));
    void entities.set("Account", { id: "invalid" });
  }), /Missing|required|Invalid/);
  assert.equal((await store.checkpoint()).height, 0);
  assert.equal((await store.read(view => view.get("Account", "a"))).balance, "1");
});

test("PostgreSQL: undo pagination restores more than one hundred before-images", { skip: !url }, async t => {
  const { store } = await fixture(t);
  const ids = Array.from({ length: 205 }, (_, index) => `account-${String(index).padStart(3, "0")}`);
  await store.apply(block(0), async entities => {
    for (const id of ids) await entities.set("Account", account(id, 1n));
  });
  await store.apply(block(1), async entities => {
    for (const id of ids) await entities.set("Account", account(id, 2n));
  });
  await store.markReconciling();
  await store.rollback(0, h(1));
  await store.markReady();
  const restored = [];
  let after;
  while (true) {
    const page = await store.read(view => view.list("Account", { first: 101, after }));
    restored.push(...page);
    if (page.length < 101) break;
    after = page.at(-1).id;
  }
  assert.deepEqual(restored.map(row => row.id), ids);
  assert.ok(restored.every(row => row.balance === "1"));
});

test("PostgreSQL: existing unmarked namespace is refused without touching its tables", { skip: !url }, async t => {
  const project = `t_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const store = new PostgresStore(url, { project, fingerprint: "v1", startHeight: 0, network: "regtest", reorgWindow: 2, model });
  t.after(async () => { await store.close(); await client.query(`DROP SCHEMA "chef_${project}" CASCADE`); await client.end(); });
  await client.query(`CREATE SCHEMA "chef_${project}"`);
  await client.query(`CREATE TABLE "chef_${project}".user_data (id integer)`);
  await client.query(`INSERT INTO "chef_${project}".user_data VALUES(42)`);
  await assert.rejects(store.migrate(), /unmarked/);
  assert.equal((await client.query(`SELECT id FROM "chef_${project}".user_data`)).rows[0].id, 42);
});

test("PostgreSQL: ordered concurrent calls snapshot inputs and return independent copies", { skip: !url }, async t => {
  const { store } = await fixture(t);
  await store.apply(block(0), async entities => {
    const input = account("ordered", 5n, "original");
    const first = entities.set("Account", input);
    input.balance = 999n; input.label = "caller changed";
    const beforeDelete = entities.get("Account", "ordered");
    const deleted = entities.delete("Account", "ordered");
    const afterDelete = entities.get("Account", "ordered");
    const final = entities.set("Account", account("ordered", 7n));
    const [_, original, __, absent] = await Promise.all([first, beforeDelete, deleted, afterDelete, final]);
    assert.equal(original.balance, 5n); assert.equal(original.label, "original"); assert.equal(absent, null);
    original.balance = 1000n;
    const copy = await entities.get("Account", "ordered"); copy.balance = 2000n;
    assert.equal((await entities.get("Account", "ordered")).balance, 7n);
  });
  assert.equal((await store.read(view => view.get("Account", "ordered"))).balance, "7");
});

test("PostgreSQL: caught failures poison staged writes and the block checkpoint", { skip: !url }, async t => {
  const { store } = await fixture(t);
  await store.apply(block(0), async entities => entities.set("Account", account("before", 1n)));
  await assert.rejects(store.apply(block(1), async entities => {
    await entities.set("Account", account("before", 9n));
    await entities.set("Account", { id: "bad" }).catch(() => {});
    await entities.set("Account", account("after", 3n));
  }), /Missing|required|Invalid/);
  assert.equal((await store.checkpoint()).height, 0);
  assert.equal((await store.read(view => view.get("Account", "before"))).balance, "1");
  assert.equal(await store.read(view => view.get("Account", "after")), null);
});

test("PostgreSQL: undefined/null thrown reasons poison the block and preserve the first reason", { skip: !url }, async t => {
  const { store } = await fixture(t);
  await store.apply(block(0), async entities => entities.set("Account", account("before", 1n)));
  for (const firstReason of [undefined, null]) {
    const outcome = await store.apply(block(1), async entities => {
      await entities.set("Account", account("before", 9n));
      const invalid = account("getter");
      Object.defineProperty(invalid, "balance", { enumerable: true, get() { throw firstReason; } });
      await entities.set("Account", invalid).catch(() => {});
      const discarded = account("second-getter");
      Object.defineProperty(discarded, "balance", { enumerable: true, get() { throw firstReason === null ? undefined : new Error("second reason"); } });
      void entities.set("Account", discarded);
      await entities.set("Account", account("after", 3n));
    }).then(() => ({ rejected: false }), reason => ({ rejected: true, reason }));
    assert.equal(outcome.rejected, true);
    assert.equal(outcome.reason, firstReason);
    assert.equal((await store.checkpoint()).height, 0);
    assert.equal((await store.read(view => view.get("Account", "before"))).balance, "1");
    assert.equal(await store.read(view => view.get("Account", "after")), null);
  }
});

test("PostgreSQL: a database flush failure rolls back entities, undo and checkpoint", { skip: !url }, async t => {
  const { store, options } = await fixture(t);
  await store.apply(block(0), async entities => entities.set("Account", account("before", 1n)));
  const client = new pg.Client({ connectionString: url }); await client.connect();
  t.after(() => client.end());
  const sql = `"chef_${options.project}"`;
  await client.query(`CREATE FUNCTION ${sql}.reject_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = 'boom' THEN RAISE EXCEPTION 'fixture flush rejection'; END IF; RETURN NEW; END $$`);
  await client.query(`CREATE TRIGGER reject_fixture BEFORE INSERT OR UPDATE ON ${sql}.entities FOR EACH ROW EXECUTE FUNCTION ${sql}.reject_fixture()`);
  await assert.rejects(store.apply(block(1), async entities => {
    await entities.set("Account", account("before", 9n));
    await entities.set("Account", account("boom", 2n));
  }), /fixture flush rejection/);
  assert.equal((await store.checkpoint()).height, 0);
  assert.equal((await store.read(view => view.get("Account", "before"))).balance, "1");
  assert.equal(await store.read(view => view.get("Account", "boom")), null);
  assert.equal((await client.query(`SELECT count(*)::int AS n FROM ${sql}.undo WHERE height=1`)).rows[0].n, 0);
});

for (const rejectedStage of ["checkpoint", "pruning"]) test(`PostgreSQL: ${rejectedStage} failure restores entities, journal and retained boundary`, { skip: !url }, async t => {
  const { store, options } = await fixture(t);
  for (let height = 0; height <= 3; height++) await store.apply(block(height), async entities => entities.set("Account", account("stable", BigInt(height))));
  const client = new pg.Client({ connectionString: url }); await client.connect();
  t.after(() => client.end());
  const sql = `"chef_${options.project}"`;
  const snapshot = async () => ({
    state: (await client.query(`SELECT * FROM ${sql}.state`)).rows,
    entities: (await client.query(`SELECT * FROM ${sql}.entities ORDER BY entity,id`)).rows,
    blocks: (await client.query(`SELECT * FROM ${sql}.blocks ORDER BY height`)).rows,
    undo: (await client.query(`SELECT * FROM ${sql}.undo ORDER BY height,entity,id`)).rows,
  });
  const before = await snapshot();
  const table = rejectedStage === "checkpoint" ? "state" : "undo";
  const operation = rejectedStage === "checkpoint" ? "UPDATE" : "DELETE";
  const condition = rejectedStage === "checkpoint" ? "NEW.height = 4" : "OLD.height = 1";
  const returned = rejectedStage === "checkpoint" ? "NEW" : "OLD";
  await client.query(`CREATE FUNCTION ${sql}.reject_bookkeeping() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'fixture bookkeeping rejection'; END IF; RETURN ${returned}; END $$`);
  await client.query(`CREATE TRIGGER reject_bookkeeping BEFORE ${operation} ON ${sql}.${table} FOR EACH ROW EXECUTE FUNCTION ${sql}.reject_bookkeeping()`);
  const mutate = async entities => {
    await entities.set("Account", account("stable", 4n));
    await entities.set("Account", account("new", 99n));
  };
  await assert.rejects(store.apply(block(4), mutate), /fixture bookkeeping rejection/);
  assert.deepEqual(await snapshot(), before);
  await client.query(`DROP TRIGGER reject_bookkeeping ON ${sql}.${table}`);
  await store.apply(block(4), mutate);
  assert.equal((await store.checkpoint()).height, 4);
  assert.deepEqual((await client.query(`SELECT height FROM ${sql}.blocks ORDER BY height`)).rows.map(row => Number(row.height)), [1, 2, 3, 4]);
  assert.deepEqual((await client.query(`SELECT DISTINCT height FROM ${sql}.undo ORDER BY height`)).rows.map(row => Number(row.height)), [2, 3, 4]);
  await store.markReconciling(); await store.rollback(1, block(1).hash); await store.markReady();
  assert.equal((await store.checkpoint()).height, 1);
  assert.equal((await store.read(view => view.get("Account", "stable"))).balance, "1");
  assert.equal(await store.read(view => view.get("Account", "new")), null);
});

test("PostgreSQL: cache bytes and entries are bounded and reject the whole block", { skip: !url }, async t => {
  const { store } = await fixture(t);
  await assert.rejects(store.apply(block(0), async entities => {
    for (let index = 0; index < 1100; index++) await entities.set("Account", account(`bytes-${index}`, 1n, "x".repeat(16384)));
  }), /cache limit/);
  assert.equal((await store.checkpoint()).height, null);
  await assert.rejects(store.apply(block(0), async entities => {
    for (let index = 0; index < 10000; index++) await entities.set("Account", account(`entry-${index}`));
    await entities.get("Account", "one-too-many");
  }), /cache limit/);
  assert.equal((await store.checkpoint()).height, null);
  assert.deepEqual(await store.read(view => view.list("Account", { first: 101 })), []);
});

test("PostgreSQL: coalescing does not bypass mutation-call limits or queued payload limits", { skip: !url }, async t => {
  const { store } = await fixture(t);
  await assert.rejects(store.apply(block(0), async entities => {
    for (let index = 0; index <= 10000; index++) await entities.set("Account", account("one-key", BigInt(index)));
  }), /mutation limit/);
  await assert.rejects(store.apply(block(0), async entities => {
    for (let index = 0; index < 1100; index++) void entities.set("Account", account("one-key", 1n, "x".repeat(16384)));
  }), /cache limit/);
  assert.equal((await store.checkpoint()).height, null);
  assert.equal(await store.read(view => view.get("Account", "one-key")), null);
});

test("PostgreSQL: multi-chunk writes/deletes retain each original before-image", { skip: !url }, async t => {
  const { store } = await fixture(t);
  const ids = Array.from({ length: 1005 }, (_, index) => `chunk-${String(index).padStart(4, "0")}`);
  await store.apply(block(0), async entities => {
    for (const id of ids) await entities.set("Account", account(id, 1n));
  });
  await store.apply(block(1), async entities => {
    for (const [index, id] of ids.entries()) {
      await entities.set("Account", account(id, 2n));
      if (index % 2) await entities.delete("Account", id);
      else await entities.set("Account", account(id, 3n));
    }
  });
  assert.equal(await store.read(view => view.get("Account", ids[501])), null);
  assert.equal((await store.read(view => view.get("Account", ids[502]))).balance, "3");
  await store.markReconciling(); await store.rollback(0, h(1)); await store.markReady();
  for (const id of [ids[0], ids[499], ids[500], ids[999], ids[1004]]) {
    assert.equal((await store.read(view => view.get("Account", id))).balance, "1");
  }
});
