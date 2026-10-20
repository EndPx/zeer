# Bounded testnet Chef demo

This example indexes **10,000 real Zcash testnet blocks, 4,510,000–4,519,999
inclusive**, into the fresh `hackathon_testnet_20261020` namespace. It produces a
`BlockSummary` per block with its actual hash, timestamp and transaction count.
The manifest is bound to the project identity. Preserve an existing project;
do not change its configuration to reuse an incompatible checkpoint.

The hosted [Chef Playground](https://zeer.endpx.cloud/app/chef) uses this bounded
example. [Prep](https://zeer.endpx.cloud/app/prep) has its own independently
reported coverage and can query from genesis. Chef demo completion does not
mean that Chef indexed the whole chain.

## Run from a fresh checkout

Follow the requirements and package preparation in the
[developer quickstart](../../docs/CHEF_QUICKSTART.md). From the repository root,
create a **new** standalone directory:

```sh
node packages/chef/dist/cli.js init \
  --dir ../zeer-hackathon \
  --project hackathon_testnet_20261020 --start-height 4510000
cp examples/chef-hackathon/chef.config.ts examples/chef-hackathon/schema.graphql \
  examples/chef-hackathon/demo.json ../zeer-hackathon/
cd ../zeer-hackathon
npm install ../zeer/.tmp/chef-packages/zeer-dev-prep-client-0.1.0.tgz \
  ../zeer/.tmp/chef-packages/zeer-dev-chef-0.1.0.tgz
npm run codegen
npm run typecheck
```

The commands assume the checkout is named `zeer`. Adjust the two tarball paths
if needed. Edit the generated `.env`: set
`PREP_URL=https://zeer.endpx.cloud/api/prep`, leave `PREP_API_TOKEN` blank, and
use your own PostgreSQL connection or the generated local Compose database.
Keep all credentials private. Check `/height` covers the entire demo range.
The public preview has shared quotas; a dedicated source avoids that contention.

```sh
npm run db:up  # skip for an existing PostgreSQL server
npm run migrate

# Terminal 1: leave the read API running during indexing
npm run serve

# Terminal 2: inclusive end, fixed demonstration range
npm run sync -- --to 4519999

# Terminal 3: query already committed entities
npm run query
```

The metadata handler avoids downloading decoded transaction bodies. Prep still
validates every header; batching does not skip blocks. GraphQL returns the
committed prefix and `_meta.height` during backfill. `first` in a GraphQL list is
a result page size, distinct from Prep's automatic scan response budgets.

Stop **only the sync process** with Ctrl+C after it has committed some blocks.
Record `npm run status`, then repeat `npm run sync -- --to 4519999` using the
same `.env`, config, database and namespace. It resumes the durable checkpoint.
After completion, repeating the same command must leave all 10,000 entities
and the final checkpoint unchanged. Never clear the database to demonstrate
resume. Use a new project and schema namespace for a fresh replay.

See the [public demo walkthrough](../../docs/HACKATHON_DEMO.md) for reviewer
steps, source comparison and honest empty-result behavior.
