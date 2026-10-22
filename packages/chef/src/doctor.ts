import { execFile } from "node:child_process";
import { lstat, access } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute } from "node:path";
import { createServer } from "node:net";
import pg from "pg";
import { PrepClient } from "@zeer-dev/prep-client";
import { CliError } from "./cli-error.js";
import { ChefError } from "./runtime.js";
import { cliFailure, sourceObservation } from "./cli-output.js";
import { assertRunnable, envName, loadProject, projectEnvironment, projectFingerprint, type LoadedProject } from "./project.js";
import type { Checkpoint, ChefStore } from "./types.js";

export interface DoctorCheck { name: string; status: "pass" | "warn" | "fail" | "skipped"; code: string; help: string }
export interface DoctorReport {
  command: "doctor"; ready: boolean; status: "ready" | "not_ready"; checks: DoctorCheck[];
  project?: string; network?: string; checkpoint?: Checkpoint;
  source?: ReturnType<typeof sourceObservation> | { availability: "unavailable"; errorCode: string };
}
const TIMEOUT = 5000;
const emptyCheckpoint: Checkpoint = { height: null, hash: null, anchorHash: null, status: "ready" };
function bounded<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => finish(() => reject(new CliError("DOCTOR_CANCELLED")));
    const timer = setTimeout(() => finish(() => reject(new CliError("DOCTOR_CHECK_TIMEOUT"))), TIMEOUT);
    const finish = (done: () => void) => { clearTimeout(timer); signal?.removeEventListener("abort", abort); done(); };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    operation.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
  });
}
function failure(error: unknown): { code: string; help: string } {
  if (error instanceof CliError && ["DOCTOR_CANCELLED", "DOCTOR_CHECK_TIMEOUT"].includes(error.code)) return {
    code: error.code, help: error.code === "DOCTOR_CANCELLED" ? "The setup check was cancelled." : "The setup check did not finish within five seconds. Check the local service and retry.",
  };
  const result = cliFailure(error, error instanceof CliError || error instanceof ChefError ? error.code : undefined);
  return { code: result.error.code, help: result.help };
}

/** Inspection uses a separate read-only session; it neither locks a writer nor creates a namespace. */
async function inspectDatabase(project: LoadedProject, databaseUrl: string, fingerprint: string): Promise<Checkpoint> {
  const parsed = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new CliError("INVALID_DATABASE_URL");
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: TIMEOUT,
    query_timeout: TIMEOUT, statement_timeout: TIMEOUT, idleTimeoutMillis: 1000 });
  pool.on("error", () => {});
  const namespace = `chef_${project.config.project}`;
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      const existing = await client.query("SELECT 1 FROM pg_namespace WHERE nspname=$1", [namespace]);
      if (!existing.rowCount) throw new CliError("MIGRATION_REQUIRED");
      const marker = await client.query("SELECT to_regclass($1)::text AS relation", [`${namespace}.chef_owned_namespace`]);
      if (!marker.rows[0]?.relation) throw new CliError("DOCTOR_UNMARKED_NAMESPACE");
      const version = await client.query(`SELECT version FROM "${namespace}".chef_owned_namespace WHERE singleton=true`);
      if (![1, 2].includes(version.rows[0]?.version)) throw new CliError("DOCTOR_NAMESPACE_VERSION_UNSUPPORTED");
      const result = await client.query(`SELECT * FROM "${namespace}".state WHERE singleton=true`);
      const row = result.rows[0];
      const { config, model, reorgWindow } = project;
      if (!row || row.fingerprint !== fingerprint || row.model !== model.fingerprint || row.network !== config.network
        || Number(row.start_height) !== config.startHeight || Number(row.reorg_window) !== reorgWindow) throw new CliError("PROJECT_IDENTITY_MISMATCH");
      const height = row.height === null ? null : Number(row.height), undoFloor = row.undo_floor == null ? NaN : Number(row.undo_floor);
      if (!["source", "reorg", "unknown"].includes(row.reconcile_kind) || !Number.isInteger(undoFloor)
        || undoFloor < config.startHeight - 1 || undoFloor > (height ?? config.startHeight - 1)
        || !row.generation || !/^(0|[1-9][0-9]*)$/.test(row.data_revision ?? "") || !row.source_observation) throw new CliError("MIGRATION_REQUIRED");
      if (!["ready", "reconciling", "blocked"].includes(row.status)) throw new CliError("PROJECT_IDENTITY_MISMATCH");
      await client.query("COMMIT");
      return { height, hash: row.hash, anchorHash: row.anchor_hash, status: row.status, undoFloor,
        ...(row.status === "reconciling" ? { reconcileKind: row.reconcile_kind } : {}) };
    } finally { client.release(true); }
  } finally { await pool.end(); }
}

