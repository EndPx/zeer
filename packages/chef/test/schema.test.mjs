import test from "node:test";
import assert from "node:assert/strict";
import { parseModel, encodeEntity, decodeEntity, generateTypes, queryIndexes } from "../dist/schema.js";
import { PostgresStore } from "../dist/store.js";

const sdl = "type Payment { id: ID! amount: BigInt! height: Int! memo: String enabled: Boolean }";
test("schema fingerprints ignore formatting and declaration order", () => {
  const a = parseModel(sdl);
  const b = parseModel("type Payment { enabled: Boolean memo: String height: Int! amount: BigInt! id: ID! }");
  assert.equal(a.fingerprint, b.fingerprint);
  assert.notEqual(a.fingerprint, parseModel(sdl.replace("memo: String", "memo: String!")).fingerprint);
});

test("opt-in index annotations preserve unindexed identities and generate deterministic descriptors", () => {
  const legacy = parseModel(sdl);
  assert.equal(legacy.fingerprint, "8997c3b3abc3ac3b98c8aceedd88b3554172b79bf07615fa895cc900b041a246");
  assert.deepEqual(queryIndexes(legacy), []);
  assert.equal(Object.hasOwn(legacy.entities.Payment.fields.amount, "indexed"), false);
  const indexed = parseModel("type Payment { id: ID! amount: BigInt! @index height: Int! @index owner: ID @index enabled: Boolean @index }");
  assert.notEqual(indexed.fingerprint, parseModel("type Payment { id: ID! amount: BigInt! height: Int! owner: ID enabled: Boolean }").fingerprint);
  assert.deepEqual(queryIndexes(indexed).map(item => item.field), ["amount", "enabled", "height", "owner"]);
  assert.deepEqual(queryIndexes(indexed), queryIndexes(parseModel("type Payment { enabled: Boolean @index owner: ID @index height: Int! @index amount: BigInt! @index id: ID! }")));
  for (const descriptor of queryIndexes(indexed)) assert.match(descriptor.name, /^chef_qi_[0-9a-f]{24}$/);
  assert.equal(queryIndexes(indexed)[0].name, "chef_qi_a4678d31117b332cf6fb1ede");
  const value = { id: "p", amount: "9007199254740993", height: 1, owner: null, enabled: false };
  assert.deepEqual({ ...encodeEntity(indexed, "Payment", value) }, value);
  assert.equal(decodeEntity(indexed, "Payment", value).amount, 9007199254740993n);
  assert.match(generateTypes(indexed), /amount: bigint;/);
});

test("index annotations reject unsupported scalars, primary IDs, arguments, duplicates and project overflow", () => {
  for (const schema of [
    "type A { id: ID! @index }", "type A { id: ID! memo: String @index }",
    "type A { id: ID! count: Int @index(foo:1) }", "type A { id: ID! count: Int @index @index }",
    "type A { id: ID! count: Int @index @other }", "type A @index { id: ID! }",
    "directive @index on FIELD_DEFINITION type A { id: ID! count: Int @index }",
  ]) assert.throws(() => parseModel(schema), undefined, schema);
  const entity = (name, count) => `type ${name} { id: ID! ${Array.from({ length: count }, (_, i) => `f${i}: Int @index`).join(" ")} }`;
  assert.equal(queryIndexes(parseModel(entity("A", 4) + entity("B", 4))).length, 8);
  assert.throws(() => parseModel(entity("A", 4) + entity("B", 5)), /at most 8/);
});

test("programmatic index models are validated before database access or SQL construction", () => {
  const original = parseModel("type A { id: ID! height: Int @index }");
  const cases = [
    value => { value.entities.A.fields.height.indexed = false; },
    value => { value.entities.A.fields.height.scalar = "String"; },
    value => { value.entities.A.fields.id.indexed = true; },
    value => { value.entities.A.name = "Other"; },
    value => { value.entities.A.fields.height.name = "Other"; },
    value => { value.entities["A'; SELECT 1"] = value.entities.A; delete value.entities.A; },
    value => { value.entities.A.fields["h'; SELECT 1"] = value.entities.A.fields.height; delete value.entities.A.fields.height; },
    value => { for (let i = 0; i < 8; i++) value.entities.A.fields[`extra${i}`] = { name: `extra${i}`, scalar: "Int", required: false, indexed: true }; },
  ];
  for (const alter of cases) {
    const model = structuredClone(original); alter(model);
    assert.throws(() => queryIndexes(model));
    assert.throws(() => new PostgresStore("postgresql://unused", { project: "index_unit", fingerprint: "test", model, startHeight: 1, reorgWindow: 3, network: "regtest" }));
  }
});

test("schema rejects unsupported constructs and unsafe/colliding names", () => {
  for (const schema of [
    "type A { id: String! }", "type A { id: ID }", "type A { id: ID! x: Float }",
    "type A { id: ID! x: [[Int]] }", "type A { id: ID! x(arg: Int): Int }",
    "type A { id: ID! x: String @foo }", "type A @foo { id: ID! }",
    "type A implements B { id: ID! }", "scalar X", "enum X { A }",
    "type __A { id: ID! }", "type A { id: ID! constructor: String }",
    "type A { id: ID! id: ID! }", "type A { id: ID! } type A { id: ID! }",
    "type A { id: ID! } type APage { id: ID! }", "type Query { id: ID! }",
    "type ChefEntities { id: ID! }",
  ]) assert.throws(() => parseModel(schema), undefined, schema);
  assert.throws(() => parseModel(Array.from({length: 21}, (_, i) => `type A${i} { id: ID! }`).join("\n")));
  assert.throws(() => parseModel(`type A { id: ID! ${Array.from({length: 32}, (_, i) => `f${i}: Int`).join(" ")} }`));
});

test("entity exact integers round trip without number conversion", () => {
  const model = parseModel(sdl);
  const amount = 123456789012345678901234567890n;
  const encoded = encodeEntity(model, "Payment", { id: "p", amount, height: 1 });
  assert.equal(encoded.amount, amount.toString());
  assert.equal(encoded.memo, null);
  assert.equal(decodeEntity(model, "Payment", encoded).amount, amount);
  assert.match(generateTypes(model), /amount: bigint;/);
  assert.match(generateTypes(model), /HandlerContext<ChefEntities>/);
  for (const bad of [1, 1.1, "01", "-0", "+1", "1e6", "1.0", "9".repeat(129)]) assert.throws(() => encodeEntity(model, "Payment", {id:"p",height:1,amount:bad}));
  assert.equal(encodeEntity(model, "Payment", {id:"p",height:1,amount:"9".repeat(128)}).amount.length, 128);
});

test("entity shape, field types and UTF-8 storage limits are enforced", () => {
  const model = parseModel(sdl);
  const valid = { id: "p", amount: "0", height: 1 };
  for (const overrides of [{ id: "" }, { id: "é".repeat(129) }, { memo: "é".repeat(8193) }, { memo: "bad\0" }, { height: 2147483648 }, { height: 1.1 }, { enabled: 1 }, { amount: null }, { extra: 1 }]) assert.throws(() => encodeEntity(model, "Payment", { ...valid, ...overrides }));
  assert.throws(() => encodeEntity(model, "constructor", valid));
  assert.throws(() => encodeEntity(model, "Payment", Object.create(valid)));
  const large = parseModel("type A { id: ID! a: String b: String c: String d: String }");
  assert.throws(() => encodeEntity(large, "A", {id:"a", a:"x".repeat(16384),b:"x".repeat(16384),c:"x".repeat(16384),d:"x".repeat(16384)}), /64 KiB/);
});
