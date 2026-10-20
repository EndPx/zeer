import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../dist/cli.js";
import { PrepError } from "@zeer-dev/prep-client";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const cli = join(root, "packages/chef/dist/cli.js");
const secret = "CLI_TEST_CREDENTIAL_MUST_NEVER_APPEAR";
const env = { ...process.env, PREP_URL: "", DATABASE_URL: "", PREP_API_TOKEN: secret, CHEF_API_TOKEN: secret };
function run(args, extraEnv = {}) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, env: { ...env, ...extraEnv }, encoding: "utf8", timeout: 15000 });
}
function errorCode(result, code) {
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stderr).error.code, code);
  assert.equal(result.stdout.includes(secret) || result.stderr.includes(secret), false);
}
async function fixture(t, config) {
  const parent = join(root, "tmp");
  await mkdir(parent, { recursive: true });
  const path = await mkdtemp(join(parent, "chef-cli-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  await writeFile(join(path, "package.json"), '{"type":"module"}');
  await writeFile(join(path, "chef.config.ts"), config ?? 'export default { project: "cli_test", network: "mainnet", startHeight: 1, schema: "schema.graphql", handlerVersion: "1", indexer: { block() {} } };');
  await writeFile(join(path, "schema.graphql"), "type Payment { id: ID! amount: BigInt! height: Int! }");
  return { path, config: join(path, "chef.config.ts") };
}

test("CLI help succeeds without config, source or database", () => {
  for (const args of [[], ["--help"], ["help"]]) {
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /codegen\|migrate\|sync\|serve\|status/);
    assert.equal(result.stdout.includes(secret), false);
  }
});

test("CLI receipt projects require explicit testnet key identity and reject inline key/config fields", async t => {
  const base={project:'private_test',network:'testnet',startHeight:4200000,schema:'schema.graphql',handlerVersion:'1',shielded:{accountId:'inbox',keyFingerprint:'a'.repeat(64)}};
  const cases=[
    [{...base,network:'mainnet'},'INVALID_SHIELDED_CONFIG'],
    [{...base,shielded:undefined},'SHIELDED_CONFIG_AND_RECEIPT_HANDLER_REQUIRED'],
    [{...base,shielded:{...base.shielded,viewingKey:secret}},'INVALID_SHIELDED_CONFIG'],
    [{...base,shielded:{...base.shielded,keyFingerprint:'bad'}},'INVALID_SHIELDED_CONFIG'],
    [{...base,shielded:{...base.shielded,timeoutMs:0}},'INVALID_SHIELDED_CONFIG'],
    [{...base,shielded:{...base.shielded,keyFileEnv:'not-an-env-name'}},'INVALID_ENV_NAME'],
  ];
  for(const [config,code] of cases){
    const text=`export default {...${JSON.stringify(config)},indexer:{receipt(){}}};`;
    const f=await fixture(t,text);errorCode(run(['codegen','--config',f.config,'--json']),code);
  }
  const valid=await fixture(t,`export default {...${JSON.stringify(base)},indexer:{receipt(){}}};`);
  const result=run(['codegen','--config',valid.config,'--json']);assert.equal(result.status,0,result.stderr);
});

test("installed CLI runs help and codegen through a symlinked executable path", async t => {
  const { path, config } = await fixture(t);
  let entry;
  if (process.platform === "win32") {
    // Directory junctions need no symbolic-link privilege on Windows. They
    // reproduce argv[1] differing from the module's canonical executable path.
    const linkedDirectory = join(path, "installed-cli");
    await symlink(dirname(cli), linkedDirectory, "junction");
    entry = join(linkedDirectory, basename(cli));
  } else {
    await mkdir(join(path, "node_modules", ".bin"), { recursive: true });
    entry = join(path, "node_modules", ".bin", "zeer-chef");
    await symlink(cli, entry, "file");
  }
  const help = spawnSync(process.execPath, [entry, "--help"], { cwd: path, env, encoding: "utf8", timeout: 15000 });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /zeer-chef <codegen\|migrate\|sync\|serve\|status>/);
  const result = spawnSync(process.execPath, [entry, "codegen", "--config", config, "--json"], { cwd: path, env, encoding: "utf8", timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "complete");
  assert.match(await readFile(join(path, "chef.generated.ts"), "utf8"), /export interface Payment/);
});

test("CLI rejects invalid, duplicate, missing and conflicting flags before loading config", () => {
  const cases = [
    [["reset"], "UNKNOWN_COMMAND"],
    [["status", "--to", "10"], "INVALID_OR_DUPLICATE_FLAG"],
    [["serve", "--follow"], "INVALID_OR_DUPLICATE_FLAG"],
    [["sync", "--to", "10", "--to", "11"], "INVALID_OR_DUPLICATE_FLAG"],
    [["sync", "--config"], "MISSING_FLAG_VALUE"],
    [["sync", "--to", "--follow"], "MISSING_FLAG_VALUE"],
    [["sync", "--follow", "--to", "10"], "FOLLOW_AND_TO_ARE_EXCLUSIVE"],
    [["sync", "--poll-seconds", "0"], "INVALID_POLL_SECONDS"],
    [["sync", "--poll-seconds", "1e1"], "INVALID_POLL_SECONDS"],
    [["status", "--json", "--human"], "INVALID_OR_DUPLICATE_FLAG"],
  ];
  for (const [args, code] of cases) errorCode(run(args), code);
});

test("CLI explicit human and JSON output override terminal defaults and sanitize errors", async t => {
  const { config } = await fixture(t);
  const human = run(["codegen", "--config", config, "--human"]);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /Chef codegen: complete/);
  const json = run(["codegen", "--config", config, "--json"]);
  assert.equal(json.status, 0, json.stderr);
  assert.equal(JSON.parse(json.stdout).status, "complete");
  const invalid = run(["status", "--config", config, "--human"]);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Chef error: PREP_URL_AND_DATABASE_URL_REQUIRED/);
  assert.equal(invalid.stderr.includes(secret), false);
  const missing = run(["status", "--config", join(root, "tmp", "missing-chef-config.ts"), "--json"]);
  errorCode(missing, "CONFIG_FILE_UNREADABLE");
});