async function portAvailable(host: string, port: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    const controller = new AbortController();
    const stop = () => { cleanup(); controller.abort(); reject(new CliError("DOCTOR_CANCELLED")); };
    const timer = setTimeout(() => { cleanup(); controller.abort(); reject(new CliError("DOCTOR_CHECK_TIMEOUT")); }, TIMEOUT);
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", stop); };
    if (signal?.aborted) { cleanup(); reject(new CliError("DOCTOR_CANCELLED")); return; }
    signal?.addEventListener("abort", stop, { once: true });
    server.once("error", () => { cleanup(); reject(new CliError("DOCTOR_PORT_UNAVAILABLE")); });
    server.listen({ host, port, exclusive: true, signal: controller.signal }, () => { cleanup(); server.close(error => error ? reject(new CliError("DOCTOR_PORT_UNAVAILABLE")) : resolve()); });
  });
}
async function scannerJson(executable: string, args: string[], signal?: AbortSignal): Promise<Record<string, unknown>> {
  return await new Promise((resolve, reject) => {
    execFile(executable, args, { windowsHide: true, timeout: TIMEOUT, killSignal: "SIGKILL", maxBuffer: 65536,
      signal, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot }, encoding: "utf8" }, (error, stdout) => {
      if (error) { reject(new CliError(signal?.aborted ? "DOCTOR_CANCELLED" : "DOCTOR_SCANNER_CHECK_FAILED")); return; }
      try {
        const value: unknown = JSON.parse(stdout);
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
        resolve(value as Record<string, unknown>);
      } catch { reject(new CliError("DOCTOR_SCANNER_PROTOCOL_MISMATCH")); }
    });
  });
}
async function inspectScanner(project: LoadedProject, signal?: AbortSignal): Promise<void> {
  const shielded = project.config.shielded!;
  const executable = process.env[envName(shielded.executableEnv, "ZEER_SCANNER_EXECUTABLE")];
  const keyFile = process.env[envName(shielded.keyFileEnv, "ZEER_VIEWING_KEY_FILE")];
  if (!executable || !keyFile) throw new CliError("SCANNER_EXECUTABLE_AND_KEY_FILE_REQUIRED");
  if (!isAbsolute(executable) || !isAbsolute(keyFile)) throw new CliError("SCANNER_PATHS_MUST_BE_ABSOLUTE");
  const key = await lstat(keyFile).catch(() => { throw new CliError("DOCTOR_KEY_FILE_UNAVAILABLE"); });
  if (!key.isFile() || key.size === 0 || key.size > 4096) throw new CliError("DOCTOR_KEY_FILE_INVALID");
  if (process.platform !== "win32" && ((key.mode & 0o077) !== 0 || process.getuid && key.uid !== process.getuid())) throw new CliError("DOCTOR_KEY_FILE_PERMISSIONS");
  await access(keyFile, constants.R_OK).catch(() => { throw new CliError("DOCTOR_KEY_FILE_UNAVAILABLE"); });
  await access(executable, constants.X_OK).catch(() => { throw new CliError("DOCTOR_SCANNER_CHECK_FAILED"); });
  const caps = await scannerJson(executable, ["capabilities"], signal);
  if (caps.protocol_version !== 1 || caps.network !== "testnet" || caps.stateless !== true || caps.watch_only !== true
    || caps.key_file_required !== true || caps.max_frame_bytes !== 4_100_000
    || JSON.stringify(caps.pools) !== '["sapling","orchard","ironwood"]') throw new CliError("DOCTOR_SCANNER_PROTOCOL_MISMATCH");
  const identity = await scannerJson(executable, ["inspect-key", "--key-file", keyFile, "--account", shielded.accountId], signal);
  if (identity.network !== "testnet" || identity.account_id !== shielded.accountId || identity.key_fingerprint !== shielded.keyFingerprint) throw new CliError("INVALID_SCANNER_IDENTITY");
}

