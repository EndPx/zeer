import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

/** Cached follower observation plus durable read gate; this makes no Prep/RPC call. */
export function healthReady(status, {now = Date.now(), maxAgeSeconds = 60} = {}) {
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > 3600) return false;
  const checkedAt = typeof status?.source?.checkedAt === 'string' ? Date.parse(status.source.checkedAt) : NaN;
  const age = now - checkedAt;
  return status?.checkpoint?.status === 'ready' && status?.source?.status === 'available'
    && Number.isFinite(age) && age >= 0 && age <= maxAgeSeconds * 1000;
}

export async function checkHealth(options = {}) {
  const env = options.env ?? process.env;
  if (!env.CHEF_API_TOKEN || Buffer.byteLength(env.CHEF_API_TOKEN) < 16) return false;
  const maxAgeSeconds = Number(env.CHEF_HEALTH_MAX_AGE_SECONDS ?? '60');
  const response = await (options.fetch ?? fetch)('http://127.0.0.1:39370/status', {
    method: 'GET', headers: {authorization: `Bearer ${env.CHEF_API_TOKEN}`},
    redirect: 'error', signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) { await response.body?.cancel(); return false; }
  return healthReady(await response.json(), {maxAgeSeconds, ...(options.now === undefined ? {} : {now: options.now})});
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  checkHealth().then(ready => { process.exitCode = ready ? 0 : 1; }, () => { process.exitCode = 1; });
}
