import { PrepClient, PrepError, ReorgError } from "@zeer/prep-client";
import type { Height, QueryResult } from "@zeer/prep-client";
import type { ChefStore, EntityAccess, Indexer, PublicBlock, PublicTransaction } from "./types.js";

export class ChefError extends Error {
  constructor(readonly code: string) { super(code); this.name = "ChefError"; }
}
const hash = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const uint = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 0xffffffff;
function requireValue(ok: unknown, code: string): asserts ok { if (!ok) throw new ChefError(code); }
export interface RuntimeOptions<E extends object> {
  client: Pick<PrepClient, "get" | "getHeight">;
  store: ChefStore;
  indexer: Indexer<E>;
  network: "mainnet" | "testnet" | "regtest";
  startHeight: number;
  reorgWindow: number;
  pageSize?: number;
  signal?: AbortSignal;
}
export interface SyncResult {
  state: "progress" | "caught_up" | "source_unavailable";
  blocks: number; transactions: number; height: number | null;
  sourceHeight: number | null; sourceEpoch: string;
  fetchMs: number; handlerIncludingEntityIoMs: number; transactionOverheadMs: number;
}

export function decodePage(page: QueryResult, from: number, to: number): { block: PublicBlock; transactions: PublicTransaction[] }[] {
  requireValue(page.from_block === from && page.next_block > from && page.next_block <= to, "INVALID_PREP_RANGE");
  requireValue(page.data.blocks.length === page.next_block - from, "INCOMPLETE_PREP_BLOCKS");
  const batches = page.data.blocks.map((raw, index) => {
    requireValue(raw.height === from + index && hash(raw.hash) && hash(raw.previous_hash) && uint(raw.time), "INVALID_PREP_BLOCK");
    const block: PublicBlock = { height: from + index, hash: raw.hash, previousHash: raw.previous_hash, time: raw.time };
    return { block, transactions: [] as PublicTransaction[] };
  });
  let lastHeight = from;
  for (const raw of page.data.transactions) {
    requireValue(uint(raw.block_height) && raw.block_height >= from && raw.block_height < page.next_block
      && raw.block_height >= lastHeight && uint(raw.index) && uint(raw.version) && uint(raw.locktime)
      && hash(raw.txid) && raw.decoded !== null && typeof raw.decoded === "object" && !Array.isArray(raw.decoded), "INVALID_PREP_TRANSACTION");
    const target = batches[raw.block_height - from]!;
    requireValue(raw.index === target.transactions.length, "INVALID_PREP_TRANSACTION_ORDER");
    target.transactions.push({ txid: raw.txid, index: raw.index, version: raw.version, locktime: raw.locktime,
      blockHeight: raw.block_height, decoded: raw.decoded as Record<string, unknown> });
    lastHeight = raw.block_height;
  }
  for (let index = 0; index < batches.length; index++) {
    requireValue(batches[index]!.transactions.length > 0, "MISSING_COINBASE_OR_TRANSACTIONS");
    if (index) requireValue(batches[index]!.block.previousHash === batches[index - 1]!.block.hash, "NONCONTIGUOUS_PREP_CHAIN");
  }
  return batches;
}

