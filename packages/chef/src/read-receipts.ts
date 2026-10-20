import type { PrepClient, RequestOptions, TransactionObservation } from "@zeer-dev/prep-client";
import type { ReceiptSource, ShieldedReceipt } from "./types.js";
import { validateReceipts } from "./receipts.js";

export class ReceiptReadError extends Error {
  constructor(readonly code: string) { super(code); this.name = "ReceiptReadError"; }
}
function requireValue(value: unknown, code: string): asserts value {
  if (!value) throw new ReceiptReadError(code);
}
const hexId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const uint = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 0xffff_ffff;

/** ZIP 302 display projection; the original 512 memo bytes remain authoritative. */
export function decodeMemo(memoHex: string): { memoKind: string; memoText: string | null } {
  requireValue(/^[0-9a-fA-F]{1024}$/.test(memoHex), "INVALID_MEMO_BYTES");
  const bytes = Buffer.from(memoHex, "hex");
  if (bytes[0] === 0xf6 && bytes.subarray(1).every(byte => byte === 0)) return { memoKind: "no_memo", memoText: null };
  if (bytes[0]! >= 0xf5) return { memoKind: "non_text", memoText: null };
  let end = bytes.length; while (end && bytes[end - 1] === 0) end--;
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, end)); }
  catch { return { memoKind: "invalid_utf8", memoText: null }; }
  if (text.includes("\0")) return { memoKind: "text_with_nul", memoText: null };
  return { memoKind: text ? "text" : "empty_text", memoText: text };
}

export type ReadableReceipt = ShieldedReceipt & ReturnType<typeof decodeMemo>;
export interface ShieldedTransactionRead {
  observation: TransactionObservation;
  receipts: ReadableReceipt[];
  source: { height: number; hash: string; epoch: string; canonicality: string; observedAt: number } | null;
}

/** Read one mined transaction using the caller's local receipt source.
 * No key is sent to Prep. Pending/missing observations never assert an absent deposit.
 * Recheck the source's mined identity after scanning; a changed identity fails closed.
 * This is a receipt observation, not a spendable balance or payout instruction.
 */
export async function readShieldedTransaction(options: {
  client: Pick<PrepClient, "getTransaction" | "get">;
  receiptSource: ReceiptSource;
  txid: string;
} & RequestOptions): Promise<ShieldedTransactionRead> {
  const { client, receiptSource, txid, signal, timeoutMs } = options;
  requireValue(hexId(txid), "INVALID_TRANSACTION_ID");
  requireValue(hexId(receiptSource.identity) && hexId(receiptSource.keyFingerprint) && /^[a-zA-Z0-9_-]{1,64}$/.test(receiptSource.accountId), "INVALID_SCANNER_IDENTITY");
  signal?.throwIfAborted();
  const request = { signal, timeoutMs };
  const observed = await client.getTransaction(txid, request);
  signal?.throwIfAborted();
  requireValue(observed.network === "testnet" && observed.txid === txid, "SOURCE_IDENTITY_MISMATCH");
  if (observed.status !== "mined") return { observation: observed, receipts: [], source: null };
  const height = observed.block_height;
  requireValue(uint(height) && height < 0xffff_ffff && hexId(observed.block_hash) && observed.transaction?.txid === txid, "INVALID_MINED_OBSERVATION");
  const page = await client.get({
    from_block: height, to_block: height + 1,
    field_selection: { block: ["height", "hash", "previous_hash", "time"], transaction: ["txid", "block_height", "index", "version", "locktime", "raw"] },
    transaction_filter: { txids: [txid] },
  }, request);
  requireValue(page.network === "testnet" && page.from_block === height && page.to_block === height + 1 && page.next_block === height + 1 && page.cursor === null, "INCOMPLETE_SOURCE_RANGE");
  requireValue(page.data.blocks.length === 1 && page.data.transactions.length === 1, "TRANSACTION_NOT_IN_ARCHIVE");
  const block = page.data.blocks[0]!; const transaction = page.data.transactions[0]!;
  requireValue(block.height === height && block.hash === observed.block_hash && hexId(block.previous_hash) && uint(block.time), "CANONICAL_BLOCK_MISMATCH");
  requireValue(transaction.txid === txid && transaction.block_height === height && uint(transaction.index) && uint(transaction.version) && uint(transaction.locktime)
    && typeof transaction.raw === "string" && /^(?:[0-9a-f]{2})+$/.test(transaction.raw), "INVALID_ARCHIVED_TRANSACTION");
  const scanned = await receiptSource.scan({
    block: { height, hash: observed.block_hash, previousHash: block.previous_hash, time: block.time },
    transaction: { txid, index: transaction.index, version: transaction.version, locktime: transaction.locktime, blockHeight: height, raw: transaction.raw },
  }, signal);
  const receipts = validateReceipts(scanned, receiptSource.accountId, receiptSource.keyFingerprint, txid, height);
  const current = await client.getTransaction(txid, request);
  requireValue(current.network === "testnet" && current.txid === txid && current.status === "mined"
    && current.block_height === height && current.block_hash === observed.block_hash, "SOURCE_CHANGED_DURING_SCAN");
  signal?.throwIfAborted();
  return {
    observation: current,
    receipts: receipts.map(receipt => ({ ...receipt, ...decodeMemo(receipt.memo_hex) })),
    source: { height, hash: observed.block_hash, epoch: page.epoch, canonicality: page.canonicality, observedAt: current.observed_at },
  };
}