/** Checks local setup only. Viewing keys stay with the native helper; no scan request is made. */
export async function inspectProject(options: {
  configPath: string; project?: LoadedProject; host: string; port: number; signal?: AbortSignal;
  store?: ChefStore; client?: Pick<PrepClient, "get" | "getHeight">;
}): Promise<DoctorReport> {
  const report: DoctorReport = { command: "doctor", ready: false, status: "not_ready", checks: [] };
  const add = (name: string, status: DoctorCheck["status"], code: string, help: string) => report.checks.push({ name, status, code, help });
  const check = async (name: string, run: () => Promise<void>, help: string) => {
    try { if (options.signal?.aborted) throw new CliError("DOCTOR_CANCELLED"); await run(); add(name, "pass", "OK", help); }
    catch (error) {
      const known = error instanceof CliError && Object.hasOwn(doctorHelp, error.code) ? { code: error.code, help: doctorHelp[error.code]! } : failure(error);
      add(name, "fail", known.code, known.help);
    }
  };
  let project = options.project;
  await check("project", async () => { project ??= await loadProject(options.configPath); assertRunnable(project); report.project = project.config.project; report.network = project.config.network; }, "Configuration, schema and handlers are valid.");
  if (!project || report.checks[0]?.status === "fail") {
    for (const name of ["environment", "database", "source", "api_token", "listen", "scanner"]) add(name, "skipped", "PROJECT_INVALID", "Fix the project check before checking dependent setup.");
    return report;
  }
  const loaded = project;
  let environment: ReturnType<typeof projectEnvironment> | undefined;
  await check("environment", async () => {
    environment = projectEnvironment(loaded);
    if (!environment.prepUrl || !environment.databaseUrl) throw new CliError("PREP_URL_AND_DATABASE_URL_REQUIRED");
    try { new PrepClient({ url: environment.prepUrl }); } catch { throw new CliError("INVALID_PREP_URL"); }
    let db: URL; try { db = new URL(environment.databaseUrl); } catch { throw new CliError("INVALID_DATABASE_URL"); }
    if (!["postgres:", "postgresql:"].includes(db.protocol)) throw new CliError("INVALID_DATABASE_URL");
  }, "Source and database environment values are configured.");
  if (report.checks.at(-1)?.status === "pass" && environment?.prepUrl && environment.databaseUrl) {
    const env = environment as { prepUrl: string; databaseUrl: string; prepToken?: string };
    await check("database", async () => {
      report.checkpoint = await bounded(options.store ? options.store.checkpoint() : inspectDatabase(loaded, env.databaseUrl, projectFingerprint(loaded, env.prepUrl)), options.signal);
      if (report.checkpoint.status === "blocked") throw new CliError("REBUILD_REQUIRED");
    }, "The existing namespace matches this project.");
    if (report.checkpoint?.status === "reconciling") add("read_gate", "warn", "RECONCILIATION_REQUIRED", "The follower must reconcile retained state before reads reopen. Doctor does not change this gate.");
    await check("source", async () => {
      const client = options.client ?? new PrepClient({ url: env.prepUrl, ...(env.prepToken ? { token: env.prepToken } : {}) });
      const meta = await bounded(client.getHeight({ timeoutMs: TIMEOUT, signal: options.signal }), options.signal);
      report.source = sourceObservation(meta, report.checkpoint ?? emptyCheckpoint, loaded.config.network, loaded.config.startHeight);
      if (!report.source.identityMatches) throw new CliError("SOURCE_NETWORK_OR_KIND_MISMATCH");
      if (!report.source.historyAvailable) throw new CliError("SOURCE_HISTORY_UNAVAILABLE");
      if (!report.source.usable) throw new CliError("SOURCE_UNAVAILABLE");
    }, "Prep exposes ready history on the configured network and start height.");
    if (!report.source) report.source = { availability: "unavailable", errorCode: report.checks.at(-1)!.code };
    else if (report.source.availability === "available" && report.source.checkpointAheadOfPrep) add("source_checkpoint", "warn", "RECONCILIATION_REQUIRED", "The checkpoint is ahead of Prep. The follower must validate the retained branch before reads reopen.");
  } else for (const name of ["database", "source"]) add(name, "skipped", "ENVIRONMENT_INVALID", "Configure source and database access before this check.");
  await check("api_token", async () => { if (!process.env.CHEF_API_TOKEN || Buffer.byteLength(process.env.CHEF_API_TOKEN) < 16) throw new CliError("CHEF_API_TOKEN_REQUIRED_MIN_16_BYTES"); }, "An API token is configured; its value is omitted.");
  await check("listen", async () => { if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new CliError("INVALID_PORT"); await portAvailable(options.host, options.port, options.signal); }, "The requested API address is available now; startup still checks it again.");
  if (loaded.config.shielded) {
    await check("scanner", () => inspectScanner(loaded, options.signal), "The local scanner protocol and key identity match. No transaction was scanned.");
    if (process.platform === "win32" && report.checks.at(-1)?.status === "pass") add("key_permissions", "warn", "DOCTOR_WINDOWS_ACL_NOT_CHECKED", "Owner-only Windows ACLs are not verified by this check. Restrict the local key file to the operator account.");
  }
  else add("scanner", "skipped", "SCANNER_NOT_CONFIGURED", "This project reads public chain data and does not require a viewing key.");
  report.ready = !report.checks.some(item => item.status === "fail"); report.status = report.ready ? "ready" : "not_ready";
  return report;
}