/** One bounded page; PostgreSQL is the authoritative application checkpoint. */
export async function syncStep<E extends object>(options: RuntimeOptions<E>, endHeight?: number): Promise<SyncResult> {
  const { client, store, signal } = options;
  requireValue(uint(options.startHeight) && Number.isInteger(options.reorgWindow)
    && options.reorgWindow >= 1 && options.reorgWindow <= 1000, "INVALID_RUNTIME_OPTIONS");
  const limit = options.pageSize ?? 16;
  requireValue(Number.isInteger(limit) && limit >= 1 && limit <= 100, "INVALID_PAGE_SIZE");
  let checkpoint = await store.checkpoint();
  if (checkpoint.status === "blocked") throw new ChefError("REBUILD_REQUIRED");
  let fetchMs = 0;
  const fetched = async <T>(read: () => Promise<T>): Promise<T> => {
    const start = performance.now();
    try { return await read(); }
    catch (error) { await store.markReconciling(error instanceof ReorgError ? "reorg" : "source"); throw error; }
    finally { fetchMs += performance.now() - start; }
  };
  signal?.throwIfAborted();
  const meta: Height = await fetched(() => client.getHeight({ signal }));
  if (meta.network !== options.network || meta.payload_kind !== "full-v1") {
    await store.markReconciling(); throw new ChefError("SOURCE_NETWORK_OR_KIND_MISMATCH");
  }
  const base = { blocks: 0, transactions: 0, height: checkpoint.height, sourceHeight: meta.archive_height,
    sourceEpoch: meta.epoch, fetchMs, handlerIncludingEntityIoMs: 0, transactionOverheadMs: 0 };
  if (!meta.ready || meta.archive_height === null || meta.archive_height < options.startHeight) {
    await store.markReconciling("source");
    return { ...base, state: "source_unavailable" };
  }
  requireValue(meta.start_block <= options.startHeight, "SOURCE_HISTORY_UNAVAILABLE");
  if (endHeight !== undefined) requireValue(uint(endHeight) && endHeight >= options.startHeight, "INVALID_END_HEIGHT");
  const target = Math.min(endHeight ?? meta.archive_height, meta.archive_height);
  const header = async (height: number): Promise<PublicBlock> => {
    const page = await fetched(() => client.get({ from_block: height, to_block: height + 1, limit: 1,
      field_selection: { block: ["height", "hash", "previous_hash", "time"], transaction: [] } }, { signal }));
    if (page.epoch !== meta.epoch) { await store.markReconciling(); throw new ReorgError(); }
    requireValue(page.network === options.network && page.data.blocks.length === 1 && page.next_block === height + 1, "INVALID_SOURCE_HEADER");
    const raw = page.data.blocks[0]!;
    requireValue(raw.height === height && hash(raw.hash) && hash(raw.previous_hash) && uint(raw.time), "INVALID_SOURCE_HEADER");
    return { height, hash: raw.hash, previousHash: raw.previous_hash, time: raw.time };
  };
  if (checkpoint.height !== null) {
    const current = checkpoint.height <= meta.archive_height ? await header(checkpoint.height) : null;
    if (!current || current.hash !== checkpoint.hash) {
      await store.markReconciling();
      // Genesis has no predecessor block to roll back to. A changed genesis is
      // a source identity failure, not a reorg across a synthetic height -1.
      const floor = Math.max(0, options.startHeight - 1, checkpoint.height - options.reorgWindow);
      // Prep can publish a shorter prefix while rebuilding replacement segments.
      // Wait if the follower's observed source can still supply our retained
      // window; missing published history is not proof of an unrecoverable fork.
      if (meta.source_mode === "follower" && meta.archive_height < floor
        && uint(meta.source_height) && meta.source_height >= floor) {
        return { ...base, fetchMs, state: "source_unavailable" };
      }
      let ancestor: { height: number; hash: string } | null = null;
      for (let height = Math.min(checkpoint.height, meta.archive_height); height >= floor; height--) {
        signal?.throwIfAborted();
        const local = height === options.startHeight - 1 ? checkpoint.anchorHash : await store.blockHash(height);
        if (local === null) break;
        const canonical = height === options.startHeight - 1 ? (await header(options.startHeight)).previousHash : (await header(height)).hash;
        if (local === canonical) { ancestor = { height, hash: local }; break; }
      }
      if (!ancestor) { await store.markBlocked(); throw new ChefError("REBUILD_REQUIRED"); }
      await store.rollback(ancestor.height, ancestor.hash);
      checkpoint = await store.checkpoint();
    }
  }
  if (checkpoint.height === null && checkpoint.anchorHash !== null) {
    if ((await header(options.startHeight)).previousHash !== checkpoint.anchorHash) {
      await store.markBlocked(); throw new ChefError("REBUILD_REQUIRED");
    }
  }
  const next = checkpoint.height === null ? options.startHeight : checkpoint.height + 1;
  if (next > target) {
    if (checkpoint.status === "reconciling") await store.markReady();
    return { ...base, height: checkpoint.height, fetchMs, state: "caught_up" };
  }
  const page = await fetched(() => client.get({ from_block: next, to_block: target + 1, limit,
    field_selection: { block: ["height", "hash", "previous_hash", "time"],
      transaction: ["txid", "block_height", "index", "version", "locktime", "decoded"] } }, { signal }));
  if (page.epoch !== meta.epoch) { await store.markReconciling(); throw new ReorgError(); }
  requireValue(page.network === options.network, "SOURCE_NETWORK_OR_KIND_MISMATCH");
  const batches = decodePage(page, next, target + 1);
  let handlerMs = 0, applyMs = 0, transactionCount = 0;
  for (const { block, transactions } of batches) {
    signal?.throwIfAborted();
    const applyStart = performance.now();
    await store.apply(block, async (entities) => {
      const context = { entities: entities as EntityAccess<E> };
      const start = performance.now();
      try {
        await options.indexer.block?.({ block, context });
        for (const transaction of transactions) await options.indexer.transaction?.({ block, transaction, context });
      } finally { handlerMs += performance.now() - start; }
    });
    applyMs += performance.now() - applyStart;
    transactionCount += transactions.length;
  }
  const finalHeight = batches.at(-1)!.block.height;
  if (checkpoint.status === "reconciling" && (finalHeight === target || checkpoint.reconcileKind === "source")) {
    requireValue((await header(finalHeight)).hash === batches.at(-1)!.block.hash, "SOURCE_CHANGED_DURING_REPLAY");
    await store.markReady();
  }
  return { state: "progress", blocks: batches.length, transactions: transactionCount, height: finalHeight,
    sourceHeight: meta.archive_height, sourceEpoch: meta.epoch, fetchMs,
    handlerIncludingEntityIoMs: handlerMs, transactionOverheadMs: Math.max(0, applyMs - handlerMs) };
}

export function isSourceUnavailable(error: unknown): boolean {
  return error instanceof PrepError && (error.status === 429 || error.status >= 500 || error instanceof ReorgError);
}

/** Exact decimal/exponent ZEC text to integer zatoshis; never accepts JS numbers. */
export function toZatoshis(value: string): bigint {
  requireValue(typeof value === "string" && value.length <= 128, "INVALID_ZEC_DECIMAL");
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d{1,3}))?$/.exec(value);
  requireValue(match, "INVALID_ZEC_DECIMAL");
  const exponent = Number(match[4] ?? 0);
  requireValue(Math.abs(exponent) <= 100, "INVALID_ZEC_EXPONENT");
  const fraction = match[3] ?? "";
  const digits = BigInt(match[2]! + fraction);
  const scale = 8 + exponent - fraction.length;
  let amount: bigint;
  if (scale >= 0) amount = digits * 10n ** BigInt(scale);
  else {
    const divisor = 10n ** BigInt(-scale);
    requireValue(digits % divisor === 0n, "FRACTIONAL_ZATOSHI");
    amount = digits / divisor;
  }
  return match[1] === "-" ? -amount : amount;
}
