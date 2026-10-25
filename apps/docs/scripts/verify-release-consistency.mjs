import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root = new URL('../../../', import.meta.url);
const read = name => readFile(new URL(name, root), 'utf8');
const chef = JSON.parse(await read('packages/chef/package.json'));
const cli = JSON.parse(await read('packages/cli/package.json'));
const record = JSON.parse(await read('docs/CHEF_070_RELEASE.json'));
assert.equal(chef.version, '0.7.0');
assert.equal(cli.version, chef.version);
assert.equal(cli.dependencies['@zeer-dev/chef'], chef.version);
assert.equal(chef.dependencies['@zeer-dev/prep-client'], '0.1.0');
assert.equal(record.version, chef.version);
assert.equal(record.registryIntegrity, 'PASS');
assert.equal(record.registryInstall.status, 'PASS');
assert.equal(record.latest['@zeer-dev/chef'], chef.version);
assert.equal(record.latest['@zeer-dev/cli'], chef.version);
const guides = ['README.md','docs/CHEF_QUICKSTART.md','packages/cli/README.md',
  ...['overview','quickstart','quickstart-ai','cli-commands','environment-variables','graphql','recovery','latency-at-head','benchmarking','memos','self-hosting','shielded-local'].map(name=>`apps/docs/content/chef-${name}.md`)];
for (const name of guides) {
  const text = await read(name);
  assert.doesNotMatch(text, /@zeer-dev\/(?:chef|cli)@0\.6\.\d+\s+(?:init|$)/m, `${name}: stale install command`);
  assert.doesNotMatch(text, /(?:0\.7\.0 source-build candidate[^\n]*not yet published|unpublished Chef\/CLI 0\.7\.0)/, `${name}: stale release status`);
}
const overview = await read('apps/docs/content/chef-overview.md');
assert.match(overview, /Chef and CLI 0\.7\.0/);
const quickstart = await read('apps/docs/content/chef-quickstart.md');
assert.match(quickstart, /Chef 0\.7\.0/);
const fallback = await read('apps/web/src/app/docs/page.tsx');
assert.match(fallback, /redirect\("https:\/\/zeer\.endpx\.cloud\/docs\/chef\/quickstart\/"\)/);
assert.doesNotMatch(fallback, /@zeer-dev\/chef@0\.1\.0/);
// Historical evidence must keep its measured package identities.
const observations = JSON.parse(await read('apps/docs/static/benchmarks/2026-10-25-chef-operations.json'));
assert.equal(observations.versions.baseline, '0.6.1');
assert.equal(observations.versions.candidate, '0.7.0-candidate');
assert.match(await read('apps/docs/content/chef-benchmarks.md'), /pre-release 0\.7\.0 candidate/);
console.log('PASS: Chef/CLI 0.7.0 guides, matching registry record, canonical website docs and historical benchmark identities');
