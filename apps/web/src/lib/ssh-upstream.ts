import "server-only";
import { createHash } from "node:crypto";
import { Client, type ClientChannel } from "ssh2";

const IDLE_MS = 30_000, MAX_AGE_MS = 120_000;
type Connection = {
  client: Client; identity: string; ready: Promise<void>; rejectReady: (error: Error) => void;
  closed: boolean; leases: number; created: number; idleSince: number;
  timer?: ReturnType<typeof setTimeout>; failures: Set<() => void>;
};
let pooled: Connection | undefined;
function discard(connection: Connection) {
  if (connection.closed) return;
  connection.closed = true;
  clearTimeout(connection.timer);
  if (pooled === connection) pooled = undefined;
  connection.rejectReady(Error("Private source connection closed"));
  for (const fail of [...connection.failures]) fail();
  connection.client.destroy();
}
function acquire() {
  const host = process.env.ZEER_SSH_HOST, username = process.env.ZEER_SSH_USER;
  const privateKey = process.env.ZEER_SSH_PRIVATE_KEY, hostKey = process.env.ZEER_SSH_HOST_KEY_SHA256;
  const port = Number(process.env.ZEER_SSH_PORT ?? 22);
  if (!host || !username || !privateKey || !hostKey || !/^[0-9a-f]{64}$/.test(hostKey) || !Number.isInteger(port) || port < 1 || port > 65535) throw Error("Private transport not configured");
  // Credentials and pins never appear in logs or request input. Rotation retires the old connection.
  const identity = createHash("sha256").update(JSON.stringify([host, port, username, privateKey, hostKey])).digest("hex");
  const now = Date.now();
  if (pooled && (pooled.identity !== identity || (!pooled.leases && (now - pooled.created >= MAX_AGE_MS || now - pooled.idleSince >= IDLE_MS)))) discard(pooled);
  if (!pooled) {
    const client = new Client();
    let ready!: () => void, rejectReady!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => { ready = resolve; rejectReady = reject; });
    // Closing before a caller subscribes must not cause an unhandled rejection.
    void promise.catch(() => {});
    const connection: Connection = { client, identity, ready: promise, rejectReady, closed: false, leases: 0, created: now, idleSince: now, failures: new Set() };
    pooled = connection;
    client.on("ready", ready);
    client.on("error", () => discard(connection));
    client.on("close", () => discard(connection));
    try {
      client.connect({ host, port, username, privateKey, readyTimeout: 10000,
        hostHash: "sha256", hostVerifier: (actual: string) => actual === hostKey,
        algorithms: { serverHostKey: ["ssh-ed25519"] }, keepaliveInterval: 10000, keepaliveCountMax: 2 });
    } catch { discard(connection); throw Error("Private source connection failed"); }
  }
  const connection = pooled;
  if (!connection || connection.closed || connection.leases >= 2) throw Error("Private transport busy");
  clearTimeout(connection.timer); connection.leases++;
  return connection;
}
function release(connection: Connection) {
  connection.leases--;
  if (connection.closed || connection.leases) return;
  connection.idleSince = Date.now();
  if (connection.idleSince - connection.created >= MAX_AGE_MS) { discard(connection); return; }
  connection.timer = setTimeout(() => discard(connection), IDLE_MS);
  connection.timer.unref();
}

/** Reuse one pinned, operator-configured connection per warm process; never cache query results.
 * Each request owns its forced-command channel, timeout, cancellation and response buffer.
 */
export async function sshUpstream(service: "prep" | "chef", route: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
  const payload = JSON.stringify({ service, route, ...(body === undefined ? {} : { body }) });
  if (Buffer.byteLength(payload) > 16384) throw Error("Private request too large");
  signal?.throwIfAborted();
  const connection = acquire();
  return new Promise((resolve, reject) => {
    let settled = false, stream: ClientChannel | undefined;
    const finish = (error?: Error, response?: Response) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
      connection.failures.delete(disconnected);
      stream?.destroy(); release(connection);
      if (error) reject(error); else resolve(response!);
    };
    const abort = () => finish(Error("Private request aborted"));
    const disconnected = () => finish(Error("Private source closed unexpectedly"));
    const timer = setTimeout(() => finish(Error("Private request deadline exceeded")), 15000);
    connection.failures.add(disconnected);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    void connection.ready.then(() => {
      if (settled) return;
      connection.client.exec("zeer-query", { pty: false }, (error, channel) => {
        if (error) { finish(Error("Private query unavailable")); return; }
        if (settled) { channel.destroy(); return; }
        stream = channel;
        const chunks: Buffer[] = []; let bytes = 0;
        channel.on("data", (chunk: Buffer) => {
          if (settled) return;
          bytes += chunk.length;
          if (bytes > 8 * 1024 * 1024 + 1024) { finish(Error("Private response too large")); return; }
          chunks.push(chunk);
        });
        channel.stderr.on("data", () => { /* Remote diagnostics can contain private configuration. */ });
        channel.on("error", () => finish(Error("Private stream failed")));
        channel.on("close", (code: number) => {
          if (settled) return;
          try {
            if (code !== 0) throw Error();
            const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (!Number.isInteger(result.status) || result.status < 200 || result.status > 599 || result.status === 204) throw Error();
            finish(undefined, new Response(JSON.stringify(result.body), { status: result.status, headers: { "Content-Type": "application/json" } }));
          } catch { finish(Error("Invalid private response")); }
        });
        channel.end(payload);
      });
    }, () => finish(Error("Private source connection failed"))).catch(() => finish(Error("Private source connection failed")));
  });
}
