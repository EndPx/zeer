import { spawn, type ChildProcess } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CliError } from "./cli-error.js";
import { cliFailure } from "./cli-output.js";
import { inspectProject, type DoctorReport } from "./doctor.js";
import type { LoadedProject } from "./project.js";
import { assertRunnable } from "./project.js";
import { generateTypes } from "./schema.js";

type Emit = (event: Record<string, unknown>) => void;

function forceStop(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    killer.once("error", () => { child.kill("SIGKILL"); });
    killer.once("exit", code => { if (code !== 0) child.kill("SIGKILL"); });
  } else {
    try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  }
}

/** Runs only the compiler already installed in this project. No package downloads. */
export async function prepareProject(project: LoadedProject, emit: Emit, signal: AbortSignal): Promise<void> {
  assertRunnable(project);
  signal.throwIfAborted();
  const directory = dirname(project.configPath);
  await writeFile(join(directory, "chef.generated.ts"), generateTypes(project.model), "utf8");
  emit({ command: "dev", status: "generated" });
  try { await access(join(directory, "tsconfig.json")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new CliError("TYPECHECK_FAILED");
    emit({ command: "dev", status: "typecheck_skipped", reason: "no_tsconfig" });
    return;
  }
  let compiler: string;
  try { compiler = join(dirname(createRequire(join(directory, "package.json")).resolve("typescript/package.json")), "bin", "tsc"); }
  catch { throw new CliError("PROJECT_TYPESCRIPT_REQUIRED"); }
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [compiler, "--noEmit", "--project", join(directory, "tsconfig.json")], {
      cwd: directory, windowsHide: true, stdio: "ignore", detached: process.platform !== "win32",
    });
    let failed = false;
    const cancel = () => { failed = true; forceStop(child); };
    const timer = setTimeout(cancel, 60000);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    child.once("error", () => { failed = true; });
    // Abort emits error before the OS has released the child's working directory.
    // Wait for close so cancellation cannot leave a still-closing compiler behind.
    child.once("close", code => {
      clearTimeout(timer); signal.removeEventListener("abort", cancel);
      if (process.platform !== "win32") forceStop(child);
      !failed && code === 0 ? resolve() : reject(new CliError("TYPECHECK_FAILED"));
    });
  });
  signal.throwIfAborted();
  emit({ command: "dev", status: "typechecked" });
}

/** Read-only diagnostics run again after an explicitly requested safe migration. */
export async function preflightDev(options: {
  inspect: () => Promise<DoctorReport>; migrate: () => Promise<void>; allowMigration: boolean; emit: Emit;
}): Promise<void> {
  let report = await options.inspect();
  options.emit(report as unknown as Record<string, unknown>);
  if (!report.ready && options.allowMigration) {
    const failures = report.checks.filter(check => check.status === "fail");
    if (failures.length && failures.every(check => check.code === "MIGRATION_REQUIRED")) {
      await options.migrate();
      report = await options.inspect();
      options.emit(report as unknown as Record<string, unknown>);
    }
  }
  if (!report.ready) throw new CliError("DEV_PREFLIGHT_FAILED");
  if (report.checkpoint?.status === "ready" && report.source?.availability === "available" && report.source.checkpointAheadOfPrep) {
    throw new CliError("DEV_RECONCILIATION_REQUIRED");
  }
}

/** Accept only bounded known CLI data; handlers may write arbitrary stdout/stderr. */
function safeProgress(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return;
  const event = value as Record<string, unknown>;
  if (event.command !== "sync" || !["progress", "caught_up", "source_unavailable", "stopped", "reconciling"].includes(String(event.state))) return;
  const result: Record<string, unknown> = { command: "dev", role: "follower", state: event.state };
  const cp = event.checkpoint as Record<string, unknown> | undefined;
  if (cp && (cp.height === null || (Number.isInteger(cp.height) && Number(cp.height) >= 0))
    && ["ready", "reconciling", "blocked"].includes(String(cp.status))) {
    result.checkpoint = { height: cp.height, status: cp.status };
  }
  const source = event.source as Record<string, unknown> | undefined;
  if (source && ["available", "unavailable"].includes(String(source.availability))) {
    const observed: Record<string, unknown> = { availability: source.availability };
    for (const key of ["indexedHeight", "chefPrepLagBlocks", "sourceHeight", "sourceObservedAt"]) {
      if (source[key] === null || (Number.isSafeInteger(source[key]) && Number(source[key]) >= 0)) observed[key] = source[key];
    }
    result.source = observed;
  }
  return result;
}

