import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const child = spawn(process.execPath, [fileURLToPath(import.meta.resolve('@docusaurus/core/bin/docusaurus.mjs')), 'build'], {
  stdio: 'inherit',
  env: {...process.env, DOCUSAURUS_SSG_WORKER_THREAD_COUNT: '2', DOCUSAURUS_SSR_CONCURRENCY: '2'},
});
child.on('error', error => {console.error(error.message); process.exitCode = 1;});
child.on('exit', code => {process.exitCode = code ?? 1;});
