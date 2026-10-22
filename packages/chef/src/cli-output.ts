import { PrepError } from "@zeer-dev/prep-client";
import type { Height, PrepClient } from "@zeer-dev/prep-client";
import type { Checkpoint, ChefStore } from "./types.js";

const guidance: Record<string, string> = {
  DOCTOR_NOT_READY: "Resolve the failed doctor checks, then run doctor again. No setup changes were made by the diagnostic.",
  DEV_PREFLIGHT_FAILED: "Resolve the failed doctor checks before starting dev. For a new compatible namespace, explicitly use dev --migrate or run migrate first.",
  DEV_RECONCILIATION_REQUIRED: "The readable checkpoint is ahead of Prep. Run follow to close the read gate and reconcile, stop it after recovery, then restart dev. Dev has not started its API.",
  PROJECT_TYPESCRIPT_REQUIRED: "Install the project's declared TypeScript dependency before running dev. No compiler is downloaded automatically.",
  TYPECHECK_FAILED: "Run the project's typecheck command to see compiler diagnostics, fix the errors, then retry dev. No services were started.",
  DEV_CHILD_START_FAILED: "The owned API or follower process could not start. Check the installed SDK and Node version, then retry dev.",
  DEV_API_START_TIMEOUT: "The API did not report listening within 15 seconds. Check database connectivity and the selected address and port, then retry dev.",
  DEV_API_EXITED: "The API exited unexpectedly. Dev stopped its follower; resolve any reported diagnostic and restart from the retained checkpoint.",
  DEV_FOLLOWER_EXITED: "The follower exited unexpectedly. Dev stopped its API; resolve any reported diagnostic and restart from the retained checkpoint.",
  DEV_SHUTDOWN_FAILED: "An owned development process could not be stopped. Inspect its process before starting another writer.",
  INVALID_INIT_TEMPLATE: "Choose blank, public or shielded. Guided setup accepts choices 1, 2 and 3 as well.",
  SHIELDED_BIRTHDAY_REQUIRED: "Choose an explicit numeric wallet birthday at or before your first relevant note. Shielded inbox does not silently start at latest or genesis.",
  EMPTY_SCHEMA_ADD_ENTITY: "This project has no entities yet. Define at least one entity with id: ID! in schema.graphql, then run codegen and implement handlers.ts before indexing.",
  INDEXER_HANDLER_REQUIRED: "Implement at least one block, transaction or receipt handler. A blank project intentionally starts without application logic.",
  INIT_OPTIONS_REQUIRED: "Run zeer init in a terminal for guided setup, or supply --dir NEW_DIRECTORY --project project_name --start-height HEIGHT for scripts. No installation or service startup is automatic.",
  INIT_CANCELLED: "Setup cancelled before creating project files. Run zeer init when you are ready.",
  INIT_PREP_UNAVAILABLE: "Could not read Prep's indexed height within 5 seconds. Retry with --prep-url URL or PREP_URL, or choose an explicit --start-height HEIGHT. No project files were created.",
  INIT_PREP_NOT_READY: "Latest setup requires ready full-v1 Zcash testnet history. Check Prep /height or choose an explicit start height for a compatible source. No project files were created.",
  INVALID_PROJECT_NAME: "Use a lowercase letter followed by lowercase letters, digits or underscores, at most 32 characters.",
  INVALID_START_HEIGHT: "Choose latest during init, or an integer start height between 0 and 4294967294 covered by the testnet Prep archive.",
  PROJECT_DIRECTORY_EXISTS: "Choose a new directory. Init never overwrites an existing directory, file or symlink.",
  PROJECT_DIRECTORY_UNWRITABLE: "Use a new directory under an existing writable parent.",
  INVALID_OR_DUPLICATE_FLAG: "Use --help for supported flags; --json and --human are exclusive.",
  MISSING_FLAG_VALUE: "Supply the value after each flag shown in --help.",
  FOLLOW_AND_TO_ARE_EXCLUSIVE: "Choose --follow for polling or --to for a finite inclusive range.",
  INVALID_CONFIG: "Check the project, network, startHeight, schema, handlerVersion and handler functions in the config.",
  INVALID_SYNC_OPTIONS: "Use sync.pageSize, sync.batchSize (1..100), optional sync.transactionFilter and sync.adaptiveScan.",
  INVALID_SCAN_MODE: "Set sync.adaptiveScan to a boolean. Enable it only with a Prep server advertising adaptive scans.",
  INVALID_BATCH_SIZE: "Choose an integer sync.batchSize from 1 to 100. A failed batch is rolled back in full.",
  BATCHING_UNSUPPORTED: "Use a store with atomic applyBatch support or set sync.batchSize to 1.",
  INVALID_TRANSACTION_FILTER: "Use supported Prep public transaction predicates with bounded arrays and valid values.",
  CONFLICTING_TRANSACTION_HANDLERS: "Choose either transaction or transactionMetadata, not both.",
  FILTER_REQUIRES_TRANSACTION_HANDLER: "Configure a transaction, transactionMetadata or receipt handler when filtering transactions. Block handlers still run for every block.",
  SHIELDED_CONFIG_AND_RECEIPT_HANDLER_REQUIRED: "Configure shielded and a receipt handler together. Private receipt scanning is opt-in.",
  INVALID_SHIELDED_CONFIG: "Use testnet, a bounded accountId, the inspected keyFingerprint, optional environment variable names and a 100..120000 ms timeout.",
  TESTNET_RECEIPT_SOURCE_REQUIRED: "Use a configured testnet ReceiptSource with an explicit account and key fingerprint.",
  RECEIPT_HANDLER_REQUIRED: "Provide a receipt handler when a ReceiptSource is configured.",
  SCANNER_EXECUTABLE_AND_KEY_FILE_REQUIRED: "Set ZEER_SCANNER_EXECUTABLE and ZEER_VIEWING_KEY_FILE to absolute local paths. Keep viewing keys outside the checkout and public API.",
  SCANNER_PATHS_MUST_BE_ABSOLUTE: "Use absolute paths for the native scanner executable and protected UFVK file.",
  INVALID_SCANNER_IDENTITY: "Use the account and fingerprint returned by zeer-scanner inspect-key for the testnet UFVK.",
  INVALID_SCANNER_TIMEOUT: "Set a scanner timeout between 100 and 120000 ms.",
  SHIELDED_SCAN_UNAVAILABLE: "The scan did not complete; its application batch was not committed. Check the local scanner/key identity and supported branch, then restart sync from the retained checkpoint.",
  CONFIG_FILE_UNREADABLE: "Create the configuration file or pass its location with --config.",
  SCHEMA_FILE_UNREADABLE: "Check the schema path relative to the configuration file.",
  PREP_URL_AND_DATABASE_URL_REQUIRED: "Set PREP_URL and DATABASE_URL, or the environment names selected by the config.",
  INVALID_PREP_URL: "Set PREP_URL to a supported HTTP(S) endpoint without URL credentials.",
  CHEF_API_TOKEN_REQUIRED_MIN_16_BYTES: "Set CHEF_API_TOKEN to at least 16 bytes before serving GraphQL.",
  MIGRATION_REQUIRED: "Run migrate explicitly with the same configuration and database before this command.",
  PROJECT_IDENTITY_MISMATCH: "Restore the original configuration or choose a fresh project namespace and replay. Do not reset the existing namespace automatically.",
  WRITER_ALREADY_ACTIVE: "Stop the other writer for this project before starting sync.",
  REBUILD_REQUIRED: "Keep the blocked namespace for inspection. Choose a fresh project name, migrate, replay from a source covering startHeight, and verify before switching readers.",
  SOURCE_UNAVAILABLE: "Check the source node and Prep service; inspect status and retry after Prep becomes ready.",
  SOURCE_HISTORY_UNAVAILABLE: "Provide a Prep archive covering the configured startHeight or choose a fresh project with an available startHeight.",
  RECONCILIATION_REQUIRED: "Run sync against the expected Prep source to validate the retained checkpoint and reconcile. Do not reset the namespace automatically.",
  REQUESTED_RANGE_NOT_AVAILABLE: "Choose --to within Prep's indexed height or let Prep ingest the requested blocks first.",
  REQUESTED_RANGE_NOT_COMPLETE: "Inspect status and source coverage, then retry the incomplete range.",
  SOURCE_NETWORK_OR_KIND_MISMATCH: "Use a full-v1 Prep archive on the configured network; restore the expected endpoint before retrying.",
  PREP_UNAUTHORIZED: "Check PREP_API_TOKEN against the Prep service token; never put credentials in a URL.",
  PREP_PROTOCOL_ERROR: "Check Prep/client compatibility and the expected endpoint, then retry.",
  SOURCE_CHANGED_DURING_REPLAY: "Retry reconciliation against a stable Prep archive; inspect status if it persists.",
  CHEF_COMMAND_FAILED: "Check configuration, explicit migration, database access and source readiness. Third-party error details are intentionally omitted.",
};

