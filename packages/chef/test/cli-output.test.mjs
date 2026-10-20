import test from "node:test";
import assert from "node:assert/strict";
import { PrepError, ReorgError } from "@zeer-dev/prep-client";
import { cliFailure, formatOutput, readStatus, sourceObservation } from "../dist/cli-output.js";

const checkpoint = { height: 10, hash: "a".repeat(64), anchorHash: "b".repeat(64), status: "ready" };
const meta = { network: "regtest", payload_kind: "full-v1", ready: true, archive_height: 12,
  indexed_height: 12, source_height: 15, lag_blocks: 3, source_observed_at: 100,
  epoch: "2", start_block: 1, source_mode: "follower" };

test("status reads the checkpoint before bounded Prep metadata and never needs a writer", async () => {
  const calls = [];
  const result = await readStatus({ network: "regtest", startHeight: 1,
    store: { checkpoint: async () => { calls.push("checkpoint"); return checkpoint; } },
    client: { getHeight: async options => { calls.push("height"); assert.equal(options.timeoutMs, 5000); return meta; } },
  });
  assert.deepEqual(calls, ["checkpoint", "height"]);
  assert.equal(result.state, "backfill");
  assert.equal(result.readGate, "ready");
  assert.equal(result.source.chefPrepLagBlocks, 2);
  assert.equal(result.source.prepSourceLagBlocks, 3);
  assert.equal(result.source.sourceHeight, 15);
  assert.equal(result.source.sourceObservedAt, 100);
});

test("status gives blocked precedence while reporting a separately unavailable Prep", async () => {
  const result = await readStatus({ network: "regtest", startHeight: 1,
    store: { checkpoint: async () => ({ ...checkpoint, status: "blocked" }) },
    client: { getHeight: async () => { throw new PrepError("TRANSPORT_ERROR"); } },
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.checkpoint.height, 10);
  assert.deepEqual(result.source, { availability: "unavailable", errorCode: "SOURCE_UNAVAILABLE" });
  assert.match(formatOutput({ command: "status", ...result }, true), /blocked[\s\S]*unavailable[\s\S]*source tip: unknown/);
});

test("source loss, historical snapshots and mismatched archives never invent a source tip", async () => {
  for (const change of [{ ready: false }, { source_mode: "historical_snapshot" }, { network: "mainnet" }, { source_mode: "unknown" }]) {
    const observed = sourceObservation({ ...meta, ...change }, checkpoint, "regtest", 1);
    assert.equal(observed.sourceHeight, null);
    assert.equal(observed.sourceObservedAt, null);
    assert.equal(observed.prepSourceLagBlocks, null);
    assert.equal(observed.freshness, "unknown");
  }
  const result = await readStatus({ network: "regtest", startHeight: 1,
    store: { checkpoint: async () => checkpoint }, client: { getHeight: async () => ({ ...meta, ready: false }) },
  });
  assert.equal(result.state, "source_not_ready");
  assert.equal(result.readGate, "ready"); // The diagnostic does not mutate persisted readiness.
  assert.equal(result.source.availability, "available");
  assert.equal(sourceObservation(meta, { ...checkpoint, height: null }, "regtest", 5).chefPrepLagBlocks, 8);
});

test("status does not mask database failure with a source diagnosis or mask caller cancellation", async () => {
  let requests = 0;
  const databaseError = new Error("database secret");
  await assert.rejects(readStatus({ network: "regtest", startHeight: 1,
    store: { checkpoint: async () => { throw databaseError; } }, client: { getHeight: async () => { requests++; return meta; } },
  }), error => error === databaseError);
  assert.equal(requests, 0);
  const abort = new AbortController();
  await assert.rejects(readStatus({ network: "regtest", startHeight: 1, signal: abort.signal,
    store: { checkpoint: async () => checkpoint }, client: { getHeight: async () => { abort.abort(); throw abort.signal.reason; } },
  }), { name: "AbortError" });
});

test("status does not call a checkpoint ahead of Prep caught up", async () => {
  const result = await readStatus({ network: "regtest", startHeight: 1,
    store: { checkpoint: async () => ({ ...checkpoint, height: 13 }) }, client: { getHeight: async () => meta },
  });
  assert.equal(result.state, "reconciliation_needed");
  assert.equal(result.source.checkpointAheadOfPrep, true);
  assert.equal(result.checkpoint.status, "ready");
  assert.match(formatOutput({ command: "status", ...result }, true), /ahead of Prep/);
});

test("human output labels durable progress and completed-page totals; JSON preserves fields", () => {
  const value = { command: "sync", state: "stopped", invocationMode: "backfill", checkpoint,
    metricsScope: "completed_pages", blocks: 0, transactions: 0 };
  assert.deepEqual(JSON.parse(formatOutput(value, false)), value);
  const human = formatOutput(value, true);
  assert.match(human, /Persisted checkpoint: 10; read gate: ready/);
  assert.match(human, /Invocation totals for completed pages: 0 blocks, 0 transactions/);
  assert.match(human, /checkpoint includes any committed partial page/);
});

test("error guidance is fixed and never echoes third-party messages or arbitrary Chef error codes", () => {
  const secret = "PRIVATE_PASSWORD_MUST_NOT_APPEAR";
  for (const error of [new Error(secret), new PrepError(secret, 401), { code: secret, message: secret }]) {
    assert.equal(JSON.stringify(cliFailure(error)).includes(secret), false);
  }
  assert.equal(JSON.stringify(cliFailure(new Error(secret), secret)).includes(secret), false);
  assert.equal(cliFailure(new PrepError(secret, 401)).error.code, "PREP_UNAUTHORIZED");
  assert.equal(cliFailure(new ReorgError()).error.code, "SOURCE_CHANGED_DURING_REPLAY");
  assert.equal(cliFailure({ code: "42P01", message: secret }).error.code, "MIGRATION_REQUIRED");
  assert.equal(cliFailure(new Error("Chef project identity mismatch; use a new project namespace")).error.code, "PROJECT_IDENTITY_MISMATCH");
  assert.match(cliFailure(null, "REBUILD_REQUIRED").help, /fresh project name/);
});
