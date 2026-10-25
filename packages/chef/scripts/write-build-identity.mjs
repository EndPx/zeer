import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync, existsSync, realpathSync} from 'node:fs';
import {dirname, resolve, relative, isAbsolute, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

// This runs during build/pack, never in an installed CLI process. No timestamp or host paths.
const packageFile = resolve(process.argv[2] ?? fileURLToPath(new URL('../package.json', import.meta.url)));
const packageDir = dirname(packageFile);
const metadata = JSON.parse(readFileSync(packageFile, 'utf8'));
if (metadata.name !== '@zeer-dev/chef' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(metadata.version)) throw new Error('Invalid Chef package metadata');
let buildCommit = 'unknown', sourceState = 'unknown';
try {
  // CLI/CI environments may point Git at another worktree or index. They must
  // never give this package the identity of a different checkout.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toUpperCase().startsWith('GIT_')));
  const git = args => execFileSync('git', ['-C', packageDir, ...args], {env,encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:5000,windowsHide:true}).trim();
  const root = realpathSync(git(['rev-parse','--show-toplevel']));
  const packageRelative = relative(root,realpathSync(packageDir));
  if (isAbsolute(packageRelative) || packageRelative === '..' || packageRelative.startsWith(`..${sep}`)) throw new Error('Package is outside the source checkout');
  // A copied package inside an unrelated Git checkout must not inherit that checkout's identity.
  const tracked = git(['ls-files','--error-unmatch','--','package.json']);
  const runtime = git(['ls-files','--error-unmatch','--','src/runtime.ts']);
  const candidate = git(['rev-parse','--verify','HEAD']);
  if (tracked === 'package.json' && runtime === 'src/runtime.ts' && /^[a-f0-9]{40}$/.test(candidate) && existsSync(resolve(packageDir,'src','runtime.ts'))) {
    buildCommit = candidate;
    // Untracked files can affect a build too; report their presence conservatively.
    sourceState = git(['status','--porcelain','--untracked-files=normal']).length ? 'modified' : 'clean';
  }
} catch { /* Source provenance is explicitly unknown outside a verifiable checkout. */ }
writeFileSync(resolve(packageDir,'dist','build-identity.json'), JSON.stringify({schemaVersion:1,packageName:metadata.name,packageVersion:metadata.version,buildCommit,sourceState})+'\n');