const doctorHelp: Record<string, string> = {
  INVALID_DATABASE_URL: "Set DATABASE_URL to a PostgreSQL connection URL. Its credentials are never printed.",
  DOCTOR_PORT_UNAVAILABLE: "Choose another --port or stop the service using that address; Doctor does not stop it.",
  DOCTOR_UNMARKED_NAMESPACE: "This namespace has no Chef ownership marker. Choose a fresh project; it is never adopted automatically.",
  DOCTOR_NAMESPACE_VERSION_UNSUPPORTED: "Use a compatible Chef release or a fresh project namespace; do not reset existing data.",
  DOCTOR_KEY_FILE_UNAVAILABLE: "Provide a readable local viewing-key file. Key contents are never included in diagnostics.",
  DOCTOR_KEY_FILE_INVALID: "Use a regular, nonempty UFVK file no larger than 4096 bytes; symlink key files are rejected.",
  DOCTOR_KEY_FILE_PERMISSIONS: "On Unix the key file must belong to this user and exclude all group/other permissions. On Windows protect the file with an owner-only ACL.",
  DOCTOR_SCANNER_CHECK_FAILED: "Check the local executable and key file. Native checks are bounded; raw helper errors are omitted.",
  DOCTOR_SCANNER_PROTOCOL_MISMATCH: "Install a compatible protocol 1 testnet scanner with Sapling, Orchard and Ironwood support.",
};