export function cliFailure(error: unknown, knownCode?: string): { error: { code: string }; help: string } {
  const otherCodes = ["UNKNOWN_COMMAND", "INVALID_POLL_SECONDS", "CONFIG_TOO_LARGE", "INVALID_REORG_WINDOW", "INVALID_END_HEIGHT", "INVALID_PORT", "INVALID_ENV_NAME", "INVALID_RUNTIME_OPTIONS", "INVALID_PAGE_SIZE", "INVALID_PREP_RANGE", "INCOMPLETE_PREP_BLOCKS", "INVALID_PREP_BLOCK", "INVALID_PREP_TRANSACTION", "INVALID_PREP_TRANSACTION_ORDER", "MISSING_COINBASE_OR_TRANSACTIONS", "NONCONTIGUOUS_PREP_CHAIN", "INVALID_SOURCE_HEADER"];
  let code = knownCode && (Object.hasOwn(guidance, knownCode) || otherCodes.includes(knownCode)) ? knownCode : undefined;
  if (!code && error instanceof PrepError) {
    code = error.code === "REORG" ? "SOURCE_CHANGED_DURING_REPLAY"
      : error.status === 401 || error.status === 403 ? "PREP_UNAUTHORIZED"
      : error.code === "TRANSPORT_ERROR" || error.status === 429 || error.status >= 500 ? "SOURCE_UNAVAILABLE" : "PREP_PROTOCOL_ERROR";
  }
  if (!code && error instanceof DOMException && error.name === "TimeoutError") code = "SOURCE_UNAVAILABLE";
  if (!code && error && typeof error === "object") {
    const detail = error as { code?: unknown; message?: unknown };
    if (detail.code === "42P01" || detail.code === "3F000"
      || detail.message === "Chef state migration required; run migrate before restarting this version"
      || detail.message === "Chef consumption migration required; stop writers and run migrate") code = "MIGRATION_REQUIRED";
    else if (detail.message === "Chef project identity mismatch; use a new project namespace") code = "PROJECT_IDENTITY_MISMATCH";
    else if (detail.message === "Chef project already has an active writer" || detail.message === "Stop the project writer before consumption migration") code = "WRITER_ALREADY_ACTIVE";
  }
  code ??= "CHEF_COMMAND_FAILED";
  return { error: { code }, help: guidance[code] ?? "Check --help and the configuration values before retrying." };
}

