// Local tarballs only; npm may download their declared third-party dependencies.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, open, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const integration = args.includes('--integration');
const indexed = args.includes('--indexed');
const allowed = integration ? ['--output', '--integration', '--port', '--indexed'] : ['--output', '--indexed'];
const flags = new Map();
for (let i = 0; i < args.length; i++) {
  const flag = args[i];
  assert.ok(allowed.includes(flag) && !flags.has(flag), 'Unknown or repeated flag');
  if (flag === '--integration' || flag === '--indexed') { flags.set(flag, true); continue; }
  const value = args[++i];
  assert.ok(value && !value.startsWith('--'), 'Missing flag value');
  flags.set(flag, value);
}
assert.ok(flags.has('--output'), 'Use --output benchmarks/results/<unique-run>');
const output = resolve(root, flags.get('--output'));
const resultRoot = resolve(root, 'benchmarks/results');
const resultRelative = relative(resultRoot, output);
assert.ok(resultRelative && !resultRelative.startsWith(`..${sep}`) && resultRelative !== '..' && !isAbsolute(resultRelative), 'Output must be a new directory below benchmarks/results');
const portText = flags.get('--port') ?? '39470';
assert.match(portText, /^[1-9][0-9]*$/);
const port = Number(portText);
assert.ok(port <= 65535, 'Invalid port');
assert.equal(process.platform, 'linux', 'Acceptance targets Linux x86_64 / WSL2 Linux');
assert.equal(process.arch, 'x64', 'Acceptance targets Linux x86_64');
if (integration) {
  for (const name of ['PREP_URL', 'PREP_API_TOKEN', 'DATABASE_URL', 'CHEF_API_TOKEN']) assert.ok(process.env[name], `${name} is required for fixture integration`);
  assert.ok(Buffer.byteLength(process.env.CHEF_API_TOKEN) >= 16, 'CHEF_API_TOKEN needs at least 16 bytes');
}
await mkdir(resultRoot, { recursive: true });
await mkdir(output, { recursive: false });
const consumer = await mkdtemp(join(tmpdir(), 'zeer-package-consumer-'));
// Retain even a failed consumer for investigation; never recursively clean another path.
await writeFile(join(output, 'consumer.json'), JSON.stringify({ consumer, node: process.version, platform: process.platform, architecture: process.arch }, null, 2));

async function recorded(executable, argv, cwd, label, env) {
  const result = spawnSync(executable, argv, { cwd, env: env ?? process.env, encoding: 'utf8', timeout: 180000 });
  await writeFile(join(output, `${label}.stdout`), result.stdout ?? '');
  await writeFile(join(output, `${label}.stderr`), result.stderr ?? '');
  assert.equal(result.status, 0, `${label} failed; see retained local output`);
  return result.stdout;
}

const tarballs = [];
for (const name of ['prep-client', 'chef']) {
  const packed = JSON.parse(await recorded('npm', ['pack', '.', '--pack-destination', output, '--json'], join(root, 'packages', name), `pack-${name}`));
  assert.equal(packed.length, 1);
  const manifest = packed[0];
  const paths = manifest.files.map(file => file.path);
  const required = name === 'chef' ? ['LICENSE', 'package.json', 'README.md', 'dist/index.js', 'dist/index.d.ts', 'dist/cli.js'] : ['LICENSE', 'package.json', 'README.md', 'src/index.js', 'src/index.d.ts'];
  for (const path of required) assert.ok(paths.includes(path), `Missing ${name} package entry: ${path}`);
  for (const path of paths) assert.ok(['LICENSE', 'package.json', 'README.md'].includes(path) || (name === 'chef' ? /^dist\/[a-z][a-z-]*\.(?:js|d\.ts)$/.test(path) : /^src\/index\.(?:js|d\.ts)$/.test(path)), `Unexpected packaged path: ${path}`);
  assert.equal(manifest.version, '0.1.0', 'Update candidate compatibility contract before changing version');
  tarballs.push(join(output, manifest.filename));
}
await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'zeer-tarball-consumer', private: true, type: 'module' }));
await recorded('npm', ['install', '--no-audit', '--no-fund', ...tarballs], consumer, 'install-packages');
await recorded('npm', ['install', '--save-dev', '--no-audit', '--no-fund', 'typescript@7.0.2'], consumer, 'install-typescript');
await recorded('npm', ['ls', '@zeer/chef', '@zeer/prep-client', '@types/node', '--json'], consumer, 'dependency-tree');
for (const name of ['chef', 'prep-client']) {
  const installed = join(consumer, 'node_modules/@zeer', name);
  assert.equal((await lstat(installed)).isSymbolicLink(), false, 'Workspace symlinks are forbidden');
  assert.equal(await realpath(installed), installed);
  const lock = JSON.parse(await readFile(join(consumer, 'package-lock.json'), 'utf8'));
  assert.ok(lock.packages[`node_modules/@zeer/${name}`].resolved.startsWith('file:'), 'Zeer must resolve from local tarballs');
}
const cli = join(consumer, 'node_modules/.bin/zeer-chef');
assert.equal(await realpath(cli), join(consumer, 'node_modules/@zeer/chef/dist/cli.js'));
const help = await recorded(cli, ['--help'], consumer, 'installed-bin-help');
assert.match(help, /codegen\|migrate\|sync\|serve\|status/, 'Installed bin must execute the CLI, not exit silently');
const project = `pkg_${Date.now().toString(36)}`;
const config = (await readFile(join(root, 'examples/chef-public/chef.config.ts'), 'utf8'))
  .replace('project: "public_demo"', `project: "${project}"`).replace('startHeight: 1,', 'startHeight: 1687106,');
