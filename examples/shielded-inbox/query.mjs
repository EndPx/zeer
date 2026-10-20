import { readFile } from 'node:fs/promises';

const endpoint = new URL(process.env.CHEF_LOCAL_URL ?? 'http://127.0.0.1:39375/graphql');
if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) ||
    endpoint.username || endpoint.password || endpoint.pathname !== '/graphql' || endpoint.search || endpoint.hash) {
  throw new Error('CHEF_LOCAL_URL must be a loopback HTTP /graphql endpoint');
}
if (!process.env.CHEF_API_TOKEN || Buffer.byteLength(process.env.CHEF_API_TOKEN) < 16) throw new Error('Set the local CHEF_API_TOKEN');
const query = await readFile(new URL('./query.graphql', import.meta.url), 'utf8');
const response = await fetch(endpoint, {
  method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CHEF_API_TOKEN}` },
  body: JSON.stringify({ query }),
});
if (!response.ok) throw new Error(`Local Chef returned HTTP ${response.status}`);
const result = await response.json();
if (result.errors) throw new Error('Local GraphQL rejected the query; check the inbox schema and checkpoint');
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