export function sourceObservation(meta: Height, checkpoint: Checkpoint, network: string, startHeight: number) {
  const identityMatches = meta.network === network && meta.payload_kind === "full-v1";
  const usable = identityMatches && meta.ready && meta.archive_height !== null && meta.archive_height >= startHeight && meta.start_block <= startHeight;
  const observed = identityMatches && meta.ready && meta.source_mode === "follower";
  const indexedHeight = identityMatches ? meta.indexed_height : null;
  const next = checkpoint.height === null ? startHeight : checkpoint.height + 1;
  return {
    availability: "available" as const, ready: meta.ready, usable, identityMatches,
    historyAvailable: identityMatches && meta.start_block <= startHeight,
    archiveStart: identityMatches ? meta.start_block : null,
    checkpointAheadOfPrep: identityMatches && checkpoint.height !== null && meta.archive_height !== null && checkpoint.height > meta.archive_height,
    indexedHeight, archiveHeight: identityMatches ? meta.archive_height : null,
    sourceMode: meta.source_mode === "follower" ? "follower" : meta.source_mode === "historical_snapshot" ? "historical_snapshot" : "unknown",
    freshness: observed && meta.source_height !== null ? "observed" : "unknown",
    sourceHeight: observed ? meta.source_height : null,
    sourceObservedAt: observed ? meta.source_observed_at : null,
    prepSourceLagBlocks: observed ? meta.lag_blocks : null,
    chefPrepLagBlocks: indexedHeight === null ? null : Math.max(0, indexedHeight - next + 1),
    epoch: identityMatches ? meta.epoch : null,
  };
}

/** A diagnostic observation does not change the durable read gate or acquire a writer. */
export async function readStatus(options: {
  store: Pick<ChefStore, "checkpoint">; client: Pick<PrepClient, "getHeight">;
  network: string; startHeight: number; signal?: AbortSignal;
}) {
  const checkpoint = await options.store.checkpoint();
  let source: ReturnType<typeof sourceObservation> | { availability: "unavailable"; errorCode: string };
  try {
    source = sourceObservation(await options.client.getHeight({ signal: options.signal, timeoutMs: 5000 }), checkpoint, options.network, options.startHeight);
  } catch (error) {
    options.signal?.throwIfAborted();
    source = { availability: "unavailable", errorCode: cliFailure(error).error.code };
  }
  const state = checkpoint.status === "blocked" ? "blocked"
    : source.availability === "unavailable" ? "source_unavailable"
    : !source.identityMatches ? "source_mismatch"
    : !source.usable ? "source_not_ready"
    : checkpoint.status === "reconciling" ? "reconciling"
    : source.checkpointAheadOfPrep ? "reconciliation_needed"
    : source.chefPrepLagBlocks === 0 ? "caught_up" : "backfill";
  return { checkpoint, state, readGate: checkpoint.status, source, invocationMode: "status" };
}