async function withCliEnvironment(t) {
  const previous = { PREP_URL: process.env.PREP_URL, DATABASE_URL: process.env.DATABASE_URL };
  process.env.PREP_URL = "http://127.0.0.1:39368";
  process.env.DATABASE_URL = "postgresql://unused-test-connection";
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}

test("status CLI observes without a writer, reports blocked precedence and uses readable TTY output", async t => {
  const { config } = await fixture(t); await withCliEnvironment(t);
  const checkpoint = { height: 10, hash: "a".repeat(64), anchorHash: "b".repeat(64), status: "blocked" };
  const events = [], lines = [];
  const store = { checkpoint: async () => { events.push("checkpoint"); return checkpoint; },
    acquire: async () => { assert.fail("status must not acquire a writer"); },
    markReconciling: async () => { assert.fail("status must not mutate readiness"); }, close: async () => { events.push("close"); } };
  const client = { getHeight: async ({ timeoutMs }) => { events.push("height"); assert.equal(timeoutMs, 5000); throw new PrepError("TRANSPORT_ERROR"); } };
  await assert.rejects(main(["status", "--config", config], { store, client, tty: true, write: text => lines.push(text) }), error => error.code === "REBUILD_REQUIRED");
  assert.match(lines.join(""), /Chef status: blocked[\s\S]*Persisted checkpoint: 10[\s\S]*Prep: unavailable/);
  assert.deepEqual(events, ["checkpoint", "height", "close"]);
  lines.length = 0;
  await assert.rejects(main(["status", "--config", config, "--json"], { store, client, tty: true, write: text => lines.push(text) }), error => error.code === "REBUILD_REQUIRED");
  assert.equal(JSON.parse(lines[0]).state, "blocked");
});

test("SIGTERM during finite sync metadata preflight emits stopped with durable checkpoint", async t => {
  const { config } = await fixture(t); await withCliEnvironment(t);
  const checkpoint = { height: 7, hash: "a".repeat(64), anchorHash: "b".repeat(64), status: "ready" };
  let closed = false, acquired = false;
  const store = { checkpoint: async () => ({ ...checkpoint }), acquire: async () => { acquired = true; },
    markReconciling: async () => { checkpoint.status = "reconciling"; }, close: async () => { closed = true; } };
  const lines = [];
  const client = { getHeight: async ({ signal }) => { process.emit("SIGTERM"); signal.throwIfAborted(); } };
  await main(["sync", "--config", config, "--json"], { store, client, write: text => lines.push(JSON.parse(text)) });
  assert.equal(acquired, true); assert.equal(closed, true);
  assert.equal(lines.at(-1).state, "stopped");
  assert.equal(lines.at(-1).checkpoint.height, 7);
  assert.equal(lines.at(-1).metricsScope, "completed_pages");
  assert.equal(lines.at(-1).blocks, 0);
});

