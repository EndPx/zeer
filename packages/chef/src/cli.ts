#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { PrepClient, PrepError } from "@zeer-dev/prep-client";
import type { Height } from "@zeer-dev/prep-client";
import { parseModel, generateTypes } from "./schema.js";
import { PostgresStore } from "./store.js";
import { ChefError, isSourceUnavailable, syncStep, validateSyncOptions } from "./runtime.js";
import { createChefServer } from "./graphql.js";
import { cliFailure, formatOutput, readStatus, sourceObservation } from "./cli-output.js";
import type { ChefConfig, ChefStore } from "./types.js";
import { ScaffoldError, scaffoldProject } from "./scaffold.js";
import { NativeReceiptSource, ReceiptSourceError } from "./receipts.js";

class CliError extends Error { constructor(readonly code: string) { super(code); } }
const help = "zeer-chef <codegen|migrate|sync|serve|status> [--config chef.config.ts] [--json | --human]\nsync: [--to INCLUSIVE_HEIGHT | --follow] [--poll-seconds 5]\nserve: [--listen 127.0.0.1] [--port 39370]\nOutput defaults to readable text on a terminal and JSON elsewhere. status observes Prep with a 5-second timeout without changing the database.\nNode 24.14+ loads TypeScript configs with native type stripping. Use node --env-file for local env files.";
function integer(value: string | undefined, minimum: number, maximum: number, code: string): number {
  if (value === undefined || !/^(0|[1-9][0-9]*)$/.test(value)) throw new CliError(code);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new CliError(code);
  return parsed;
}
function envName(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(value)) throw new CliError("INVALID_ENV_NAME");
  return value;
}
function temporarySourceError(error: unknown): boolean {
  return isSourceUnavailable(error) || (error instanceof PrepError && error.code === "TRANSPORT_ERROR") || (error instanceof DOMException && error.name === "TimeoutError");
}

