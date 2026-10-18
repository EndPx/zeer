import "server-only";
import { Client } from "ssh2";

/** Optional private transport for a locked, read-only forced-command account.
 * Never accepts a hostname, username, command, key or target URL from a request.
 */
export async function sshUpstream(service: "prep" | "chef", route: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
  const host = process.env.ZEER_SSH_HOST, username = process.env.ZEER_SSH_USER;
  const privateKey = process.env.ZEER_SSH_PRIVATE_KEY, hostKey = process.env.ZEER_SSH_HOST_KEY_SHA256;
  if (!host || !username || !privateKey || !hostKey || !/^[0-9a-f]{64}$/.test(hostKey)) throw Error("Private transport not configured");
  const payload = JSON.stringify({ service, route, ...(body === undefined ? {} : { body }) });
  if (Buffer.byteLength(payload) > 16384) throw Error("Private request too large");
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;
    const finish = (error?: Error, response?: Response) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort); client.destroy();
      if (error) reject(error); else resolve(response!);
    };
    const abort = () => finish(Error("Private request aborted"));
    const timer = setTimeout(() => finish(Error("Private request deadline exceeded")), 15000);
    signal?.addEventListener("abort", abort, { once: true });
    client.on("error", () => finish(Error("Private source connection failed")));
    client.on("close", () => { if (!settled) finish(Error("Private source closed unexpectedly")); });
    client.on("ready", () => client.exec("zeer-query", { pty: false }, (error, stream) => {
      if (error) { finish(Error("Private query unavailable")); return; }
      const chunks: Buffer[] = []; let bytes = 0;
      stream.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024 + 1024) { finish(Error("Private response too large")); return; }
        chunks.push(chunk);
      });
      stream.stderr.on("data", () => { /* Do not expose remote diagnostics or credentials. */ });
      stream.on("error", () => finish(Error("Private stream failed")));
      stream.on("close", (code: number) => {
        if (settled) return;
        try {
          if (code !== 0) throw Error();
          const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (!Number.isInteger(result.status) || result.status < 200 || result.status > 599 || result.status === 204) throw Error();
          finish(undefined, new Response(JSON.stringify(result.body), { status: result.status, headers: { "Content-Type": "application/json" } }));
        } catch { finish(Error("Invalid private response")); }
      });
      stream.end(payload);
    }));
    try { client.connect({ host, port: 22, username, privateKey, readyTimeout: 10000,
      hostHash: "sha256", hostVerifier: (actual: string) => actual === hostKey,
      algorithms: { serverHostKey: ["ssh-ed25519"] },
    }); } catch { finish(Error("Private source connection failed")); }
  });
}
