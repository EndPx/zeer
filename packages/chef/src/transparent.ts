import type { PrepClient, RequestOptions, TransactionSnapshot } from "@zeer-dev/prep-client";
import type { PublicTransaction } from "./types.js";
import { toZatoshis } from "./runtime.js";

const hash = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function index(v: unknown): number {
  const n = typeof v === "string" && /^(0|[1-9]\d{0,9})$/.test(v) ? Number(v) : v;
  if (!Number.isInteger(n) || Number(n) < 0 || Number(n) > 0xffffffff) throw new Error("INVALID_TRANSPARENT_INDEX");
  return n as number;
}
export interface TransparentOutput {
  id: string; txid: string; outputIndex: number; valueZat: string; addresses: string[]; scriptHex: string | null;
}
export type TransparentInput = {
  inputIndex: number; previousTxid: string | null; previousOutputIndex: number | null;
  status: "coinbase" | "resolved" | "unresolved"; previousOutput: TransparentOutput | null;
};
export function transparentOutputId(txid: string, outputIndex: number): string {
  if (!hash(txid)) throw new Error("INVALID_TRANSACTION_ID");
  return `${txid}:${index(outputIndex)}`;
}
/** Public output components only. Address presence does not identify an owner/sender. */
export function readTransparentOutputs(transaction: Pick<PublicTransaction, "txid" | "decoded">): TransparentOutput[] {
  if (!hash(transaction.txid) || !Array.isArray(transaction.decoded.vout) || transaction.decoded.vout.length > 1000) throw new Error("INVALID_TRANSPARENT_OUTPUTS");
  return transaction.decoded.vout.map((out, i) => {
    if (!record(out) || index(out.n) !== i || typeof out.value !== "string") throw new Error("INVALID_TRANSPARENT_OUTPUT");
    const amount = toZatoshis(out.value);
    if (amount < 0n) throw new Error("NEGATIVE_OUTPUT_VALUE");
    const script = out.scriptPubKey;
    if (script !== undefined && !record(script)) throw new Error("INVALID_OUTPUT_SCRIPT");
    const s = script as Record<string, unknown> | undefined;
    const addresses = s?.addresses ?? (s?.address === undefined ? [] : [s.address]);
    if (!Array.isArray(addresses) || addresses.length > 100 || addresses.some(a=>typeof a !== "string" || !a.length || a.includes("\0") || Buffer.byteLength(a)>512)) throw new Error("INVALID_OUTPUT_ADDRESSES");
    const hex = s?.hex;
    if (hex !== undefined && (typeof hex !== "string" || hex.length>16384 || hex.length%2 || !/^[0-9a-f]*$/.test(hex))) throw new Error("INVALID_OUTPUT_SCRIPT");
    return { id: transparentOutputId(transaction.txid, i), txid: transaction.txid, outputIndex: i, valueZat: amount.toString(), addresses: [...addresses], scriptHex: hex as string | undefined ?? null };
  });
}
/** Caller supplies an index lookup inside its canonical entity transaction. Unknown is never zero. */
export async function resolveTransparentInputs(transaction: Pick<PublicTransaction, "txid" | "decoded">,
  lookup: (txid: string, outputIndex: number) => Promise<TransparentOutput | null>): Promise<TransparentInput[]> {
  if (!hash(transaction.txid) || !Array.isArray(transaction.decoded.vin) || transaction.decoded.vin.length>1000) throw new Error("INVALID_TRANSPARENT_INPUTS");
  const seen = new Set<string>();
  const result: TransparentInput[] = [];
  for (const [inputIndex, input] of transaction.decoded.vin.entries()) {
    if (!record(input)) throw new Error("INVALID_TRANSPARENT_INPUT");
    if (Object.hasOwn(input, "coinbase")) {
      if (transaction.decoded.vin.length !== 1 || typeof input.coinbase !== "string" || !/^(?:[0-9a-f]{2})*$/.test(input.coinbase) || Object.hasOwn(input, "txid") || Object.hasOwn(input, "vout")) throw new Error("INVALID_COINBASE_INPUT");
      result.push({ inputIndex, previousTxid: null, previousOutputIndex: null, status: "coinbase", previousOutput: null }); continue;
    }
    if (!hash(input.txid) || input.txid === transaction.txid) throw new Error("INVALID_PREVIOUS_TRANSACTION");
    const n = index(input.vout), id = transparentOutputId(input.txid, n);
    if (seen.has(id)) throw new Error("DUPLICATE_TRANSPARENT_INPUT");
    seen.add(id);
    const output = await lookup(input.txid, n);
    if (output !== null) {
      if (output.id !== id || output.txid !== input.txid || output.outputIndex !== n || typeof output.valueZat !== "string" || !/^(0|[1-9]\d{0,127})$/.test(output.valueZat)
        || !Array.isArray(output.addresses) || output.addresses.length>100 || output.addresses.some(a=>typeof a !== "string" || !a.length || a.includes("\0") || Buffer.byteLength(a)>512)
        || (output.scriptHex !== null && (typeof output.scriptHex !== "string" || output.scriptHex.length>16384 || !/^(?:[0-9a-f]{2})*$/.test(output.scriptHex)))) throw new Error("PREVIOUS_OUTPUT_IDENTITY_OR_VALUE_MISMATCH");
    }
    result.push({ inputIndex, previousTxid: input.txid, previousOutputIndex: n, status: output ? "resolved" : "unresolved", previousOutput: output });
  }
  return result;
}

/** One bounded Prep snapshot. Use as an explicit prefetch, outside Chef's DB handler. */
export async function lookupTransparentOutputs(client: Pick<PrepClient, "getTransactions">,
  request: { txids: string[]; fromBlock: number; toBlock: number; at?: TransactionSnapshot }, options?: RequestOptions) {
  if (!Array.isArray(request.txids) || request.txids.length>128 || request.txids.some(id=>!hash(id)) || !Number.isInteger(request.fromBlock) || request.fromBlock<0
    || !Number.isInteger(request.toBlock) || request.toBlock<request.fromBlock || request.toBlock-request.fromBlock>10000) throw new Error("INVALID_PREVIOUS_OUTPUT_LOOKUP_BOUNDS");
  const page = await client.getTransactions({ from_block: request.fromBlock, to_block: request.toBlock, txids: request.txids,
    fields: ["txid", "block_height", "index", "vout"], ...(request.at ? { at: request.at } : {}) }, options);
  const outputs = new Map<string, TransparentOutput>();
  for (const row of page.transactions) for (const output of readTransparentOutputs({ txid: row.txid, decoded: { vout: row.vout } })) outputs.set(output.id, output);
  return { outputs, missingTxids: page.missing_txids, snapshot: page.snapshot };
}
