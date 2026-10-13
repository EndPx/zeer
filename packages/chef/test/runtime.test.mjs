import assert from "node:assert/strict";
import test from "node:test";
import { ReorgError } from "@zeer/prep-client";
import { decodePage, syncStep, toZatoshis } from "../dist/runtime.js";

const h = n => BigInt(n).toString(16).padStart(64, "0");
const page = () => ({ from_block: 1, next_block: 3, network: "regtest", epoch: "1", data: {
  blocks: [1, 2].map(height => ({ height, hash: h(height), previous_hash: h(height - 1), time: 1000 })),
  transactions: [1, 2].map(block_height => ({ block_height, index: 0, txid: h(100 + block_height), version: 5, locktime: 0, decoded: { amount: "1" } })),
} });

test("runtime validates whole contiguous blocks and per-block transaction ordering", () => {
  assert.deepEqual(decodePage(page(), 1, 3).map(batch => [batch.block.height, batch.transactions.length]), [[1, 1], [2, 1]]);
  const brokenChain = page(); brokenChain.data.blocks[1].previous_hash = h(999);
  assert.throws(() => decodePage(brokenChain, 1, 3), /NONCONTIGUOUS_PREP_CHAIN/);
  const missing = page(); missing.data.transactions.pop();
  assert.throws(() => decodePage(missing, 1, 3), /MISSING_COINBASE_OR_TRANSACTIONS/);
  const badIndex = page(); badIndex.data.transactions[1].index = 1;
  assert.throws(() => decodePage(badIndex, 1, 3), /INVALID_PREP_TRANSACTION_ORDER/);
  const backwards = page(); backwards.data.transactions.reverse();
  assert.throws(() => decodePage(backwards, 1, 3), /INVALID_PREP_TRANSACTION/);
  const missingBlock = page(); missingBlock.data.blocks.pop();
  assert.throws(() => decodePage(missingBlock, 1, 3), /INCOMPLETE_PREP_BLOCKS/);
});

test("ZEC conversion preserves exact decimal/exponent values and rejects floating inputs or rounding", () => {
  for (const [value, expected] of [["1", 100000000n], ["0.00000001", 1n], ["1e-8", 1n], ["1.25e2", 12500000000n], ["-2.5E-7", -25n], ["0.0000000100", 1n], ["9007199254740993", 900719925474099300000000n]]) assert.equal(toZatoshis(value), expected);
  for (const value of [0.1, "NaN", "Infinity", "01", "1e101"]) assert.throws(() => toZatoshis(value), /INVALID_ZEC/);
  for (const value of ["0.000000001", "1e-9", "-0.000000011"]) assert.throws(() => toZatoshis(value), /FRACTIONAL_ZATOSHI/);
});

test("observed source outages, head regressions and header/page epoch races close the durable read gate", async () => {
  const meta = { network: "regtest", payload_kind: "full-v1", ready: true, archive_height: 2, epoch: "1", start_block: 1 };
  for (const scenario of ["unready", "head_regression", "height_error", "header_race", "page_race"]) {
    const checkpoint = { height: scenario === "page_race" ? null : 2, hash: h(2), anchorHash: null, status: "ready" };
    let gated = 0;
    const sourceError = new Error("source unavailable");
    const store = { checkpoint: async () => checkpoint, markReconciling: async () => { gated++; checkpoint.status = "reconciling"; } };
    const client = {
      getHeight: async () => { if (scenario === "height_error") throw sourceError; return { ...meta, ...(scenario === "unready" ? { ready: false } : {}), ...(scenario === "head_regression" ? { archive_height: 0 } : {}) }; },
      get: async () => ({ ...page(), epoch: "2" }),
    };
    const work = syncStep({ store, client, indexer: {}, network: "regtest", startHeight: 1, reorgWindow: 2 });
    if (scenario === "unready" || scenario === "head_regression") assert.equal((await work).state, "source_unavailable");
    else await assert.rejects(work, error => scenario === "height_error" ? error === sourceError : error instanceof ReorgError);
    assert.equal(checkpoint.status, "reconciling", scenario);
    assert.ok(gated >= 1, scenario);
  }
});
