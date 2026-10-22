import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export class RuntimeError extends Error { constructor(code) { super(code); this.code = code; } }

/** Construct the dedicated service URL without treating passwords as URL syntax. */
export function databaseUrl(env = process.env) {
  if (typeof env.POSTGRES_PASSWORD !== 'string' || !env.POSTGRES_PASSWORD) throw new RuntimeError('POSTGRES_PASSWORD_REQUIRED');
  const database = env.CHEF_DATABASE_NAME ?? 'chef';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(database)) throw new RuntimeError('INVALID_DATABASE_NAME');
  return `postgresql://chef:${encodeURIComponent(env.POSTGRES_PASSWORD)}@postgres:5432/${database}`;
}

export async function runRuntime(args = process.argv.slice(2), options = {}) {
  if (args.length !== 1 || !['api', 'follower', 'migrate', 'check'].includes(args[0])) throw new RuntimeError('INVALID_RUNTIME_ROLE');
  const env = options.env ?? process.env;
  env.DATABASE_URL = databaseUrl(env);
  // Resolve the installed SDK entry, then import its sibling CLI. No subprocess:
  // SDK signal handlers own termination and close the writer/database cleanly.
  const main = options.main ?? (await import(new URL('./cli.js', import.meta.resolve('@zeer-dev/chef')))).main;
  const role = args[0];
  if (role === 'api') {
    let report;
    await main(['status', '--json'], {write: text => { report = JSON.parse(text); }});
    if (!report || !['caught_up', 'backfill'].includes(report.state) || report.readGate !== 'ready'
      || report.source?.availability !== 'available' || report.source.checkpointAheadOfPrep !== false) {
      throw new RuntimeError('API_PREFLIGHT_NOT_READY');
    }
    await main(['serve', '--listen', '0.0.0.0', '--port', '39370', '--json']);
  } else if (role === 'follower') await main(['sync', '--follow', '--json']);
  else await main([role === 'check' ? 'status' : 'migrate', '--json']);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runRuntime().catch(error => {
    const code = error instanceof RuntimeError ? error.code : 'RUNTIME_FAILED';
    console.error(JSON.stringify({error: {code}, help: 'Inspect configuration, explicit migration and source readiness. Retain the database for recovery.'}));
    process.exitCode = 1;
  });
}
