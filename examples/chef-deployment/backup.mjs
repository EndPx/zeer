import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform, Writable } from 'node:stream';
import { composeArguments } from './runtime-control.mjs';

const MAX_BYTES = 4 * 1024 ** 3;
const DATABASE = /^[a-z][a-z0-9_]{0,62}$/;
const HEX = /^[0-9a-f]{64}$/;
const failure = code => Object.assign(new Error(code), { code });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function identity(cwd) {
  const entry = import.meta.resolve('@zeer-dev/chef');
  const { loadProject, projectEnvironment, projectFingerprint } = await import(new URL('./project.js', entry));
  const project = await loadProject(resolve(cwd, 'chef.config.ts'));
  const prepUrl = projectEnvironment(project).prepUrl;
  if (!prepUrl) throw failure('PREP_URL_REQUIRED');
  const schema = await readFile(resolve(dirname(project.configPath), project.config.schema));
  return { project: project.config.project, network: project.config.network,
    fingerprint: projectFingerprint(project, prepUrl), model: project.model.fingerprint,
    configSha256: sha(project.bytes), schemaSha256: sha(schema) };
}

async function regularParent(path) {
  for (let parent = dirname(path);; parent = dirname(parent)) {
    const stat = await lstat(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure('UNSAFE_FILE_PATH');
    if (dirname(parent) === parent) break;
  }
}
async function absent(path) {
  try { await lstat(path); throw failure('FILE_ALREADY_EXISTS'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
function fresh(path) { return open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600); }
async function jsonFile(path, value) {
  const handle = await fresh(path);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
}
async function metadata(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) throw failure('INVALID_BACKUP_METADATA');
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { throw failure('INVALID_BACKUP_METADATA'); }
}

/** Test seam replaces only the executable, retaining real argv, pipes and exit handling. */
async function command(args, options) {
  const { cwd, env, launch, timeoutMs, input, output, signal, compose } = options;
  if (signal?.aborted) throw failure('DATABASE_COMMAND_ABORTED');
  const child = launch('docker', [...compose, 'exec', '-T',
    '-e', 'PGCONNECT_TIMEOUT=5', '-e', `PGOPTIONS=-c statement_timeout=${Math.max(1, Math.floor(timeoutMs))} -c lock_timeout=5000`, 'postgres', ...args],
    { cwd, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'ignore'] });
  let timedOut = false, captured = Buffer.alloc(0);
  const stop = () => {
    if (!child.pid || child.exitCode !== null) return;
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.on('error', () => { child.kill('SIGKILL'); });
    } else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
  };
  const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
  const abort = () => stop();
  signal?.addEventListener('abort', abort, { once: true });
  let streamError;
  const exit = new Promise((resolveExit, reject) => {
    child.once('error', () => reject(failure('DATABASE_COMMAND_FAILED')));
    child.once('close', code => code === 0 && !timedOut ? resolveExit() : reject(failure(timedOut ? 'DATABASE_COMMAND_TIMEOUT' : 'DATABASE_COMMAND_FAILED')));
  });
  exit.catch(() => {});
  if (!output) child.stdout.on('data', chunk => {
    if (captured.length + chunk.length > 65536) { streamError = failure('DATABASE_RESPONSE_TOO_LARGE'); stop(); }
    else captured = Buffer.concat([captured, chunk]);
  });
  const pipes = [];
  if (input) pipes.push(pipeline(input, child.stdin)); else child.stdin.end();
  if (output) pipes.push(pipeline(child.stdout, output));
  try {
    await Promise.all([exit, ...pipes.map(p => p.catch(error => { stop(); throw error; }))]);
    if (streamError) throw streamError;
    return captured.toString('utf8').trim();
  } catch (error) {
    stop(); await exit.catch(() => {});
    if (error.code === 'ARCHIVE_SIZE_LIMIT') throw error;
    throw failure(signal?.aborted ? 'DATABASE_COMMAND_ABORTED' : timedOut ? 'DATABASE_COMMAND_TIMEOUT' : 'DATABASE_COMMAND_FAILED');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

function stateSql(project) {
  return `SELECT json_build_object('fingerprint',fingerprint,'model',model,'network',network) FROM "chef_${project}".state WHERE singleton=true;`;
}
async function verifyState(database, expected, run) {
  const value = await run(['psql', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1', '-At', '--username', 'chef', '--dbname', database, '-c', stateSql(expected.project)]);
  let state;
  try { state = JSON.parse(value); } catch { throw failure('DATABASE_IDENTITY_MISMATCH'); }
  if (!state || ['fingerprint', 'model', 'network'].some(key => state[key] !== expected[key])) throw failure('DATABASE_IDENTITY_MISMATCH');
}
function archiveMeter(maxBytes, hasher) {
  let size = 0, prefix = Buffer.alloc(0);
  const stream = new Transform({ transform(chunk, encoding, callback) {
    size += chunk.length;
    if (size > maxBytes) return callback(failure('ARCHIVE_SIZE_LIMIT'));
    if (prefix.length < 5) prefix = Buffer.concat([prefix, chunk]).subarray(0, 5);
    hasher.update(chunk); callback(null, chunk);
  } });
  return { stream, result() {
    if (prefix.toString('ascii') !== 'PGDMP') throw failure('INVALID_POSTGRES_ARCHIVE');
    return { bytes: size, sha256: hasher.digest('hex') };
  } };
}
function fileInput(handle) {
  return Readable.from((async function* () {
    let position = 0;
    for (;;) {
      const buffer = Buffer.allocUnsafe(65536);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) return;
      position += bytesRead; yield buffer.subarray(0, bytesRead);
    }
  })());
}
function fileOutput(handle) {
  return new Writable({ write(chunk, encoding, callback) {
    (async () => {
      for (let offset = 0; offset < chunk.length;) {
        const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset);
        if (!bytesWritten) throw failure('DATABASE_COMMAND_FAILED');
        offset += bytesWritten;
      }
    })().then(() => callback(), callback);
  } });
}

export async function main(args, deps = {}) {
  const emit = deps.write ?? (value => process.stdout.write(JSON.stringify(value) + '\n'));
  const cwd = deps.cwd ?? process.cwd(), env = deps.env ?? process.env;
  const launch = deps.spawn ?? spawn;
  const timeoutMs = deps.timeoutMs ?? 180000, maxBytes = deps.maxBytes ?? MAX_BYTES;
  const deadline = Date.now() + timeoutMs;
  const controller = new AbortController(), signal = deps.signal ?? controller.signal;
  const abort = () => controller.abort();
  if (!deps.signal) { process.on('SIGINT', abort); process.on('SIGTERM', abort); }
  let operation, target, incomplete, activeMarker = false, targetCreated = false;
  try {
    operation = args[0];
    const flags = new Map();
    for (let i = 1; i < args.length; i += 2) {
      if (!['--file', '--database'].includes(args[i]) || !args[i + 1] || flags.has(args[i])) throw failure('INVALID_ARGUMENTS');
      flags.set(args[i], args[i + 1]);
    }
    if (!['backup', 'restore'].includes(operation) || !flags.get('--file') || (operation === 'backup' && flags.has('--database')) || (operation === 'restore' && !flags.has('--database'))) throw failure('INVALID_ARGUMENTS');
    const database = env.CHEF_DATABASE_NAME ?? 'chef';
    target = flags.get('--database');
    if (!DATABASE.test(database) || (target && (!DATABASE.test(target) || target === database || target === 'chef'))) throw failure('INVALID_TARGET_DATABASE');
    const expected = await (deps.identity ?? identity)(cwd);
    if (!expected || !/^[a-z][a-z0-9_]{0,31}$/.test(expected.project) || !['testnet', 'mainnet', 'regtest'].includes(expected.network)
      || ['fingerprint', 'model', 'configSha256', 'schemaSha256'].some(key => !HEX.test(expected[key]))) throw failure('INVALID_PROJECT_IDENTITY');
    const file = resolve(cwd, flags.get('--file'));
    await regularParent(file);
    const manifest = file + '.json'; incomplete = file + (operation === 'backup' ? '.incomplete.json' : '.restore-' + target + '.incomplete.json');
    const compose = await composeArguments(cwd,env);
    const run = (argv, streams = {}) => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw failure('DATABASE_COMMAND_TIMEOUT');
      return command(argv, { cwd, env, launch, timeoutMs: remaining, signal, compose, ...streams });
    };
    if (operation === 'backup') {
      await absent(file); await absent(manifest); await absent(incomplete);
      await verifyState(database, expected, run);
      await jsonFile(incomplete, { format: 1, operation, status: 'incomplete', project: expected.project }); activeMarker = true;
      const handle = await fresh(file);
      try {
        const meter = archiveMeter(maxBytes, createHash('sha256'));
        const output = fileOutput(handle);
        const transfer = pipeline(meter.stream, output); transfer.catch(() => {});
        try { await run(['pg_dump', '-Fc', '--no-owner', '--no-acl', '--schema', 'chef_' + expected.project, '--username', 'chef', '--dbname', database], { output: meter.stream }); await transfer; }
        catch (error) { meter.stream.destroy(); output.destroy(); await transfer.catch(() => {}); throw error; }
        const result = meter.result(); await handle.sync();
        await jsonFile(manifest, { format: 1, ...expected, ...result, createdAt: new Date().toISOString() });
      } finally { await handle.close(); }
    } else {
      await absent(file + '.incomplete.json');
      const info = await metadata(manifest);
      if (info.format !== 1 || Object.keys(expected).some(key => info[key] !== expected[key])) throw failure('BACKUP_IDENTITY_MISMATCH');
      if (!Number.isSafeInteger(info.bytes) || info.bytes < 5 || info.bytes > maxBytes || !HEX.test(info.sha256)) throw failure('INVALID_BACKUP_METADATA');
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== info.bytes) throw failure('BACKUP_CHECKSUM_MISMATCH');
      const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const opened = await handle.stat();
        if (!opened.isFile() || opened.size !== info.bytes) throw failure('BACKUP_CHECKSUM_MISMATCH');
        const meter = archiveMeter(maxBytes, createHash('sha256'));
        const sink = new Transform({ transform(chunk, encoding, callback) { callback(); } });
        await pipeline(fileInput(handle), meter.stream, sink, { signal });
        const actual = meter.result();
        if (actual.bytes !== info.bytes || actual.sha256 !== info.sha256) throw failure('BACKUP_CHECKSUM_MISMATCH');
        await absent(incomplete);
        const exists = await run(['psql', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1', '-At', '--username', 'chef', '--dbname', database, '-c', `SELECT 1 FROM pg_database WHERE datname='${target}';`]);
        if (exists !== '') throw failure('TARGET_DATABASE_EXISTS');
        await jsonFile(incomplete, { format: 1, operation, status: 'incomplete', project: expected.project, database: target }); activeMarker = true;
        await run(['createdb', '--username', 'chef', '--maintenance-db', database, '--template', 'template0', '--owner', 'chef', target]); targetCreated = true;
        await run(['pg_restore', '--exit-on-error', '--no-owner', '--no-acl', '--username', 'chef', '--dbname', target], { input: fileInput(handle) });
        await verifyState(target, expected, run);
      } finally { await handle.close(); }
    }
    await unlink(incomplete); activeMarker = false;
    emit({ command: operation, status: 'complete', project: expected.project, ...(target ? { database: target } : {}) });
    return 0;
  } catch (error) {
    const known = new Set(['INVALID_ARGUMENTS', 'INVALID_TARGET_DATABASE', 'INVALID_PROJECT_IDENTITY', 'PREP_URL_REQUIRED', 'UNSAFE_FILE_PATH', 'FILE_ALREADY_EXISTS', 'INVALID_BACKUP_METADATA', 'BACKUP_IDENTITY_MISMATCH', 'BACKUP_CHECKSUM_MISMATCH', 'INVALID_POSTGRES_ARCHIVE', 'ARCHIVE_SIZE_LIMIT', 'DATABASE_COMMAND_TIMEOUT', 'DATABASE_COMMAND_ABORTED', 'DATABASE_COMMAND_FAILED', 'DATABASE_IDENTITY_MISMATCH', 'TARGET_DATABASE_EXISTS']);
    emit({ command: operation === 'restore' ? 'restore' : 'backup', status: 'failed', code: known.has(error.code) ? error.code : 'BACKUP_OPERATION_FAILED',
      ...(activeMarker ? { artifact: 'incomplete', ...(operation === 'restore' ? { targetCreated: targetCreated ? true : 'unknown', database: target, originalDatabase: 'unchanged' } : {}) } : {}) });
    return 1;
  } finally { if (!deps.signal) { process.off('SIGINT', abort); process.off('SIGTERM', abort); } }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
