import { readFileSync } from "node:fs";
import type { Checkpoint } from "./types.js";

export interface ArtifactIdentity {
  packageName: "@zeer-dev/chef";
  packageVersion: string;
  buildCommit: string | "unknown";
  sourceState: "clean" | "modified" | "unknown";
}

/** Only build-produced provenance is accepted; installed-folder Git state is never consulted. */
export function normalizeArtifactIdentity(value: unknown): ArtifactIdentity {
  const unknown: ArtifactIdentity = { packageName: "@zeer-dev/chef", packageVersion: "unknown", buildCommit: "unknown", sourceState: "unknown" };
  if (!value || typeof value !== "object" || Array.isArray(value)) return unknown;
  const item = value as Record<string, unknown>;
  if (item.packageName !== unknown.packageName || item.schemaVersion !== 1) return unknown;
  const buildCommit = typeof item.buildCommit === "string" && /^[a-f0-9]{40}$/.test(item.buildCommit) ? item.buildCommit : "unknown";
  return {
    packageName: unknown.packageName,
    packageVersion: typeof item.packageVersion === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(item.packageVersion) && item.packageVersion.length <= 80 ? item.packageVersion : "unknown",
    buildCommit,
    sourceState: buildCommit !== "unknown" && (item.sourceState === "clean" || item.sourceState === "modified") ? item.sourceState : "unknown",
  };
}

let installedIdentity: ArtifactIdentity;
try { installedIdentity = normalizeArtifactIdentity(JSON.parse(readFileSync(new URL("./build-identity.json", import.meta.url), "utf8"))); }
catch { installedIdentity = normalizeArtifactIdentity(null); }

export function artifactIdentity(): ArtifactIdentity { return { ...installedIdentity }; }

export interface DiagnosticAction {
  category: "none" | "wait_for_source" | "retry_transient" | "fix_authentication" | "fix_configuration" | "restore_source_identity" | "reconcile" | "rebuild" | "inspect";
  retryPolicy: "not_applicable" | "bounded_operator_policy" | "after_operator_correction";
}

/** Fixed vocabulary only. This advice does not change the follower's retry or read-gate policy. */
export function diagnosticAction(code: string): DiagnosticAction {
  if (code === "OK") return { category: "none", retryPolicy: "not_applicable" };
  if (["PREP_UNAUTHORIZED", "DATABASE_UNAUTHORIZED"].includes(code)) return { category: "fix_authentication", retryPolicy: "after_operator_correction" };
  if (["PREP_RATE_LIMITED", "PREP_TIMEOUT", "PREP_TRANSPORT_UNAVAILABLE", "DATABASE_UNAVAILABLE", "DOCTOR_CHECK_TIMEOUT"].includes(code)) return { category: "retry_transient", retryPolicy: "bounded_operator_policy" };
  if (code === "SOURCE_CHANGED_DURING_REPLAY") return { category: "reconcile", retryPolicy: "bounded_operator_policy" };
  if (["SOURCE_UNAVAILABLE", "REQUESTED_RANGE_NOT_AVAILABLE", "REQUESTED_RANGE_NOT_COMPLETE"].includes(code)) return { category: "wait_for_source", retryPolicy: "bounded_operator_policy" };
  if (code === "SOURCE_NETWORK_OR_KIND_MISMATCH") return { category: "restore_source_identity", retryPolicy: "after_operator_correction" };
  if (["RECONCILIATION_REQUIRED", "DEV_RECONCILIATION_REQUIRED"].includes(code)) return { category: "reconcile", retryPolicy: "after_operator_correction" };
  if (code === "REBUILD_REQUIRED") return { category: "rebuild", retryPolicy: "after_operator_correction" };
  if (["PROJECT_IDENTITY_MISMATCH", "SOURCE_HISTORY_UNAVAILABLE", "MIGRATION_REQUIRED", "PREP_PROTOCOL_ERROR"].includes(code)
    || /^(INVALID_|DOCTOR_KEY_FILE_|DOCTOR_SCANNER_|SCANNER_|PREP_URL_|CHEF_API_TOKEN_|CONFIG_|SCHEMA_)/.test(code)) return { category: "fix_configuration", retryPolicy: "after_operator_correction" };
  return { category: "inspect", retryPolicy: "after_operator_correction" };
}

type DiagnosticSource = {
  availability: "available"; archiveStart: number | null; archiveHeight: number | null;
  indexedHeight: number | null; sourceObservedAt: number | null; sourceHeight: number | null;
} | { availability: "unavailable"; errorCode: string };

/** Age belongs to the last Prep observation, not to the instant this command contacted Prep. */
export function operatorDiagnostic(options: {
  project?: string; network: string; startHeight: number; checkpoint?: Checkpoint;
  source?: DiagnosticSource; code: string; nowSeconds?: number; lastCommitAt?: string | null;
  projectGeneration?: string; dataRevision?: string;
}) {
  const now = options.nowSeconds ?? Date.now() / 1000;
  const at = options.source?.availability === "available" ? options.source.sourceObservedAt : null;
  const valid = typeof at === "number" && Number.isFinite(at) && at >= 0 && Number.isFinite(now);
  const clock = !valid ? "unknown" : at > now ? "future_observation" : "ordered";
  const committed = options.lastCommitAt && Number.isFinite(Date.parse(options.lastCommitAt)) ? new Date(options.lastCommitAt).toISOString() : null;
  const height = (value: unknown): number | null => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffffffff ? value : null;
  const hash = (value: unknown): string | null => typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : null;
  return {
    artifact: artifactIdentity(), project: options.project && /^[a-z][a-z0-9_]{0,31}$/.test(options.project) ? options.project : "unknown",
    network: ["testnet", "mainnet", "regtest"].includes(options.network) ? options.network : "unknown",
    configuredStartHeight: height(options.startHeight),
    coverage: options.source?.availability === "available" ? {
      archiveStartHeight: height(options.source.archiveStart), archiveHeight: height(options.source.archiveHeight),
      prepIndexedHeight: height(options.source.indexedHeight),
    } : { archiveStartHeight: null, archiveHeight: null, prepIndexedHeight: null },
    checkpoint: options.checkpoint ? { height: height(options.checkpoint.height), hash: hash(options.checkpoint.hash),
      anchorHash: hash(options.checkpoint.anchorHash), status: ["ready", "reconciling", "blocked"].includes(options.checkpoint.status) ? options.checkpoint.status : "unknown",
      ...(options.checkpoint.undoFloor === undefined ? {} : { undoFloor: options.checkpoint.undoFloor === -1 ? -1 : height(options.checkpoint.undoFloor) }),
      ...(options.checkpoint.reconcileKind === undefined ? {} : { reconcileKind: ["source", "reorg", "unknown"].includes(options.checkpoint.reconcileKind) ? options.checkpoint.reconcileKind : "unknown" }) } : null,
    observedAt: Number.isFinite(now) ? now : null,
    sourceObservedAt: valid ? at : null,
    sourceObservationAgeSeconds: clock === "ordered" ? now - at! : null,
    observationClock: clock,
    lastCommitAt: committed,
    projectGeneration: options.projectGeneration && /^[0-9a-f-]{36}$/.test(options.projectGeneration) ? options.projectGeneration : "unknown",
    dataRevision: options.dataRevision && /^(0|[1-9][0-9]*)$/.test(options.dataRevision) ? options.dataRevision : "unknown",
    action: diagnosticAction(options.code),
  };
}