export async function superviseDev(options: {
  configPath: string; host: string; port: number; pollSeconds: number; signal: AbortSignal; emit: Emit;
  /** Test seam: exercises the same real subprocess lifecycle with a disposable CLI. */
  entry?: string; startupMs?: number; shutdownMs?: number;
}): Promise<void> {
  const children = new Set<ChildProcess>();
  const entry = options.entry ?? fileURLToPath(new URL("./cli.js", import.meta.url));
  let finishing = false;
  let apiReady = false;
  let startup: NodeJS.Timeout | undefined;
  let finish!: (error?: Error) => void;
  const completion = new Promise<void>((resolve, reject) => {
    finish = error => {
      if (finishing) return;
      finishing = true;
      clearTimeout(startup);
      void stopAll().then(() => error ? reject(error) : resolve(), () => reject(error ?? new CliError("DEV_SHUTDOWN_FAILED")));
    };
  });
  async function stopAll(): Promise<void> {
    const owned = [...children];
    await Promise.all(owned.map(child => new Promise<void>(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
      let done = false;
      const complete = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
      const timer = setTimeout(() => {
        forceStop(child);
      }, options.shutdownMs ?? 8000);
      child.once("close", complete);
      // IPC lets Windows run the same graceful cleanup as POSIX signals.
      if (child.connected) child.send({ type: "zeer-stop" }, () => {});
      else child.kill("SIGTERM");
    })));
    options.emit({ command: "dev", status: "stopped" });
  }
  function start(role: "api" | "follower"): void {
    if (finishing) return;
    const args = role === "api"
      ? ["serve", "--listen", options.host, "--port", String(options.port)]
      : ["sync", "--follow", "--poll-seconds", String(options.pollSeconds)];
    const child = spawn(process.execPath, [entry, ...args, "--config", options.configPath, "--json"], {
      cwd: dirname(options.configPath), windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    children.add(child);
    let diagnostic: string | undefined;
    const consume = (stream: NodeJS.ReadableStream | null, errorStream: boolean) => {
      let buffer = "", dropping = false;
      stream?.on("data", (chunk: Buffer) => {
        for (const part of chunk.toString("utf8").split(/(?<=\n)/)) {
          if (buffer.length + part.length > 65536) { buffer = ""; dropping = true; }
          if (!dropping) buffer += part;
          if (!part.endsWith("\n")) continue;
          if (!dropping) {
            try {
              const event = JSON.parse(buffer);
              if (errorStream) {
                const code = cliFailure(undefined, event?.error?.code).error.code;
                if (code !== "CHEF_COMMAND_FAILED") diagnostic = code;
              } else if (role === "api" && !apiReady && event.command === "serve" && event.status === "listening"
                && event.port === options.port && event.host === options.host) {
                apiReady = true; clearTimeout(startup);
                options.emit({ command: "dev", status: "api_listening", host: options.host, port: options.port });
                start("follower");
              } else if (role === "follower") {
                const progress = safeProgress(event); if (progress) options.emit(progress);
              }
            } catch { /* Unstructured application logs are never forwarded. */ }
          }
          buffer = ""; dropping = false;
        }
      });
    };
    consume(child.stdout, false); consume(child.stderr, true);
    child.once("error", () => { children.delete(child); finish(new CliError("DEV_CHILD_START_FAILED")); });
    child.once("exit", () => {
      // The leader may have died before it could close an owned scanner.
      if (process.platform !== "win32" && child.pid) {
        try { process.kill(-child.pid, "SIGKILL"); } catch { /* Group already stopped. */ }
      }
      children.delete(child);
      if (!finishing) {
        options.emit({ command: "dev", status: "child_failed", role, ...(diagnostic ? { error: cliFailure(undefined, diagnostic).error, help: cliFailure(undefined, diagnostic).help } : {}) });
        finish(new CliError(role === "api" ? "DEV_API_EXITED" : "DEV_FOLLOWER_EXITED"));
      }
    });
  }
  const abort = () => finish();
  options.signal.addEventListener("abort", abort, { once: true });
  if (options.signal.aborted) finish();
  else {
    options.emit({ command: "dev", status: "starting" });
    startup = setTimeout(() => finish(new CliError("DEV_API_START_TIMEOUT")), options.startupMs ?? 15000);
    start("api");
  }
  try { await completion; }
  finally { options.signal.removeEventListener("abort", abort); }
}

export { inspectProject };