export function formatOutput(value: Record<string, unknown>, human: boolean): string {
  if (!human) return `${JSON.stringify(value)}\n`;
  if (value.error) {
    const error = value.error as { code: string };
    return `Chef error: ${error.code}\n${value.help}\n`;
  }
  const lines = [`Chef ${value.command}: ${value.state ?? value.status ?? "status"}${value.project ? ` (${value.project})` : ""}`];
  if (value.role) lines.push(`Process: ${value.role}`);
  if (value.command === "doctor" && Array.isArray(value.checks)) {
    for (const check of value.checks as Array<{name:string;status:string;code:string;help:string}>) {
      lines.push(`${check.status.toUpperCase()} ${check.name}: ${check.code}`, `  ${check.help}`);
    }
  }
  if (value.status === "typecheck_skipped") lines.push("No tsconfig.json; JavaScript is validated at startup, without a TypeScript check.");
  if (value.command === "dev") {
    const checkpoint = value.checkpoint as {height?: number;status?: string} | undefined;
    if (checkpoint) lines.push(`Persisted checkpoint: ${checkpoint.height ?? "none"}; read gate: ${checkpoint.status}`);
    const source = value.source as {availability?: string;indexedHeight?: number;chefPrepLagBlocks?:number} | undefined;
    if (source) lines.push(`Prep: ${source.availability}; indexed height: ${source.indexedHeight ?? "unknown"}; Chef lag: ${source.chefPrepLagBlocks ?? "unknown"} blocks`);
    if (value.host) lines.push(`Listening: ${value.host}:${value.port}`);
    return `${lines.join("\n")}\n`;
  }
  const checkpoint = value.checkpoint as Checkpoint | undefined;
  if (checkpoint) lines.push(`Persisted checkpoint: ${checkpoint.height ?? "none"}; read gate: ${checkpoint.status}`);
  if (value.invocationMode) lines.push(`Invocation: ${value.invocationMode}${value.targetHeight === undefined ? "" : `; target: ${value.targetHeight}`}`);
  const source = value.source as ReturnType<typeof sourceObservation> | { availability: "unavailable"; errorCode?: string } | undefined;
  if (source?.availability === "unavailable") lines.push(`Prep: unavailable${source.errorCode ? ` (${source.errorCode})` : ""}; source tip: unknown`);
  else if (source) {
    lines.push(`Prep: available; ready: ${source.ready}; indexed height: ${source.indexedHeight ?? "unknown"}; mode: ${source.sourceMode}`);
    lines.push(`Chef lag to Prep: ${source.chefPrepLagBlocks ?? "unknown"} blocks; source tip: ${source.sourceHeight ?? "unknown"}${source.sourceHeight === null ? "" : " (last Prep observation)"}`);
    if (source.checkpointAheadOfPrep) lines.push("Checkpoint is ahead of Prep's archive; sync must validate the retained branch.");
    if (source.sourceObservedAt !== null) lines.push(`Source observation time (Unix seconds): ${source.sourceObservedAt}`);
    if (source.freshness === "unknown") lines.push("Source freshness: unknown; an archive snapshot does not establish the current node tip.");
  }
  if (value.metricsScope === "completed_pages") lines.push(`Invocation totals for completed pages: ${value.blocks} blocks, ${value.transactions} transactions; persisted checkpoint includes any committed partial page.`);
  if (value.output) lines.push(`Generated file: ${value.output}`);
  if (value.directory) lines.push(`Project directory: ${value.directory}`);
  if (value.command === "init" && value.startHeight !== undefined) lines.push(`Start block: ${value.startHeight}${value.startSelection === "latest_indexed" ? " (latest indexed height captured from Prep)" : " (explicit)"}`);
  if (Array.isArray(value.nextSteps)) for (const step of value.nextSteps) lines.push(String(step));
  if (value.host) lines.push(`Listening: ${value.host}:${value.port}`);
  return `${lines.join("\n")}\n`;
}
