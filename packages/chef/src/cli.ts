#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { PrepClient, PrepError } from "@zeer/prep-client";
import { parseModel, generateTypes } from "./schema.js";
import { PostgresStore } from "./store.js";
import { ChefError, isSourceUnavailable, syncStep } from "./runtime.js";
import { createChefServer } from "./graphql.js";
import type { ChefConfig } from "./types.js";

class CliError extends Error { constructor(readonly code: string) { super(code); } }
const help = "zeer-chef <codegen|migrate|sync|serve|status> [--config chef.config.ts]\nsync: [--to INCLUSIVE_HEIGHT | --follow] [--poll-seconds 5]\nserve: [--listen 127.0.0.1] [--port 39370]\nNode 24.14+ loads TypeScript configs with native type stripping. Use node --env-file for local env files.";
const out = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
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

export async function main(args = process.argv.slice(2)): Promise<void> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "help") { process.stdout.write(`${help}\n`); return; }
  const command = args[0]!;
  if (!["codegen", "migrate", "sync", "serve", "status"].includes(command)) throw new CliError("UNKNOWN_COMMAND");
  const flags = new Map<string, string>();
  for (let index = 1; index < args.length; index++) {
    const name = args[index]!;
    const allowed = ["--config", ...(command === "sync" ? ["--to", "--follow", "--poll-seconds"] : []), ...(command === "serve" ? ["--listen", "--port"] : [])];
    if (!allowed.includes(name) || flags.has(name)) throw new CliError("INVALID_OR_DUPLICATE_FLAG");
    const value = name === "--follow" ? "true" : args[++index];
    if (!value || value.startsWith("--")) throw new CliError("MISSING_FLAG_VALUE");
    flags.set(name, value);
  }
  const follow = flags.has("--follow");
  if (follow && flags.has("--to")) throw new CliError("FOLLOW_AND_TO_ARE_EXCLUSIVE");
  const pollSeconds = integer(flags.get("--poll-seconds") ?? "5", 1, 60, "INVALID_POLL_SECONDS");
  const configPath = resolve(flags.get("--config") ?? "chef.config.ts");
  const bytes = await readFile(configPath);
  if (bytes.length > 1024 * 1024) throw new CliError("CONFIG_TOO_LARGE");
  const loaded: unknown = (await import(pathToFileURL(configPath).href)).default;
  if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) throw new CliError("INVALID_CONFIG");
  const config = loaded as ChefConfig;
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(config.project) || !["mainnet", "testnet", "regtest"].includes(config.network)
    || !Number.isInteger(config.startHeight) || config.startHeight < 1 || config.startHeight > 0xffff_fffe
    || typeof config.schema !== "string" || !config.schema || typeof config.handlerVersion !== "string" || !config.handlerVersion.length || config.handlerVersion.length > 128
    || !config.indexer || typeof config.indexer !== "object" || ![config.indexer.block, config.indexer.transaction].some((handler) => typeof handler === "function")
    || [config.indexer.block, config.indexer.transaction].some((handler) => handler !== undefined && typeof handler !== "function")) throw new CliError("INVALID_CONFIG");
  const reorgWindow = config.reorgWindow ?? 100;
  if (!Number.isInteger(reorgWindow) || reorgWindow < 1 || reorgWindow > 1000) throw new CliError("INVALID_REORG_WINDOW");
  let end = flags.has("--to") ? integer(flags.get("--to"), config.startHeight, 0xffff_fffe, "INVALID_END_HEIGHT") : undefined;
  const port = integer(flags.get("--port") ?? "39370", 1, 65535, "INVALID_PORT");
  const schemaPath = resolve(dirname(configPath), config.schema);
  const model = parseModel(await readFile(schemaPath, "utf8"));
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
  const prep = new PrepClient({ url: prepUrl, ...(prepToken ? { token: prepToken } : {}) });
  let prepRequests = 0;
  const client: Pick<PrepClient, "get" | "getHeight"> = {
    get: (...args) => { prepRequests++; return prep.get(...args); },
    getHeight: (...args) => { prepRequests++; return prep.getHeight(...args); },
  };
  const normalizedUrl = new URL(prepUrl); if (!normalizedUrl.pathname.endsWith("/")) normalizedUrl.pathname += "/";
  const fingerprint = createHash("sha256").update(bytes).update("\0").update(JSON.stringify({ schema: model.fingerprint, project: config.project, network: config.network, startHeight: config.startHeight, reorgWindow, handlerVersion: config.handlerVersion, prepUrl: normalizedUrl.href })).digest("hex");
  const controller = new AbortController();
  const abort = () => controller.abort(new DOMException("Stopped", "AbortError"));
  process.once("SIGINT", abort); process.once("SIGTERM", abort);
  const store = new PostgresStore(databaseUrl, { project: config.project, network: config.network, startHeight: config.startHeight, reorgWindow, model, fingerprint });
  try {
    if (command === "migrate") { await store.migrate(); out({ command, status: "complete", project: config.project, fingerprint }); return; }
    const initial = await store.checkpoint();
    if (command === "status") { out({ command, project: config.project, fingerprint, checkpoint: initial }); return; }
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
      return { ...totals, prepRequests, elapsedMs,
        blocksPerSecond: elapsedMs > 0 ? totals.blocks * 1000 / elapsedMs : 0,
        transactionsPerSecond: elapsedMs > 0 ? totals.transactions * 1000 / elapsedMs : 0 };
    };
    if (!follow) {
      const start = performance.now();
      let meta;
      try { meta = await client.getHeight({ signal: controller.signal }); }
      catch (error) { await store.markReconciling(); throw error; }
      totals.fetchMs += performance.now() - start;
      if (!meta.ready || meta.archive_height === null || meta.archive_height < config.startHeight) {
        await store.markReconciling(); throw new CliError("SOURCE_UNAVAILABLE");
      }
      end ??= meta.archive_height;
      if (end > meta.archive_height) throw new CliError("REQUESTED_RANGE_NOT_AVAILABLE");
    }
    try {
      for (;;) {
        controller.signal.throwIfAborted();
        let result;
        try { result = await syncStep({ client, store, indexer: config.indexer, network: config.network, startHeight: config.startHeight, reorgWindow, signal: controller.signal }, end); }
        catch (error) {
          if (!follow || !temporarySourceError(error)) throw error;
          out({ command, state: "source_unavailable", ...metrics() });
          await delay(pollSeconds * 1000, undefined, { signal: controller.signal }); continue;
        }
        totals.blocks += result.blocks; totals.transactions += result.transactions;
        totals.fetchMs += result.fetchMs; totals.handlerIncludingEntityIoMs += result.handlerIncludingEntityIoMs; totals.transactionOverheadMs += result.transactionOverheadMs;
        if (result.state === "source_unavailable" && !follow) throw new CliError("SOURCE_UNAVAILABLE");
        if (!follow && result.state === "caught_up") {
          if (result.height === null || result.height < end!) throw new CliError("REQUESTED_RANGE_NOT_COMPLETE");
          out({ command, state: "complete", project: config.project, startHeight: config.startHeight, initialHeight: initial.height, targetHeight: end, finalHeight: result.height, ...metrics() });
          break;
        }
        if (result.state === "progress") {
          out({ command, state: "progress", project: config.project, height: result.height, targetHeight: end ?? result.sourceHeight, ...metrics() });
        }
        if (follow && result.state !== "progress") {
          out({ command, state: result.state, height: result.height, ...metrics() });
          await delay(pollSeconds * 1000, undefined, { signal: controller.signal });
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
      out({ command, state: "stopped", ...metrics() });
    }
  } finally {
    process.off("SIGINT", abort); process.off("SIGTERM", abort);
    await store.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    // Never print third-party errors: config, handlers and PostgreSQL may contain credentials or SQL.
    const code = error instanceof CliError || error instanceof ChefError ? error.code : "CHEF_COMMAND_FAILED";
    process.stderr.write(`${JSON.stringify({ error: { code }, help: "Check configuration, source readiness, and explicit migrate. Configuration changes require a fresh project and replay." })}\n`);
    process.exitCode = 1;
  });
}
