import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
  ];
  for (const [args, code] of cases) errorCode(run(args), code);
});

test("CLI range and port validation precedes database access", async (t) => {
  const { config } = await fixture(t);
  for (const value of ["0", "01", "1.5", "-1", "4294967295"]) errorCode(run(["sync", "--config", config, "--to", value]), "INVALID_END_HEIGHT");
  for (const value of ["0", "65536", "3e4"]) errorCode(run(["serve", "--config", config, "--port", value]), "INVALID_PORT");
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
