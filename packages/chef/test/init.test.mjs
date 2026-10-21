import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {collectInitAnswers} from '../dist/init.js';
import {main} from '../dist/cli.js';

test('guided init retries invalid answers and accepts project-derived defaults', async () => {
  const questions = [], errors = [], answers = ['bad-name', 'payments', '', '-1', '1.5', '4294967295', ''];
  const result = await collectInitAnswers({}, async question => {questions.push(question); return answers.shift();}, code => errors.push(code));
  assert.deepEqual(result, {project: 'payments', directory: 'payments', startHeight: '0'});
  assert.deepEqual(errors, ['INVALID_PROJECT_NAME', 'INVALID_START_HEIGHT', 'INVALID_START_HEIGHT', 'INVALID_START_HEIGHT']);
  assert.ok(questions.includes('Project folder (payments): '));
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