test("status distinguishes reachable unready Prep from transport/auth failure with nonzero diagnostics", async t => {
  const { config } = await fixture(t); await withCliEnvironment(t);
  const checkpoint = { height: 1, hash: "a".repeat(64), anchorHash: "b".repeat(64), status: "ready" };
  const store = { checkpoint: async () => ({ ...checkpoint }), close: async () => {} };
  const lines = [];
  const meta = { network: "mainnet", payload_kind: "full-v1", ready: false, archive_height: 2, indexed_height: 2,
    source_mode: "follower", source_height: 999, source_observed_at: 100, lag_blocks: 997, epoch: "1", start_block: 1 };
  await assert.rejects(main(["status", "--config", config], { store,
    client: { getHeight: async () => meta }, tty: false, write: text => lines.push(JSON.parse(text)) }), error => error.code === "SOURCE_UNAVAILABLE");
  assert.equal(lines.at(-1).state, "source_not_ready");
  assert.equal(lines.at(-1).source.availability, "available");
  assert.equal(lines.at(-1).source.ready, false);
  assert.equal(lines.at(-1).source.sourceHeight, null);
  assert.equal(checkpoint.status, "ready");
  await assert.rejects(main(["status", "--config", config, "--json"], { store,
    client: { getHeight: async () => { throw new PrepError(secret, 401); } }, write: text => lines.push(JSON.parse(text)) }), error => error.code === "PREP_UNAUTHORIZED");
  assert.equal(lines.at(-1).state, "source_unavailable");
  assert.equal(lines.at(-1).source.errorCode, "PREP_UNAUTHORIZED");
  assert.equal(JSON.stringify(lines).includes(secret), false);
});

test("finite-sync unready source reports reachable Prep and the durable reconciliation gate", async t => {
  const { config } = await fixture(t); await withCliEnvironment(t);
  const checkpoint = { height: 1, hash: "a".repeat(64), anchorHash: "b".repeat(64), status: "ready" };
  const store = { checkpoint: async () => ({ ...checkpoint }), acquire: async () => {},
    markReconciling: async () => { checkpoint.status = "reconciling"; }, close: async () => {} };
  const lines = [];
  const client = { getHeight: async () => ({ network: "mainnet", payload_kind: "full-v1", ready: false,
    archive_height: 2, indexed_height: 2, start_block: 1, epoch: "1", source_mode: "follower", source_height: 9, source_observed_at: 100, lag_blocks: 7 }) };
  await assert.rejects(main(["sync", "--config", config, "--json"], { store, client, write: text => lines.push(JSON.parse(text)) }), error => error.code === "SOURCE_UNAVAILABLE");
  assert.equal(lines.at(-1).state, "source_unavailable");
  assert.equal(lines.at(-1).source.availability, "available");
  assert.equal(lines.at(-1).source.ready, false);
  assert.equal(lines.at(-1).source.sourceHeight, null);
  assert.equal(lines.at(-1).checkpoint.status, "reconciling");
});

test("interrupted partial page reports durable committed prefix separately from returned-page counters", async t => {
  const { config } = await fixture(t); await withCliEnvironment(t);
  const h = n => BigInt(n).toString(16).padStart(64, "0");
  const checkpoint = { height: null, hash: null, anchorHash: null, status: "ready" };
  let applications = 0;
  const store = { checkpoint: async () => ({ ...checkpoint }), acquire: async () => {},
    apply: async (block, handler) => {
      await handler({}); applications++;
      checkpoint.height = block.height; checkpoint.hash = block.hash; checkpoint.anchorHash ??= block.previousHash;
      process.emit("SIGTERM");
    }, close: async () => {} };
  const client = {
    getHeight: async () => ({ network: "mainnet", payload_kind: "full-v1", ready: true, archive_height: 2,
      indexed_height: 2, epoch: "1", start_block: 1, source_mode: "historical_snapshot", source_height: 2, source_observed_at: 100, lag_blocks: 0 }),
    get: async () => ({ network: "mainnet", epoch: "1", from_block: 1, next_block: 3, data: {
      blocks: [1, 2].map(height => ({ height, hash: h(height), previous_hash: h(height - 1), time: 1000 })),
      transactions: [],
    } }),
  };
  const lines = [];
  await main(["sync", "--config", config, "--to", "2", "--json"], { store, client, write: text => lines.push(JSON.parse(text)) });
  assert.equal(applications, 1);
  const stopped = lines.at(-1);
  assert.equal(stopped.state, "stopped");
  assert.equal(stopped.checkpoint.height, 1);
  assert.equal(stopped.blocks, 0); assert.equal(stopped.transactions, 0);
  assert.equal(stopped.metricsScope, "completed_pages");
  assert.equal(stopped.source.sourceHeight, null);
  assert.equal(stopped.source.chefPrepLagBlocks, 1);
});

