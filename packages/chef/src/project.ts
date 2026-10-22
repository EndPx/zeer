import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseModel } from "./schema.js";
import { validateSyncOptions } from "./runtime.js";
import { CliError } from "./cli-error.js";
import type { ChefConfig, Model } from "./types.js";

export interface LoadedProject { configPath: string; bytes: Buffer; config: ChefConfig; model: Model; reorgWindow: number }
export function envName(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(value)) throw new CliError("INVALID_ENV_NAME");
  return value;
}

/** Shared with codegen and runtime; does not connect to a service or write files. */
export async function loadProject(configPath: string): Promise<LoadedProject> {
  configPath = resolve(configPath);
  const bytes = await readFile(configPath).catch(() => { throw new CliError("CONFIG_FILE_UNREADABLE"); });
  if (bytes.length > 1024 * 1024) throw new CliError("CONFIG_TOO_LARGE");
  const loaded: unknown = (await import(pathToFileURL(configPath).href)).default;
  if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) throw new CliError("INVALID_CONFIG");
  const config = loaded as ChefConfig;
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(config.project) || !["mainnet", "testnet", "regtest"].includes(config.network)
    || !Number.isInteger(config.startHeight) || config.startHeight < 0 || config.startHeight > 0xffff_fffe
    || typeof config.schema !== "string" || !config.schema || typeof config.handlerVersion !== "string" || !config.handlerVersion.length || config.handlerVersion.length > 128
    || !config.indexer || typeof config.indexer !== "object" || Array.isArray(config.indexer)
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
  const schemaPath = resolve(dirname(configPath), config.schema);
  const schema = await readFile(schemaPath, "utf8").catch(() => { throw new CliError("SCHEMA_FILE_UNREADABLE"); });
  if (!schema.replace(/#[^\r\n]*/g, "").trim()) throw new CliError("EMPTY_SCHEMA_ADD_ENTITY");
  const model = parseModel(schema);
  return { configPath, bytes, config, model, reorgWindow };
}
export function assertRunnable(project: LoadedProject): void {
  const {indexer} = project.config;
  if (![indexer.block, indexer.transaction, indexer.transactionMetadata, indexer.receipt].some(handler => typeof handler === "function")) throw new CliError("INDEXER_HANDLER_REQUIRED");
}
export function projectEnvironment(project: LoadedProject) {
  const {config} = project;
  return {
    prepUrl: process.env[envName(config.prepUrlEnv, "PREP_URL")],
    databaseUrl: process.env[envName(config.databaseUrlEnv, "DATABASE_URL")],
    prepToken: process.env[envName(config.prepTokenEnv, "PREP_API_TOKEN")],
  };
}
/** Keep field order and byte inputs compatible with existing project namespaces. */
export function projectFingerprint(project: LoadedProject, prepUrl: string): string {
  const {bytes, config, model, reorgWindow} = project;
  const normalizedUrl = new URL(prepUrl); if (!normalizedUrl.pathname.endsWith("/")) normalizedUrl.pathname += "/";
  return createHash("sha256").update(bytes).update("\0").update(JSON.stringify({ schema: model.fingerprint, project: config.project, network: config.network, startHeight: config.startHeight, reorgWindow, handlerVersion: config.handlerVersion, prepUrl: normalizedUrl.href,
    ...(config.shielded ? { shielded: { protocol: 1, accountId: config.shielded.accountId, keyFingerprint: config.shielded.keyFingerprint } } : {}) })).digest("hex");
}