await writeFile(join(consumer, 'chef.config.ts'), config);
let schema = await readFile(join(root, 'examples/chef-public/schema.graphql'), 'utf8');
if (indexed) schema = schema.replace('minedHeight: Int!', 'minedHeight: Int! @index').replace('transactionCount: Int!', 'transactionCount: Int! @index');
await writeFile(join(consumer, 'schema.graphql'), schema);
const generated = JSON.parse(await recorded(cli, ['codegen', '--json'], consumer, 'consumer-codegen'));
assert.equal(generated.command, 'codegen');
assert.equal(generated.status, 'complete');
await readFile(join(consumer, 'chef.generated.ts'), 'utf8');
await writeFile(join(consumer, 'types-check.ts'), `import { PrepClient } from '@zeer/prep-client';
import { createChefServer, defineConfig } from '@zeer/chef';
import type { ChefHandlerContext } from './chef.generated.ts';
const client = new PrepClient({ url: 'http://127.0.0.1:39368' });
const server: import('node:http').Server = createChefServer({} as Parameters<typeof createChefServer>[0]);
void client; void server; void defineConfig;
declare const context: ChefHandlerContext;
// @ts-expect-error Unknown entity names must fail.
context.entities.get('MissingEntity', '1');
// @ts-expect-error BigInt locktime must not accept a number.
context.entities.set('PublicTransaction', { id: 'tx', minedHeight: 1, version: 4, locktime: 0, sizeBytes: 1, transparentInputCount: 1, transparentOutputCount: 1 });
`);
await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, allowImportingTsExtensions: true, skipLibCheck: false, types: ['node'] }, include: ['*.ts'] }, null, 2));
await recorded(join(consumer, 'node_modules/.bin/tsc'), ['--project', 'tsconfig.json'], consumer, 'strict-types');
await recorded(process.execPath, ['--input-type=module', '-e', "for (const name of ['@zeer/chef', '@zeer/prep-client']) { const path = import.meta.resolve(name); if (!path.startsWith(new URL('./node_modules/', import.meta.url).href)) throw Error('External package resolution'); await import(name); console.log(JSON.stringify({name,path})); }"], consumer, 'module-resolution');

if (integration) {
  await copyFile(join(root, 'benchmarks/fixtures/mainnet-nu5-full-v1/fixture.json'), join(consumer, 'fixture.json'));
  const checker = (await readFile(join(root, 'examples/quickstart/check.mjs'), 'utf8')).replace('benchmarks/fixtures/mainnet-nu5-full-v1/fixture.json', 'fixture.json');
  await writeFile(join(consumer, 'check.mjs'), checker);
  const env = { ...process.env, CHEF_URL: `http://127.0.0.1:${port}` };
  await recorded(process.execPath, ['check.mjs', '--prep-only'], consumer, 'direct-prep-query', env);
  await recorded(cli, ['migrate'], consumer, 'consumer-migrate', env);
  const initial = JSON.parse(await recorded(cli, ['status', '--json'], consumer, 'consumer-initial-status', env));
  assert.equal(initial.checkpoint.height, null, 'Consumer project must be fresh');
  await recorded(cli, ['sync', '--to', '1687106', '--json'], consumer, 'consumer-first-sync', env);
  async function checkServer(height, label) {
    const stdout = await open(join(output, `${label}-server.stdout`), 'wx');
    const stderr = await open(join(output, `${label}-server.stderr`), 'wx');
    const server = spawn(cli, ['serve', '--port', String(port), '--json'], { cwd: consumer, env, stdio: ['ignore', stdout.fd, stderr.fd] });
    let spawnError;
    server.once('error', error => { spawnError = error; });
    const exited = new Promise(resolveExit => server.once('close', (code, signal) => resolveExit({ code, signal })));
    try {
      await recorded(process.execPath, ['check.mjs', String(height)], consumer, label, env);
      assert.equal(spawnError, undefined, 'Could not start installed server');
      assert.equal(server.exitCode, null, 'Installed server exited before checks finished');
    } finally {
      server.kill('SIGTERM');
      let timer;
      const outcome = await Promise.race([exited, new Promise(resolveTimeout => { timer = setTimeout(() => resolveTimeout(null), 5000); })]);
      clearTimeout(timer);
      if (outcome === null) { server.kill('SIGKILL'); await exited; }
      await stdout.close(); await stderr.close();
      assert.ok(outcome !== null && outcome.code === 0, 'Installed server did not stop cleanly');
    }
  }
  await checkServer(1687106, 'consumer-first-graphql');
  await recorded(cli, ['sync', '--to', '1687108', '--json'], consumer, 'consumer-resume-sync', env);
  await checkServer(1687108, 'consumer-resumed-graphql');
  const repeated = (await recorded(cli, ['sync', '--to', '1687108', '--json'], consumer, 'consumer-repeated-sync', env)).trim().split('\n').map(line => JSON.parse(line)).at(-1);
  assert.equal(repeated.state, 'complete');
  assert.equal(repeated.blocks, 0);
}
await writeFile(join(output, 'acceptance.json'), JSON.stringify({ status: 'PASS', versions: { chef: '0.1.0', prepClient: '0.1.0' }, consumer, project, installedBin: true, strictTypes: true, fixtureIntegration: integration, indexedSchema: indexed, scope: integration ? 'Fixed mainnet fixture replay; not live node or reorg proof' : 'Package installation only; no pipeline evidence' }, null, 2));
console.log(JSON.stringify({ status: 'PASS', output, consumer, fixtureIntegration: integration }));
