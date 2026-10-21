import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {collectInitAnswers, resolveStartHeight, PUBLIC_TESTNET_PREP} from '../dist/init.js';
import {main} from '../dist/cli.js';

test('guided init retries invalid answers and accepts project-derived defaults', async () => {
  const questions = [], errors = [], answers = ['bad-name', 'payments', '', '-1', '1.5', '4294967295', ''];
  const result = await collectInitAnswers({}, async question => {questions.push(question); return answers.shift();}, code => errors.push(code));
  assert.deepEqual(result, {project: 'payments', directory: 'payments', startHeight: 'latest'});
  assert.deepEqual(errors, ['INVALID_PROJECT_NAME', 'INVALID_START_HEIGHT', 'INVALID_START_HEIGHT', 'INVALID_START_HEIGHT']);
  assert.ok(questions.includes('Project folder (payments): '));
});

const metadata = overrides => ({ready: true, network: 'testnet', payload_kind: 'full-v1',
  archive_height: 4525000, indexed_height: 4525000, source_height: 4525010, start_block: 0,
  epoch: '1', revision: '2', lag_blocks: 10, source_observed_at: 1792569600, ...overrides});

test('every command exposes service-free help and installed version is accurate', async () => {
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  for (const command of ['init', 'codegen', 'migrate', 'sync', 'status', 'serve']) {
    const result = spawnSync(process.execPath, [cli, command, '--help'], {encoding: 'utf8', timeout: 10000});
    assert.equal(result.status, 0, result.stderr); assert.ok(result.stdout.includes(`zeer ${command}`));
    assert.match(result.stdout, /--json/);
  }
  const version = spawnSync(process.execPath, [cli, '--version'], {encoding: 'utf8'});
  assert.equal(version.status, 0); assert.equal(version.stdout.trim(), JSON.parse(await readFile(new URL('../package.json', import.meta.url))).version);
});

test('latest captures available archive height rather than the source tip; explicit heights stay offline', async () => {
  let calls = 0;
  const client = {async getHeight(options) {calls++; assert.equal(options.timeoutMs, 5000); return metadata();}};
  assert.equal(await resolveStartHeight('latest', {url: PUBLIC_TESTNET_PREP, client}), 4525000);
  assert.equal(await resolveStartHeight('0', {url: PUBLIC_TESTNET_PREP, client}), 0);
  assert.equal(calls, 1);
  for (const overrides of [{ready: false}, {network: 'mainnet'}, {payload_kind: 'compact-v1'},
    {archive_height: null}, {archive_height: 5, start_block: 6}]) {
    await assert.rejects(resolveStartHeight('latest', {url: PUBLIC_TESTNET_PREP,
      client: {async getHeight() {return metadata(overrides);}}}), {code: 'INIT_PREP_NOT_READY'});
  }
  await assert.rejects(resolveStartHeight('latest', {url: PUBLIC_TESTNET_PREP,
    client: {async getHeight() {throw new Error('secret source detail');}}}), {code: 'INIT_PREP_UNAVAILABLE'});
});

test('CLI latest records one numeric height and its Prep URL without exporting the operator token', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'zeer-latest-'));
  t.after(() => rm(parent, {recursive: true, force: true}));
  const oldUrl = process.env.PREP_URL, oldToken = process.env.PREP_API_TOKEN;
  t.after(() => {if(oldUrl === undefined) delete process.env.PREP_URL; else process.env.PREP_URL = oldUrl;
    if(oldToken === undefined) delete process.env.PREP_API_TOKEN; else process.env.PREP_API_TOKEN = oldToken;});
  process.env.PREP_URL = 'https://private.invalid'; process.env.PREP_API_TOKEN = 'SECRET_NOT_FOR_PUBLIC_PREP';
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({url: String(url), headers: options.headers});
    return new Response(JSON.stringify(metadata()), {headers: {'content-type': 'application/json'}});
  });
  const directory = join(parent, 'custom'); let output = '';
  await main(['init', '--dir', directory, '--project', 'latest_test', '--start-height', 'latest',
    '--prep-url', 'https://custom.invalid/prep', '--json'], {write: text => {output += text;}});
  assert.match(await readFile(join(directory, 'chef.config.ts'), 'utf8'), /startHeight: 4525000/);
  const env = await readFile(join(directory, '.env'), 'utf8');
  assert.match(env, /^PREP_URL=https:\/\/custom.invalid\/prep$/m);
  assert.match(env, /^PREP_API_TOKEN=$/m); assert.equal(env.includes(process.env.PREP_API_TOKEN), false);
  assert.equal(calls[0].url, 'https://custom.invalid/prep/height');
  assert.equal(calls[0].headers.authorization, 'Bearer SECRET_NOT_FOR_PUBLIC_PREP');
  assert.equal(JSON.parse(output).startHeight, 4525000); assert.equal(output.includes(process.env.PREP_API_TOKEN), false);
  process.env.PREP_URL = '';
  await main(['init', '--dir', join(parent, 'public'), '--project', 'public_test', '--start-height', 'latest', '--json'], {write() {}});
  assert.equal(calls[1].url, PUBLIC_TESTNET_PREP + '/height');
  assert.equal(calls[1].headers.authorization, undefined);
});

