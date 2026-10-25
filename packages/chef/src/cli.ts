#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createInterface } from "node:readline/promises";
import { PrepClient, PrepError } from "@zeer-dev/prep-client";
import type { Height } from "@zeer-dev/prep-client";
import { generateTypes } from "./schema.js";
import { PostgresStore } from "./store.js";
import { ChefError, isSourceUnavailable, syncStep } from "./runtime.js";
import { createProgressTracker, startProgressHeartbeat } from "./progress.js";
import { createChefServer } from "./graphql.js";
import { cliFailure, formatOutput, readStatus, sourceObservation } from "./cli-output.js";
import type { ChefStore } from "./types.js";
import { ScaffoldError, scaffoldProject } from "./scaffold.js";
import { NativeReceiptSource, ReceiptSourceError } from "./receipts.js";
import { collectInitAnswers, initPrepUrl, PUBLIC_TESTNET_PREP, resolveStartHeight, validateBirthday } from "./init.js";
import { validateTemplate } from "./scaffold-templates.js";

import { CliError } from "./cli-error.js";
import { loadProject, assertRunnable, projectEnvironment, projectFingerprint, envName } from "./project.js";
import { inspectProject } from "./doctor.js";
import { artifactIdentity } from "./operator-diagnostics.js";
import { prepareProject, preflightDev, superviseDev } from "./dev.js";
const help = "zeer-chef <codegen|migrate|sync|serve|status|dev|doctor> [--config chef.config.ts] [--json | --human]\nsync: [--to INCLUSIVE_HEIGHT | --follow] [--poll-seconds 5]\nserve: [--listen 127.0.0.1] [--port 39370]\nOutput defaults to readable text on a terminal and JSON elsewhere. status observes Prep with a 5-second timeout without changing the database.\nNode 24.14+ loads TypeScript configs with native type stripping. Use node --env-file for local env files.";
function integer(value: string | undefined, minimum: number, maximum: number, code: string): number {
  if (value === undefined || !/^(0|[1-9][0-9]*)$/.test(value)) throw new CliError(code);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new CliError(code);
  return parsed;
}
function temporarySourceError(error: unknown): boolean {
  return isSourceUnavailable(error) || (error instanceof PrepError && error.code === "TRANSPORT_ERROR") || (error instanceof DOMException && error.name === "TimeoutError");
}

const commandHelp: Record<string, string> = {
  doctor: "zeer doctor [--config chef.config.ts] [--listen 127.0.0.1] [--port 39370]\nBounded read-only checks for project, source, database, API token, port and optional local scanner. Does not generate files, migrate, start services or change read gates. Nonzero when not ready.",
  dev: "zeer dev [--config chef.config.ts] [--listen 127.0.0.1] [--port 39370] [--poll-seconds 5] [--migrate]\nGenerate types, run the installed project TypeScript compiler if tsconfig.json exists, then inspect setup. Starts the API before the follower. Ctrl+C or either child failing stops both. Requires migrated compatible state; --migrate explicitly permits existing safe migration only when that is the sole blocker. Never installs packages or starts Docker.",
  init: "zeer init [--template blank|public|shielded] [--dir NEW_DIRECTORY] [--project NAME] [--start-height latest|HEIGHT] [--prep-url URL]\nGuided setup offers Blank project, Public chain indexer and Shielded payment inbox.\nPublic/blank default to latest indexed, captured once from Prep /height with a 5-second timeout. Shielded requires an explicit numeric wallet birthday.\nSource: --prep-url, then PREP_URL, then the public testnet Prep. PREP_API_TOKEN is sent only to the matching explicitly configured source.\nScripts must provide --dir, --project and --start-height; omitted template retains the public default. Numeric heights work offline.\nBlank has no sample entity/handler. Shielded includes a pinned scanner installer and local receipt consumer.\nCreates new files only; no key contents are collected, no packages installed, no services started and no existing directory overwritten.",
  codegen: "zeer codegen [--config chef.config.ts]\nRead the schema and write chef.generated.ts beside the config. Does not connect to Prep or PostgreSQL. Run typecheck separately.",
  migrate: "zeer migrate [--config chef.config.ts]\nExplicitly initialize/migrate the compatible project namespace and its declared indexes. Stop the follower and API before upgrading an existing namespace. Does not replay blocks or reset an incompatible project.",
  sync: "zeer sync [--config chef.config.ts] [--to INCLUSIVE_HEIGHT | --follow] [--poll-seconds 5]\nDefault: capture the available Prep tip, index through it and exit. --follow keeps polling; --to is an inclusive finite target.\n--poll-seconds accepts 1..60 and is used while following. Compatible restarts resume the durable checkpoint. Ctrl+C stops with committed progress retained.\nEvery 5 seconds a cached heartbeat reports phase, pending range and acknowledged committed height. Heartbeat time is not progress; lastProgressAt records completed work. Metrics cover completed pages only. No source or database request is made by the heartbeat.",
  status: "zeer status [--config chef.config.ts]\nRead the durable checkpoint and inspect Prep with a 5-second timeout. Does not take a writer lock or change the database.\nUnavailable, incompatible and unreconciled states return nonzero diagnostics.",
  serve: "zeer serve [--config chef.config.ts] [--listen 127.0.0.1] [--port 39370]\nServe authenticated read-only GraphQL over committed entities and cached freshness at GET /status. Status makes no Prep request. Requires CHEF_API_TOKEN of at least 16 bytes.\nDoes not run the writer; run sync or sync --follow separately. Port accepts 1..65535. Ctrl+C stops this server.",
};

