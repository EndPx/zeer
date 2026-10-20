import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { isAbsolute } from "node:path";
import type { PublicBlock, ReceiptSource, ShieldedReceipt, TransactionMetadata } from "./types.js";

const MAX_FRAME = 4_100_000;
const pools = ["sapling", "orchard", "ironwood"] as const;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const hex = (v: unknown, length: number): v is string => typeof v === "string" && v.length === length && /^[0-9a-f]+$/.test(v);
const uint = (v: unknown): v is number => Number.isInteger(v) && Number(v) >= 0 && Number(v) <= 0xffffffff;
export class ReceiptSourceError extends Error {
  constructor(readonly code: string) { super(code); this.name = "ReceiptSourceError"; }
}
function check(value: unknown, code = "INVALID_SCANNER_RESPONSE"): asserts value {
  if (!value) throw new ReceiptSourceError(code);
}
export function receiptId(account: string, fingerprint: string, txid: string, pool: string, index: number): string {
  const digest = createHash("sha256");
  for (const value of ["zeer.receipt.v1", "testnet", account, fingerprint, txid, pool]) digest.update(value).update("\0");
  const bytes = Buffer.alloc(4); bytes.writeUInt32LE(index); return digest.update(bytes).digest("hex");
}
export function validateReceipts(value: unknown, account: string, fingerprint: string, txid: string, height: number): ShieldedReceipt[] {
  check(Array.isArray(value) && value.length <= 4096);
  const ids = new Set<string>(); let previousPool = -1, previousIndex = -1;
  for (const receipt of value) {
    check(object(receipt) && receipt.network === "testnet" && receipt.account_id === account && receipt.txid === txid && receipt.height === height);
    const pool = pools.indexOf(receipt.pool as typeof pools[number]);
    check(pool >= 0 && uint(receipt.output_index) && (pool > previousPool || pool === previousPool && receipt.output_index > previousIndex));
    check(hex(receipt.id, 64) && receipt.id === receiptId(account, fingerprint, txid, String(receipt.pool), receipt.output_index) && !ids.has(receipt.id));
    check(hex(receipt.receiver, 86) && receipt.receiver_type === (pool === 0 ? "sapling" : "orchard") && hex(receipt.memo_hex, 1024));
    check(typeof receipt.value_zat === "string" && /^[1-9][0-9]{0,15}$/.test(receipt.value_zat) && BigInt(receipt.value_zat) <= 2100000000000000n);
    check(["external", "internal"].includes(String(receipt.scope)) && receipt.origin === "unknown" && typeof receipt.is_coinbase === "boolean");
    ids.add(receipt.id); previousPool = pool; previousIndex = receipt.output_index;
  }
  return value as ShieldedReceipt[];
}
export interface NativeReceiptOptions {
  executable: string; keyFile: string; accountId: string; keyFingerprint: string; timeoutMs?: number;
}
/** One local child and at most one request. Stderr, key material and parent secrets are never forwarded. */
export class NativeReceiptSource implements ReceiptSource {
  readonly identity: string;
  readonly accountId: string;
  readonly keyFingerprint: string;
  private child?: ChildProcessWithoutNullStreams;
  private starting?: Promise<void>;
  private pending?: { resolve(value: unknown): void; reject(error: Error): void };
  private bytes = Buffer.alloc(0);
  private closed = false;
  private busy = false;
  private sequence = 0;
  private timeout: number;
  constructor(private readonly options: NativeReceiptOptions) {
    this.options = { ...options };
    check(isAbsolute(options.executable) && isAbsolute(options.keyFile), "SCANNER_PATHS_MUST_BE_ABSOLUTE");
    check(/^[a-zA-Z0-9_-]{1,64}$/.test(options.accountId) && hex(options.keyFingerprint, 64), "INVALID_SCANNER_IDENTITY");
    this.timeout = options.timeoutMs ?? 15000;
    check(Number.isInteger(this.timeout) && this.timeout >= 100 && this.timeout <= 120000, "INVALID_SCANNER_TIMEOUT");
    this.accountId = options.accountId; this.keyFingerprint = options.keyFingerprint;
    this.identity = createHash("sha256").update(JSON.stringify([1, "testnet", this.accountId, this.keyFingerprint])).digest("hex");
  }
  private fail(code: string): void {
    this.closed = true; this.bytes = Buffer.alloc(0);
    const pending = this.pending; this.pending = undefined;
    pending?.reject(new ReceiptSourceError(code)); this.child?.kill();
  }
  private next(signal?: AbortSignal): Promise<unknown> {
    check(!this.closed && !this.pending, "SCANNER_CLOSED_OR_BUSY");
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const abort = () => this.fail("SCANNER_CANCELLED");
      const timer = setTimeout(() => this.fail("SCANNER_TIMEOUT"), this.timeout);
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
      this.pending = { resolve: v => { cleanup(); resolve(v); }, reject: e => { cleanup(); reject(e); } };
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
  private async start(signal?: AbortSignal): Promise<void> {
    if (!this.starting) this.starting = (async () => {
      const ready = this.next(signal);
      this.child = spawn(this.options.executable, ["serve", "--key-file", this.options.keyFile, "--account", this.accountId], {
        shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
      });
      this.child.stderr.resume();
      this.child.on("error", () => this.fail("SCANNER_PROCESS_UNAVAILABLE"));
      this.child.on("exit", () => { if (!this.closed) this.fail("SCANNER_PROCESS_EXITED"); });
      this.child.stdin.on("error", () => this.fail("SCANNER_INPUT_CLOSED"));
      this.child.stdout.on("data", (chunk: Buffer) => {
        if (this.closed) return;
        if (this.bytes.length + chunk.length > MAX_FRAME) { this.fail("SCANNER_FRAME_TOO_LARGE"); return; }
        this.bytes = Buffer.concat([this.bytes, chunk]);
        const end = this.bytes.indexOf(10);
        if (end === -1) return;
        if (end !== this.bytes.length - 1 || !this.pending) { this.fail("SCANNER_UNEXPECTED_FRAME"); return; }
        const body = this.bytes.subarray(0, end); this.bytes = Buffer.alloc(0);
        let value: unknown;
        try { value = JSON.parse(body.toString("utf8")); } catch { this.fail("SCANNER_INVALID_JSON"); return; }
        const pending = this.pending; this.pending = undefined; pending.resolve(value);
      });
      const message = await ready;
      check(object(message) && object(message.ready), "SCANNER_HANDSHAKE_REQUIRED");
      const caps = message.ready;
      check(caps.protocol_version === 1 && caps.network === "testnet" && caps.account_id === this.accountId && caps.key_fingerprint === this.keyFingerprint && caps.stateless === true, "SCANNER_IDENTITY_MISMATCH");
      check(JSON.stringify(caps.pools) === JSON.stringify(pools) && caps.max_frame_bytes === MAX_FRAME, "SCANNER_CAPABILITIES_MISMATCH");
    })().catch(error => { this.fail("SCANNER_HANDSHAKE_FAILED"); throw error; });
    await this.starting;
  }
  async scan(input: { block: PublicBlock; transaction: TransactionMetadata & { raw: string } }, signal?: AbortSignal): Promise<ShieldedReceipt[]> {
    check(!this.busy && !this.closed, "SCANNER_CLOSED_OR_BUSY"); this.busy = true;
    try {
      await this.start(signal);
      const request = { protocol_version: 1, request_id: ++this.sequence, network: "testnet", height: input.block.height, txid: input.transaction.txid, raw: input.transaction.raw };
      check(uint(request.height) && uint(request.request_id) && hex(request.txid, 64) && typeof request.raw === "string" && request.raw.length > 0 && request.raw.length <= 4000000 && request.raw.length % 2 === 0, "INVALID_SCANNER_INPUT");
      const bytes = JSON.stringify(request) + "\n"; check(Buffer.byteLength(bytes) <= MAX_FRAME, "SCANNER_FRAME_TOO_LARGE");
      const response = this.next(signal); this.child!.stdin.write(bytes);
      const message = await response;
      check(object(message));
      if (object(message.error)) { check(message.request_id === request.request_id && typeof message.error.code === "string" && /^[A-Z0-9_]{1,96}$/.test(message.error.code)); throw new ReceiptSourceError(message.error.code); }
      check(object(message.result)); const result = message.result;
      check(result.protocol_version === 1 && result.request_id === request.request_id && result.network === "testnet" && result.account_id === this.accountId && result.key_fingerprint === this.keyFingerprint && result.txid === request.txid && result.height === request.height && result.complete === true);
      return validateReceipts(result.receipts, this.accountId, this.keyFingerprint, request.txid, request.height);
    } catch (error) { this.fail("SCANNER_REQUEST_FAILED"); throw error instanceof ReceiptSourceError ? error : new ReceiptSourceError("SCANNER_REQUEST_FAILED"); }
    finally { this.busy = false; }
  }
  async close(): Promise<void> {
    this.fail("SCANNER_CLOSED");
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 2000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  }
}