test("CLI range and port validation precedes database access", async (t) => {
  const { config } = await fixture(t);
  for (const value of ["0", "01", "1.5", "-1", "4294967295"]) errorCode(run(["sync", "--config", config, "--to", value]), "INVALID_END_HEIGHT");
  for (const value of ["0", "65536", "3e4"]) errorCode(run(["serve", "--config", config, "--port", value]), "INVALID_PORT");
});

test("CLI validates sync options and supports metadata-only configs before database access", async t => {
  const base = { project: "cli_test", network: "testnet", startHeight: 0, schema: "schema.graphql", handlerVersion: "1" };
  for (const [sync, code] of [[{ batchSize: 101 }, "INVALID_BATCH_SIZE"], [{ pageSize: 1001 }, "INVALID_PAGE_SIZE"],
    [{ misspelled: 1 }, "INVALID_SYNC_OPTIONS"], [{ transactionFilter: { txids: ["bad"] } }, "INVALID_TRANSACTION_FILTER"]]) {
    const { config } = await fixture(t, `export default { ...${JSON.stringify({ ...base, sync })}, indexer: { transactionMetadata() {} } };`);
    errorCode(run(["codegen", "--config", config]), code);
  }
  const { config } = await fixture(t, `export default { ...${JSON.stringify({ ...base, sync: { pageSize: 1000, batchSize: 32, transactionFilter: { has_orchard: true } } })}, indexer: { transactionMetadata() {} } };`);
  const result = run(["codegen", "--config", config]);
  assert.equal(result.status, 0, result.stderr);
  const conflicting = await fixture(t, `export default { ...${JSON.stringify(base)}, indexer: { transaction() {}, transactionMetadata() {} } };`);
  errorCode(run(["codegen", "--config", conflicting.config]), "INVALID_CONFIG");
});

test("config import and PostgreSQL errors never echo credentials or third-party messages", async (t) => {
  const throwing = await fixture(t, `throw new Error(${JSON.stringify(secret)});`);
  errorCode(run(["codegen", "--config", throwing.config]), "CHEF_COMMAND_FAILED");
  const normal = await fixture(t);
  errorCode(run(["status", "--config", normal.config]), "PREP_URL_AND_DATABASE_URL_REQUIRED");
  errorCode(run(["status", "--config", normal.config], {
    PREP_URL: "http://127.0.0.1:39368", DATABASE_URL: `postgresql://chef:${secret}@127.0.0.1:1/chef`,
  }), "CHEF_COMMAND_FAILED");
});

test("codegen loads the native TypeScript example without env and produces useful checked entity types", async (t) => {
  const { path, config } = await fixture(t);
  for (const name of ["chef.config.ts", "schema.graphql"]) await writeFile(join(path, name), await readFile(join(root, "examples/chef-public", name)));
  const generated = run(["codegen", "--config", config]);
  assert.equal(generated.status, 0, generated.stderr);
  const result = JSON.parse(generated.stdout);
  assert.equal(result.status, "complete");
  assert.match(result.schemaFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(result.output, join(path, "chef.generated.ts"));
  const text = await readFile(result.output, "utf8");
  assert.match(text, /locktime: bigint;/);
  assert.match(text, /PublicTransaction: PublicTransaction;/);
  const checkPath = join(path, "types-check.ts");
  await writeFile(checkPath, `import type { ChefHandlerContext } from "./chef.generated.ts";
declare const context: ChefHandlerContext;
// @ts-expect-error An unknown entity must not typecheck.
context.entities.get("MissingEntity", "1");
// @ts-expect-error Monetary/integer BigInt values must not accept JS numbers.
context.entities.set("PublicTransaction", { id: "tx", minedHeight: 1, version: 4, locktime: 0, sizeBytes: 1, transparentInputCount: 1, transparentOutputCount: 1 });
`);
  const check = spawnSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--allowImportingTsExtensions", "--skipLibCheck", config, checkPath], { cwd: root, encoding: "utf8", timeout: 15000 });
  assert.equal(check.status, 0, check.stdout + check.stderr);
  const second = run(["codegen", "--config", config]);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(await readFile(result.output, "utf8"), text);
});