export async function main(args = process.argv.slice(2), dependencies: {
  store?: ChefStore; client?: Pick<PrepClient, "get" | "getHeight">;
  write?: (text: string) => void; tty?: boolean; prompt?: (question: string) => Promise<string>;
} = {}): Promise<void> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "help") { process.stdout.write(`Zeer Chef - Zcash Testnet\n${commandHelp.init}\n\n${help}\nAll commands also accept the zeer-chef alias.\nzeer <command> --help: command options and behavior. zeer --version: installed package version.\n`); return; }
  if (args.length === 1 && args[0] === "--version") {
    process.stdout.write(`${JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version}\n`); return;
  }
  const command = args[0]!;
  if (!["init", "codegen", "migrate", "sync", "serve", "status", "dev", "doctor"].includes(command)) throw new CliError("UNKNOWN_COMMAND");
  if (args.length === 2 && args[1] === "--help") {
    process.stdout.write(`${commandHelp[command]}\nOutput: --json or --human (exclusive). Defaults to readable terminal text and JSON elsewhere.\n`); return;
  }
  const flags = new Map<string, string>();
  for (let index = 1; index < args.length; index++) {
    const name = args[index]!;
    const allowed = command === "init" ? ["--dir", "--project", "--start-height", "--prep-url", "--template", "--json", "--human"] : ["--config", "--json", "--human", ...(command === "sync" ? ["--to", "--follow", "--poll-seconds"] : command === "dev" ? ["--poll-seconds", "--migrate"] : []), ...(["serve", "doctor", "dev"].includes(command) ? ["--listen", "--port"] : [])];
    if (!allowed.includes(name) || flags.has(name)) throw new CliError("INVALID_OR_DUPLICATE_FLAG");
    const value = ["--follow", "--migrate", "--json", "--human"].includes(name) ? "true" : args[++index];
    if (!value || value.startsWith("--")) throw new CliError("MISSING_FLAG_VALUE");
    flags.set(name, value);
  }
  if (flags.has("--json") && flags.has("--human")) throw new CliError("INVALID_OR_DUPLICATE_FLAG");
  const human = flags.has("--human") || (!flags.has("--json") && (dependencies.tty ?? process.stdout.isTTY ?? false));
  const out = (value: Record<string, unknown>) => (dependencies.write ?? ((text: string) => { process.stdout.write(text); }))(formatOutput(value, human));
  if (command === "init") {
    let directory = flags.get("--dir"), project = flags.get("--project"), start = flags.get("--start-height");
    let template = flags.get("--template"), selectedSource = (flags.get("--prep-url") ?? process.env.PREP_URL) || undefined;
    const explicitSource = selectedSource;
    if (template !== undefined) validateTemplate(template);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
    let readline: ReturnType<typeof createInterface> | undefined;
    try {
      if ((!directory || !project || start === undefined) && !flags.has("--json")
        && (dependencies.tty ?? Boolean(process.stdin.isTTY && process.stdout.isTTY))) {
        const write = dependencies.write ?? ((text: string) => { process.stdout.write(text); });
        write("Zeer Chef · Zcash Testnet\nCreate a local indexer. Press Enter to use the defaults.\n");
        readline = dependencies.prompt ? undefined : createInterface({ input: process.stdin, output: process.stdout });
        readline?.once("SIGINT", cancel); readline?.once("close", cancel);
        const answers = await collectInitAnswers({ directory, project, startHeight: start, template, prepUrl: selectedSource },
          dependencies.prompt ?? (question => readline!.question(question, { signal: controller.signal })),
          code => write(`${cliFailure(undefined, code).help}\n`));
        ({ directory, project, startHeight: start, template, prepUrl: selectedSource } = answers);
      }
      if (!directory || !project || start === undefined) throw new CliError("INIT_OPTIONS_REQUIRED");
      template ??= "public";
      validateTemplate(template); validateBirthday(template, start);
      const prepUrl = initPrepUrl(selectedSource ?? PUBLIC_TESTNET_PREP);
      const startHeight = await resolveStartHeight(start, { url: prepUrl,
        token: explicitSource && initPrepUrl(explicitSource) === prepUrl ? process.env.PREP_API_TOKEN || undefined : undefined,
        client: dependencies.client, signal: controller.signal });
      controller.signal.throwIfAborted();
      const result = await scaffoldProject({ directory, project, startHeight, prepUrl, template });
      out({ command, status: "complete", project, network: "testnet", startHeight,
        startSelection: start === "latest" ? "latest_indexed" : "explicit", ...result });
      return;
    } catch (error) {
      if (controller.signal.aborted) throw new ScaffoldError("INIT_CANCELLED");
      throw error;
    } finally {
      process.off("SIGINT", cancel); process.off("SIGTERM", cancel); readline?.close();
    }
  }
  const follow = flags.has("--follow");
  if (follow && flags.has("--to")) throw new CliError("FOLLOW_AND_TO_ARE_EXCLUSIVE");
  const pollSeconds = integer(flags.get("--poll-seconds") ?? "5", 1, 60, "INVALID_POLL_SECONDS");
  const configPath = resolve(flags.get("--config") ?? "chef.config.ts");
  const port = integer(flags.get("--port") ?? "39370", 1, 65535, "INVALID_PORT");
  const host = flags.get("--listen") ?? "127.0.0.1";
  if (["doctor", "dev"].includes(command)) {
    const controller = new AbortController();
    const abort = () => controller.abort(new DOMException("Stopped", "AbortError"));
    process.once("SIGINT", abort); process.once("SIGTERM", abort);
    try {
      if (command === "doctor") {
        const report = await inspectProject({ configPath, host, port, signal: controller.signal, store: dependencies.store, client: dependencies.client });
        out(report as unknown as Record<string, unknown>);
        if (!report.ready) throw new CliError("DOCTOR_NOT_READY");
      } else {
        const project = await loadProject(configPath);
        await prepareProject(project, out, controller.signal);
        await preflightDev({
          inspect: () => inspectProject({ configPath, project, host, port, signal: controller.signal }),
          migrate: () => main(["migrate", "--config", configPath, "--json"], { write: dependencies.write }),
          allowMigration: flags.has("--migrate"), emit: out,
        });
        controller.signal.throwIfAborted();
        await superviseDev({ configPath, host, port, pollSeconds, signal: controller.signal, emit: out });
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
      out({ command, status: "stopped" });
    } finally { process.off("SIGINT", abort); process.off("SIGTERM", abort); }
    return;
  }
  const project = await loadProject(configPath);
  const { config, model, reorgWindow } = project;
  let end = flags.has("--to") ? integer(flags.get("--to"), config.startHeight, 0xffff_fffe, "INVALID_END_HEIGHT") : undefined;
  if (command === "codegen") {
    const generated = resolve(dirname(configPath), "chef.generated.ts");
    await writeFile(generated, generateTypes(model), "utf8");
    out({ command, status: "complete", schemaFingerprint: model.fingerprint, output: generated });
    return;
  }
  assertRunnable(project);
  const {prepUrl, databaseUrl, prepToken} = projectEnvironment(project);
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
  const fingerprint = projectFingerprint(project, prepUrl);
  const controller = new AbortController();
  const abort = () => controller.abort(new DOMException("Stopped", "AbortError"));
  const stopMessage = (message: unknown) => { if (message && typeof message === "object" && (message as {type?: unknown}).type === "zeer-stop") abort(); };
  process.once("SIGINT", abort); process.once("SIGTERM", abort);
  process.on("message", stopMessage);
  const store = dependencies.store ?? new PostgresStore(databaseUrl, { project: config.project, network: config.network, startHeight: config.startHeight, reorgWindow, model, fingerprint });
  let receiptSource: NativeReceiptSource | undefined;
  try {
    if (command === "migrate") { await store.migrate(); out({ command, status: "complete", project: config.project, fingerprint }); return; }
    if (command === "status") {
      const status = await readStatus({ store, client, network: config.network, startHeight: config.startHeight, project: config.project, signal: controller.signal });
      out({ command, project: config.project, fingerprint, ...status });
      if (status.state === "blocked") throw new CliError("REBUILD_REQUIRED");
      if (status.state === "source_unavailable") throw new CliError(status.source.availability === "unavailable" ? status.source.errorCode : "SOURCE_UNAVAILABLE", { retryTransient: status.diagnostic.action.category === "retry_transient" });
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
      out({ command, status: "listening", host, port, project: config.project, artifact: artifactIdentity() });
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
    const progress = createProgressTracker(initial.height);
    const stopHeartbeat = startProgressHeartbeat(() => out({ command, state: "heartbeat", project: config.project, artifact: artifactIdentity(),
      invocationMode: follow ? "follow" : "backfill", progress: progress.snapshot(), ...metrics() }), 5000,
      () => !!dependencies.write || !(process.stdout.destroyed || process.stdout.writableEnded || process.stdout.writableNeedDrain));
    const report = async (state: string, details: Record<string, unknown> = {}) => {
      const checkpoint = await store.checkpoint();
      const source = lastMeta ? sourceObservation(lastMeta, checkpoint, config.network, config.startHeight)
        : state === "source_unavailable" ? { availability: "unavailable" } : undefined;
      out({ command, state, project: config.project, artifact: artifactIdentity(), invocationMode: follow ? "follow" : "backfill", checkpoint, ...(source ? { source } : {}), ...metrics(), ...details });
    };
    try {
      if (!follow) {
        const start = performance.now();
        let meta;
        progress.update({ phase: "fetching" });
        try { meta = await client.getHeight({ signal: controller.signal }); }
        catch (error) { await store.recordSourceObservation?.({status:"unavailable",prepIndexedHeight:null,sourceObservedHeight:null,sourceObservedAt:null}); await store.markReconciling(); if (!controller.signal.aborted && temporarySourceError(error)) await report("source_unavailable"); throw error; }
        totals.fetchMs += performance.now() - start;
        progress.update({ phase: "fetching", progressed: true,
          prepArchiveHeight: meta.network === config.network && meta.payload_kind === "full-v1" ? meta.archive_height : null,
          prepIndexedHeight: meta.network === config.network && meta.payload_kind === "full-v1" ? meta.indexed_height ?? null : null,
          prepReady: meta.network === config.network && meta.payload_kind === "full-v1" ? meta.ready : null });
        await store.recordSourceObservation?.({ status: meta.network === config.network && meta.payload_kind === "full-v1" && meta.ready && meta.archive_height !== null && meta.archive_height >= config.startHeight ? "available" : "unavailable",
          prepIndexedHeight: meta.indexed_height ?? null, sourceObservedHeight: meta.source_height ?? null, sourceObservedAt: meta.source_observed_at ?? null });
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
          result = await syncStep({ ...config.sync, client, store, indexer: config.indexer, ...(receiptSource ? { receiptSource } : {}), network: config.network, startHeight: config.startHeight, reorgWindow, signal: controller.signal, onProgress: progress.update }, end);
        }
        catch (error) {
          if (temporarySourceError(error)) progress.update({ phase: "source_wait", processingRange: null });
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
    } finally { stopHeartbeat(); }
  } finally {
    process.off("SIGINT", abort); process.off("SIGTERM", abort);
    process.off("message", stopMessage);
    if (process.connected) process.disconnect();
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
    process.exitCode = error instanceof ScaffoldError && error.code === "INIT_CANCELLED" ? 130 : 1;
  });
}