test('failed latest lookup creates no files and does not silently choose genesis', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'zeer-latest-fail-'));
  t.after(() => rm(parent, {recursive: true, force: true}));
  const directory = join(parent, 'absent');
  await assert.rejects(main(['init', '--dir', directory, '--project', 'latest_test', '--start-height', 'latest', '--json'],
    {client: {async getHeight() {throw new Error('unreachable');}}, write() {}}), {code: 'INIT_PREP_UNAVAILABLE'});
  await assert.rejects(lstat(directory), {code: 'ENOENT'});
});

test('guided init respects flags and validates them before asking anything', async () => {
  const questions = [];
  const ask = async question => {questions.push(question); return '';};
  assert.deepEqual(await collectInitAnswers({project: 'my_app', startHeight: '42'}, ask, () => {}),
    {project: 'my_app', directory: 'my-app', startHeight: '42'});
  assert.deepEqual(questions, ['Project folder (my-app): ']);
  for (const supplied of [{project: 'bad-name'}, {startHeight: '01'}, {startHeight: 'Infinity'}]) {
    await assert.rejects(collectInitAnswers(supplied, () => assert.fail('must not prompt'), () => {}));
  }
});

test('CLI guided init creates the answered project without contacting services', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'zeer-guided-'));
  t.after(() => rm(parent, {recursive: true, force: true}));
  const directory = join(parent, 'indexer'), answers = ['payment_indexer', directory, '42'];
  let output = '';
  await main(['init'], {tty: true, prompt: async () => answers.shift(), write: text => {output += text;}});
  assert.match(await readFile(join(directory, 'chef.config.ts'), 'utf8'), /project: "payment_indexer"/);
  assert.match(await readFile(join(directory, 'chef.config.ts'), 'utf8'), /startHeight: 42/);
  assert.match(output, /Chef init: complete/);
  const env = await readFile(join(directory, '.env'), 'utf8');
  assert.equal(output.includes(env.match(/^CHEF_API_TOKEN=(.+)$/m)[1]), false);
  await assert.rejects(lstat(join(directory, 'node_modules')), {code: 'ENOENT'});
});

test('scripts never prompt, complete flags bypass questions, cancellation writes nothing', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'zeer-prompt-gates-'));
  t.after(() => rm(parent, {recursive: true, force: true}));
  for (const [args, tty] of [[['init', '--json'], true], [['init', '--human'], false]]) {
    await assert.rejects(main(args, {tty, prompt: () => assert.fail('must not prompt')}), {code: 'INIT_OPTIONS_REQUIRED'});
  }
  await main(['init', '--dir', join(parent, 'flags'), '--project', 'flags', '--start-height', '0', '--json'],
    {tty: true, prompt: () => assert.fail('must not prompt'), write() {}});
  const directory = join(parent, 'cancelled');
  await assert.rejects(main(['init', '--dir', directory], {tty: true, write() {}, prompt: async () => {
    const error = new Error('cancelled'); error.code = 'INIT_CANCELLED'; throw error;
  }}), {code: 'INIT_CANCELLED'});
  await assert.rejects(lstat(directory), {code: 'ENOENT'});
});