export async function main(args = process.argv.slice(2), dependencies: {
  store?: ChefStore; client?: Pick<PrepClient, "get" | "getHeight">;
  write?: (text: string) => void; tty?: boolean;
} = {}): Promise<void> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "help") { process.stdout.write(`${help}\ninit: --dir NEW_DIRECTORY --project project_name --start-height FIRST_AVAILABLE_TESTNET_HEIGHT\nCreates a standalone testnet project without installing dependencies or starting services.\n`); return; }
  const command = args[0]!;
  if (!["init", "codegen", "migrate", "sync", "serve", "status"].includes(command)) throw new CliError("UNKNOWN_COMMAND");
  const flags = new Map<string, string>();
  for (let index = 1; index < args.length; index++) {
    const name = args[index]!;
    const allowed = command === "init" ? ["--dir", "--project", "--start-height", "--json", "--human"] : ["--config", "--json", "--human", ...(command === "sync" ? ["--to", "--follow", "--poll-seconds"] : []), ...(command === "serve" ? ["--listen", "--port"] : [])];
    if (!allowed.includes(name) || flags.has(name)) throw new CliError("INVALID_OR_DUPLICATE_FLAG");
    const value = ["--follow", "--json", "--human"].includes(name) ? "true" : args[++index];
    if (!value || value.startsWith("--")) throw new CliError("MISSING_FLAG_VALUE");
    flags.set(name, value);
  }
  if (flags.has("--json") && flags.has("--human")) throw new CliError("INVALID_OR_DUPLICATE_FLAG");
  const human = flags.has("--human") || (!flags.has("--json") && (dependencies.tty ?? process.stdout.isTTY ?? false));
  const out = (value: Record<string, unknown>) => (dependencies.write ?? ((text: string) => { process.stdout.write(text); }))(formatOutput(value, human));
  if (command === "init") {
    const directory = flags.get("--dir"), project = flags.get("--project");
    if (!directory || !project || !flags.has("--start-height")) throw new CliError("INIT_OPTIONS_REQUIRED");
    const startHeight = integer(flags.get("--start-height"), 0, 0xffff_fffe, "INVALID_START_HEIGHT");
    const result = await scaffoldProject({ directory, project, startHeight });
    out({ command, status: "complete", project, network: "testnet", ...result });
    return;
  }
  const follow = flags.has("--follow");
  if (follow && flags.has("--to")) throw new CliError("FOLLOW_AND_TO_ARE_EXCLUSIVE");
  const pollSeconds = integer(flags.get("--poll-seconds") ?? "5", 1, 60, "INVALID_POLL_SECONDS");
  const configPath = resolve(flags.get("--config") ?? "chef.config.ts");
  const bytes = await readFile(configPath).catch(() => { throw new CliError("CONFIG_FILE_UNREADABLE"); });
  if (bytes.length > 1024 * 1024) throw new CliError("CONFIG_TOO_LARGE");
  const loaded: unknown = (await import(pathToFileURL(configPath).href)).default;
  if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) throw new CliError("INVALID_CONFIG");
  const config = loaded as ChefConfig;
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(config.project) || !["mainnet", "testnet", "regtest"].includes(config.network)
    || !Number.isInteger(config.startHeight) || config.startHeight < 0 || config.startHeight > 0xffff_fffe
    || typeof config.schema !== "string" || !config.schema || typeof config.handlerVersion !== "string" || !config.handlerVersion.length || config.handlerVersion.length > 128
    || !config.indexer || typeof config.indexer !== "object" || ![config.indexer.block, config.indexer.transaction, config.indexer.transactionMetadata, config.indexer.receipt].some((handler) => typeof handler === "function")
    || [config.indexer.block, config.indexer.transaction, config.indexer.transactionMetadata, config.indexer.receipt].some((handler) => handler !== undefined && typeof handler !== "function")
    || (config.indexer.transaction && config.indexer.transactionMetadata)) throw new CliError("INVALID_CONFIG");
  if (config.sync !== undefined && (!config.sync || typeof config.sync !== "object" || Array.isArray(config.sync)
    || Object.keys(config.sync).some(key => !["pageSize", "batchSize", "transactionFilter", "adaptiveScan"].includes(key)))) throw new CliError("INVALID_SYNC_OPTIONS");
  validateSyncOptions(config.sync ?? {});
  if (config.sync?.transactionFilter && !config.indexer.transaction && !config.indexer.transactionMetadata && !config.indexer.receipt) throw new CliError("FILTER_REQUIRES_TRANSACTION_HANDLER");
  if (!!config.shielded !== !!config.indexer.receipt) throw new CliError("SHIELDED_CONFIG_AND_RECEIPT_HANDLER_REQUIRED");
  if (config.shielded && (config.network !== "testnet" || typeof config.shielded !== "object" || Array.isArray(config.shielded)
    || !/^[a-zA-Z0-9_-]{1,64}$/.test(config.shielded.accountId) || !/^[0-9a-f]{64}$/.test(config.shielded.keyFingerprint)
    || Object.keys(config.shielded).some(key => !["accountId", "keyFingerprint", "executableEnv", "keyFileEnv", "timeoutMs"].includes(key)))) throw new CliError("INVALID_SHIELDED_CONFIG");
  if (config.shielded) {
    envName(config.shielded.executableEnv, "ZEER_SCANNER_EXECUTABLE"); envName(config.shielded.keyFileEnv, "ZEER_VIEWING_KEY_FILE");
    if (config.shielded.timeoutMs !== undefined && (!Number.isInteger(config.shielded.timeoutMs) || config.shielded.timeoutMs < 100 || config.shielded.timeoutMs > 120000)) throw new CliError("INVALID_SHIELDED_CONFIG");
  }
  const reorgWindow = config.reorgWindow ?? 100;
  if (!Number.isInteger(reorgWindow) || reorgWindow < 1 || reorgWindow > 1000) throw new CliError("INVALID_REORG_WINDOW");
  let end = flags.has("--to") ? integer(flags.get("--to"), config.startHeight, 0xffff_fffe, "INVALID_END_HEIGHT") : undefined;
  const port = integer(flags.get("--port") ?? "39370", 1, 65535, "INVALID_PORT");
  const schemaPath = resolve(dirname(configPath), config.schema);
  const model = parseModel(await readFile(schemaPath, "utf8").catch(() => { throw new CliError("SCHEMA_FILE_UNREADABLE"); }));
  if (command === "codegen") {
    const generated = resolve(dirname(configPath), "chef.generated.ts");
    await writeFile(generated, generateTypes(model), "utf8");
    out({ command, status: "complete", schemaFingerprint: model.fingerprint, output: generated });
    return;
  }
  const prepUrl = process.env[envName(config.prepUrlEnv, "PREP_URL")];
  const databaseUrl = process.env[envName(config.databaseUrlEnv, "DATABASE_URL")];
  const prepToken = process.env[envName(config.prepTokenEnv, "PREP_API_TOKEN")];
  if (!prepUrl || !databaseUrl) throw new CliError("PREP_URL_AND_DATABASE_URL_REQUIRED");
  let prep: Pick<PrepClient, "get" | "getHeight">;
  try { prep = dependencies.client ?? new PrepClient({ url: prepUrl, ...(prepToken ? { token: prepToken } : {}) }); }
  catch { throw new CliError("INVALID_PREP_URL"); }
  let prepRequests = 0;
  let lastMeta: Height | undefined;
  const client: Pick<PrepClient, "get" | "getHeight"> = {
    get: async (...args) => {
      prepRequests++;
      try { return await prep.get(...args); } catch (error) { lastMeta = undefined; throw error; }
    },
    getHeight: async (...args) => {
      prepRequests++;
      try { lastMeta = await prep.getHeight(...args); return lastMeta; } catch (error) { lastMeta = undefined; throw error; }
    },
  };
  const normalizedUrl = new URL(prepUrl); if (!normalizedUrl.pathname.endsWith("/")) normalizedUrl.pathname += "/";
  const fingerprint = createHash("sha256").update(bytes).update("\0").update(JSON.stringify({ schema: model.fingerprint, project: config.project, network: config.network, startHeight: config.startHeight, reorgWindow, handlerVersion: config.handlerVersion, prepUrl: normalizedUrl.href,
    ...(config.shielded ? { shielded: { protocol: 1, accountId: config.shielded.accountId, keyFingerprint: config.shielded.keyFingerprint } } : {}) })).digest("hex");
  const controller = new AbortController();
  const abort = () => controller.abort(new DOMException("Stopped", "AbortError"));
  process.once("SIGINT", abort); process.once("SIGTERM", abort);
  const store = dependencies.store ?? new PostgresStore(databaseUrl, { project: config.project, network: config.network, startHeight: config.startHeight, reorgWindow, model, fingerprint });
  let receiptSource: NativeReceiptSource | undefined;
  try {
    if (command === "migrate") { await store.migrate(); out({ command, status: "complete", project: config.project, fingerprint }); return; }
    if (command === "status") {
      const status = await readStatus({ store, client, network: config.network, startHeight: config.startHeight, signal: controller.signal });
      out({ command, project: config.project, fingerprint, ...status });
      if (status.state === "blocked") throw new CliError("REBUILD_REQUIRED");
      if (status.state === "source_unavailable") throw new CliError(status.source.availability === "unavailable" ? status.source.errorCode : "SOURCE_UNAVAILABLE");
      if (status.state === "source_mismatch") throw new CliError("SOURCE_NETWORK_OR_KIND_MISMATCH");
      if (status.state === "source_not_ready") throw new CliError(status.source.availability === "available" && !status.source.historyAvailable ? "SOURCE_HISTORY_UNAVAILABLE" : "SOURCE_UNAVAILABLE");
      if (status.state === "reconciliation_needed") throw new CliError("RECONCILIATION_REQUIRED");
      return;
    }
    const initial = await store.checkpoint();
    if (command === "serve") {
      const token = process.env.CHEF_API_TOKEN;
      if (!token || Buffer.byteLength(token) < 16) throw new CliError("CHEF_API_TOKEN_REQUIRED_MIN_16_BYTES");
      const host = flags.get("--listen") ?? "127.0.0.1";
      const server = createChefServer({ store, model, token });
      await new Promise<void>((resolveListen, reject) => { server.once("error", reject); server.listen(port, host, () => { server.off("error", reject); resolveListen(); }); });
      out({ command, status: "listening", host, port, project: config.project });
      try { if (!controller.signal.aborted) await new Promise<void>((resolveStop) => controller.signal.addEventListener("abort", () => resolveStop(), { once: true })); }
      finally {
        const timer = setTimeout(() => server.closeAllConnections(), 2000);
        await new Promise<void>((done) => server.close(() => done())); clearTimeout(timer);
      }
      return;
    }
    await store.acquire();
    if (initial.status === "blocked") throw new ChefError("REBUILD_REQUIRED");
    const started = performance.now();
    const totals = { blocks: 0, transactions: 0, fetchMs: 0, handlerIncludingEntityIoMs: 0, transactionOverheadMs: 0 };
    const metrics = () => {
      const elapsedMs = performance.now() - started;
      return { ...totals, metricsScope: "completed_pages", prepRequests, elapsedMs,
        blocksPerSecond: elapsedMs > 0 ? totals.blocks * 1000 / elapsedMs : 0,
        transactionsPerSecond: elapsedMs > 0 ? totals.transactions * 1000 / elapsedMs : 0 };
    };
    const report = async (state: string, details: Record<string, unknown> = {}) => {
      const checkpoint = await store.checkpoint();
      const source = lastMeta ? sourceObservation(lastMeta, checkpoint, config.network, config.startHeight)
        : state === "source_unavailable" ? { availability: "unavailable" } : undefined;
      out({ command, state, project: config.project, invocationMode: follow ? "follow" : "backfill", checkpoint, ...(source ? { source } : {}), ...metrics(), ...details });
    };
    try {
      if (!follow) {
        const start = performance.now();
        let meta;
        try { meta = await client.getHeight({ signal: controller.signal }); }
        catch (error) { await store.markReconciling(); if (!controller.signal.aborted && temporarySourceError(error)) await report("source_unavailable"); throw error; }
        totals.fetchMs += performance.now() - start;
        if (!meta.ready || meta.archive_height === null || meta.archive_height < config.startHeight) {
          await store.markReconciling(); await report("source_unavailable"); throw new CliError("SOURCE_UNAVAILABLE");
        }
        end ??= meta.archive_height;
        if (end > meta.archive_height) throw new CliError("REQUESTED_RANGE_NOT_AVAILABLE");
      }
      for (;;) {
        controller.signal.throwIfAborted();
        let result;
        try {
          if (config.shielded && !receiptSource) {
            const executable = process.env[envName(config.shielded.executableEnv, "ZEER_SCANNER_EXECUTABLE")];
            const keyFile = process.env[envName(config.shielded.keyFileEnv, "ZEER_VIEWING_KEY_FILE")];
            if (!executable || !keyFile) throw new CliError("SCANNER_EXECUTABLE_AND_KEY_FILE_REQUIRED");
            receiptSource = new NativeReceiptSource({ executable, keyFile, accountId: config.shielded.accountId, keyFingerprint: config.shielded.keyFingerprint, timeoutMs: config.shielded.timeoutMs });
          }
          result = await syncStep({ ...config.sync, client, store, indexer: config.indexer, ...(receiptSource ? { receiptSource } : {}), network: config.network, startHeight: config.startHeight, reorgWindow, signal: controller.signal }, end);
        }
        catch (error) {
          if (!controller.signal.aborted && temporarySourceError(error)) await report("source_unavailable");
          if (!follow || !temporarySourceError(error)) throw error;
          await delay(pollSeconds * 1000, undefined, { signal: controller.signal }); continue;
        }
        totals.blocks += result.blocks; totals.transactions += result.transactions;
        totals.fetchMs += result.fetchMs; totals.handlerIncludingEntityIoMs += result.handlerIncludingEntityIoMs; totals.transactionOverheadMs += result.transactionOverheadMs;
        if (result.state === "source_unavailable" && !follow) { await report("source_unavailable"); throw new CliError("SOURCE_UNAVAILABLE"); }
        if (!follow && result.state === "caught_up") {
          if (result.height === null || result.height < end!) throw new CliError("REQUESTED_RANGE_NOT_COMPLETE");
          await report("complete", { startHeight: config.startHeight, initialHeight: initial.height, targetHeight: end, finalHeight: result.height });
          break;
        }
        if (result.state === "progress") {
          await report("progress", { height: result.height, targetHeight: end ?? result.sourceHeight, prepIndexedHeight: result.sourceHeight, sourceEpoch: result.sourceEpoch });
        }
        if (follow && result.state !== "progress") {
          await report(result.state, { height: result.height, prepIndexedHeight: result.sourceHeight });
          await delay(pollSeconds * 1000, undefined, { signal: controller.signal });
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
      await report("stopped");
    }
  } finally {
    process.off("SIGINT", abort); process.off("SIGTERM", abort);
    await receiptSource?.close();
    await store.close();
  }
}

function isCliEntry(): boolean {
  if (!process.argv[1]) return false;
  try {
    // npm's POSIX bin entry is a symlink. Compare filesystem identities so the
    // executable works through that link or a linked parent directory.
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]));
  } catch { return false; }
}

if (isCliEntry()) {
  main().catch((error: unknown) => {
    // Never print third-party errors: config, handlers and PostgreSQL may contain credentials or SQL.
    const failure = cliFailure(error, error instanceof CliError || error instanceof ChefError || error instanceof ScaffoldError || error instanceof ReceiptSourceError ? error.code : undefined);
    const human = !process.argv.includes("--json") && (process.argv.includes("--human") || process.stdout.isTTY === true);
    process.stderr.write(formatOutput(failure, human));
    process.exitCode = 1;
  });
}
