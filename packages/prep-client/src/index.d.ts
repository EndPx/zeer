export type BlockField = "height" | "hash" | "previous_hash" | "time" | "raw" | "decoded";
export type TransactionField = "txid" | "block_height" | "index" | "version" | "locktime" | "size_bytes" | "transparent_input_count" | "transparent_output_count" | "raw" | "vin" | "vout" | "decoded";
export interface Query {
  from_block: number;
  /** Exclusive. Omit to capture the indexed head on the first request. */
  to_block?: number | null;
  /** Number of whole blocks scanned, not number of matching transactions. */
  limit?: number;
  field_selection?: { block?: BlockField[]; transaction?: TransactionField[] };
  transaction_filter?: { txids?: string[] | null; versions?: number[] | null; has_sapling?: boolean | null; has_orchard?: boolean | null; transparent_output_addresses?: string[] | null };
  cursor?: string | null;
}
export interface QueryResult {
  archive_height: number | null;
  network: "mainnet" | "testnet" | "regtest";
  epoch: string;
  revision: string;
  from_block: number;
  to_block: number;
  next_block: number;
  cursor: string | null;
  canonicality: string;
  data: { blocks: Record<string, unknown>[]; transactions: Record<string, unknown>[] };
}
export interface Height {
  archive_height: number | null;
  indexed_height: number | null;
  source_height: number | null;
  lag_blocks: number | null;
  source_observed_at: number | null;
  start_block: number;
  network: "mainnet" | "testnet" | "regtest";
  epoch: string;
  revision: string;
  payload_kind: string;
  ready: boolean;
  source_mode: string;
  state: string;
  canonicality: string;
}
export interface RequestOptions { signal?: AbortSignal; timeoutMs?: number }
export interface StreamOptions extends RequestOptions { totalTimeoutMs?: number; maxPages?: number }
export class PrepError extends Error { readonly code: string; readonly status: number; constructor(code: string, status?: number) }
export class ReorgError extends PrepError { constructor() }
export class ProtocolError extends PrepError { constructor(code?: string) }
export class PrepClient {
  constructor(options: { url: string; token?: string; timeoutMs?: number; fetch?: typeof globalThis.fetch });
  getHeight(options?: RequestOptions): Promise<Height>;
  get(query: Query, options?: RequestOptions): Promise<QueryResult>;
  stream(query: Query, options?: StreamOptions): AsyncGenerator<QueryResult, void, unknown>;
}
