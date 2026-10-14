export type Scalar = "ID" | "String" | "Boolean" | "Int" | "BigInt";
export interface Field { name: string; scalar: Scalar; required: boolean; indexed?: true }
export interface EntityDefinition { name: string; fields: Record<string, Field> }
export interface Model { entities: Record<string, EntityDefinition>; fingerprint: string }
export type StoredEntity = Record<string, string | number | boolean | null> & { id: string };
export interface ListOptions { first: number; after?: string; where?: Record<string, unknown> }
export interface EntityAccess<E extends object = Record<string, Record<string, unknown>>> {
  get<K extends keyof E & string>(entity: K, id: string): Promise<E[K] | null>;
  set<K extends keyof E & string>(entity: K, value: E[K]): Promise<void>;
  delete<K extends keyof E & string>(entity: K, id: string): Promise<void>;
}
export interface PublicBlock { height: number; hash: string; previousHash: string; time: number }
export interface PublicTransaction { txid: string; index: number; version: number; locktime: number; blockHeight: number; decoded: Record<string, unknown> }
export interface HandlerContext<E extends object> { entities: EntityAccess<E> }
export interface Indexer<E extends object = Record<string, Record<string, unknown>>> {
  block?: (args: { block: PublicBlock; context: HandlerContext<E> }) => Promise<void> | void;
  transaction?: (args: { block: PublicBlock; transaction: PublicTransaction; context: HandlerContext<E> }) => Promise<void> | void;
}
export interface Checkpoint { height: number | null; hash: string | null; anchorHash: string | null; status: "ready" | "reconciling" | "blocked" }
export interface ReadView {
  get(entity: string, id: string): Promise<StoredEntity | null>;
  list(entity: string, options: ListOptions): Promise<StoredEntity[]>;
  checkpoint: Checkpoint;
}
export interface ChefStore {
  migrate(): Promise<void>;
  acquire(): Promise<void>;
  release(): Promise<void>;
  checkpoint(): Promise<Checkpoint>;
  blockHash(height: number): Promise<string | null>;
  apply(block: PublicBlock, handler: (entities: EntityAccess) => Promise<void>): Promise<void>;
  markReconciling(): Promise<void>;
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
  indexer: Indexer<E>;
}
