import type { Query } from "@zeer-dev/prep-client";
export type Scalar = "ID" | "String" | "Boolean" | "Int" | "BigInt";
export interface Field { name: string; scalar: Scalar; required: boolean; indexed?: true; list?: { itemRequired: boolean }; reference?: string; derivedFrom?: string }
export interface EntityDefinition { name: string; fields: Record<string, Field> }
export interface Model { entities: Record<string, EntityDefinition>; fingerprint: string }
export type StoredScalar = string | number | boolean | null;
export type StoredEntity = Record<string, StoredScalar | StoredScalar[]> & { id: string };
export interface EntityRange { field: string; gte?: number; lte?: number }
export interface EntityOrder { field: string; direction: "ASC" | "DESC" }
export interface ListOptions {
  first: number; after?: string; where?: Record<string, unknown>;
  range?: EntityRange; order?: EntityOrder; position?: { id: string; value?: number };
}
export interface EntityAccess<E extends object = Record<string, Record<string, unknown>>> {
  get<K extends keyof E & string>(entity: K, id: string): Promise<E[K] | null>;
  set<K extends keyof E & string>(entity: K, value: E[K]): Promise<void>;
  delete<K extends keyof E & string>(entity: K, id: string): Promise<void>;
}
export interface PublicBlock { height: number; hash: string; previousHash: string; time: number }
export interface PublicTransaction { txid: string; index: number; version: number; locktime: number; blockHeight: number; decoded: Record<string, unknown>; raw?: string }
export type TransactionMetadata = Omit<PublicTransaction, "decoded">;
export interface ShieldedReceipt {
  id: string; account_id: string; network: "testnet"; txid: string; pool: "sapling" | "orchard" | "ironwood";
  output_index: number; height: number; receiver: string; receiver_type: "sapling" | "orchard";
  value_zat: string; memo_hex: string; scope: "external" | "internal"; origin: "unknown"; is_coinbase: boolean;
}
export interface ReceiptSource {
  readonly identity: string; readonly accountId: string; readonly keyFingerprint: string;
  scan(input: { block: PublicBlock; transaction: TransactionMetadata & { raw: string } }, signal?: AbortSignal): Promise<ShieldedReceipt[]>;
  close(): Promise<void>;
}
export interface ShieldedConfig { accountId: string; keyFingerprint: string; executableEnv?: string; keyFileEnv?: string; timeoutMs?: number }
export interface SyncOptions {
  /** Blocks fetched per page, 1..1000, or up to 1,000,000 with adaptiveScan. Defaults to 16. */
  pageSize?: number;
  /** Requires a Prep server advertising adaptive scans; checkpoints still verify all headers. */
  adaptiveScan?: boolean;
  /** Blocks per atomic database commit, 1..100. Defaults to 1. */
  batchSize?: number;
  /** Public-data predicates applied by Prep before returning transactions. */
  transactionFilter?: NonNullable<Query["transaction_filter"]>;
}
export interface HandlerContext<E extends object> { entities: EntityAccess<E> }
export interface Indexer<E extends object = Record<string, Record<string, unknown>>> {
  /** Private readable-note observations. Internal scope can be change; external origin remains unknown. */
  receipt?: (args: { block: PublicBlock; transaction: TransactionMetadata; receipt: ShieldedReceipt; context: HandlerContext<E> }) => Promise<void> | void;
  block?: (args: { block: PublicBlock; context: HandlerContext<E> }) => Promise<void> | void;
  transaction?: (args: { block: PublicBlock; transaction: PublicTransaction; context: HandlerContext<E> }) => Promise<void> | void;
  /** Lightweight alternative to transaction; the two handlers are mutually exclusive. */
  transactionMetadata?: (args: { block: PublicBlock; transaction: TransactionMetadata; context: HandlerContext<E> }) => Promise<void> | void;
}
export interface Checkpoint { height: number | null; hash: string | null; anchorHash: string | null; status: "ready" | "reconciling" | "blocked"; reconcileKind?: "source" | "reorg" | "unknown"; undoFloor?: number }
export interface SourceObservation {
  status: "available" | "unavailable";
  prepIndexedHeight: number | null; sourceObservedHeight: number | null;
  /** Unix seconds reported by Prep, not the time of this API request. */
  sourceObservedAt: number | null;
}
export interface ConsumptionStatus {
  project: string; generation: string; revision: string; checkpoint: Checkpoint;
  /** Database timestamp recorded in the committing transaction, not an fsync measurement. */
  lastCommitAt: string | null;
  source: Omit<SourceObservation, "status"> & { status: "unknown" | SourceObservation["status"]; checkedAt: string | null };
}
export interface ReadView {
  get(entity: string, id: string): Promise<StoredEntity | null>;
  list(entity: string, options: ListOptions): Promise<StoredEntity[]>;
  checkpoint: Checkpoint;
  /** Same repeatable-read snapshot as the entities. Required for cursor pagination. */
  consumption?: ConsumptionStatus;
}
export interface ChefStore {
  migrate(): Promise<void>;
  acquire(): Promise<void>;
  release(): Promise<void>;
  checkpoint(): Promise<Checkpoint>;
  consumptionStatus?(): Promise<ConsumptionStatus>;
  recordSourceObservation?(observation: SourceObservation): Promise<void>;
  blockHash(height: number): Promise<string | null>;
  apply(block: PublicBlock, handler: (entities: EntityAccess) => Promise<void>): Promise<void>;
  applyBatch?(blocks: PublicBlock[], handler: (block: PublicBlock, entities: EntityAccess) => Promise<void>): Promise<void>;
  markReconciling(kind?: "source" | "reorg"): Promise<void>;
  rollback(height: number, hash: string): Promise<void>;
  markReady(): Promise<void>;
  markBlocked(): Promise<void>;
  read<T>(handler: (view: ReadView) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export interface StoreOptions { project: string; fingerprint: string; startHeight: number; network: "mainnet" | "testnet" | "regtest"; reorgWindow: number; model: Model }
export interface ChefConfig<E extends object = Record<string, Record<string, unknown>>> {
  project: string;
  network: "mainnet" | "testnet" | "regtest";
  startHeight: number;
  schema: string;
  handlerVersion: string;
  prepUrlEnv?: string;
  prepTokenEnv?: string;
  databaseUrlEnv?: string;
  reorgWindow?: number;
  sync?: SyncOptions;
  shielded?: ShieldedConfig;
  indexer: Indexer<E>;
}
