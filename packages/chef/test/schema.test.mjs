import test from "node:test";
import assert from "node:assert/strict";
import { parseModel, encodeEntity, decodeEntity, generateTypes } from "../dist/schema.js";

const sdl = "type Payment { id: ID! amount: BigInt! height: Int! memo: String enabled: Boolean }";
test("schema fingerprints ignore formatting and declaration order", () => {
  const a = parseModel(sdl);
  const b = parseModel("type Payment { enabled: Boolean memo: String height: Int! amount: BigInt! id: ID! }");
  assert.equal(a.fingerprint, b.fingerprint);
  assert.notEqual(a.fingerprint, parseModel(sdl.replace("memo: String", "memo: String!")).fingerprint);
});

test("schema rejects unsupported constructs and unsafe/colliding names", () => {
  for (const schema of [
    "type A { id: String! }", "type A { id: ID }", "type A { id: ID! x: Float }",
    "type A { id: ID! x: [Int] }", "type A { id: ID! x(arg: Int): Int }",
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
