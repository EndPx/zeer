# Chef public-data example

This example turns complete public Zcash transaction data served by Prep into PostgreSQL entities and a read-only GraphQL API. Shielded ciphertext remains encrypted; no viewing key is requested.

Use Node 24.14 or newer, install the monorepo with `npm ci`, then build with `npm run build:chef`. Run these commands from the repository root:

```sh
node packages/chef/dist/cli.js codegen --config examples/chef-public/chef.config.ts
npm exec --call "tsc --project examples/chef-public/tsconfig.json"
```

The config uses Node's native TypeScript stripping; use erasable TypeScript syntax. `chef.generated.ts` provides entity and handler types. Native stripping does not type-check; run the explicit `tsc` command before execution. Runtime entity validation still protects database commits. Config files and imported handlers are trusted executable code.

Provide an operator-owned PostgreSQL database and a running full-data Prep endpoint. A local `.env` file can contain:

```dotenv
DATABASE_URL=postgresql://chef:REPLACE_ME@127.0.0.1:5432/chef
PREP_URL=http://127.0.0.1:39368
PREP_API_TOKEN=REPLACE_WITH_PREP_TOKEN_IF_REQUIRED
CHEF_API_TOKEN=REPLACE_WITH_AT_LEAST_16_RANDOM_BYTES
```

Keep that file out of Git. Omit `PREP_API_TOKEN` for an unauthenticated local Prep endpoint. Chef does not automatically load env files; use Node's `--env-file` option or export environment variables. Custom variable names for the source and database can be set with `prepUrlEnv`, `prepTokenEnv`, and `databaseUrlEnv`.

```sh
node --env-file=.env packages/chef/dist/cli.js migrate --config examples/chef-public/chef.config.ts
node --env-file=.env packages/chef/dist/cli.js sync --config examples/chef-public/chef.config.ts --to 2048
node --env-file=.env packages/chef/dist/cli.js status --config examples/chef-public/chef.config.ts
node --env-file=.env packages/chef/dist/cli.js serve --config examples/chef-public/chef.config.ts
```

`migrate` is explicit and creates only the configured Chef project namespace. Other commands do not run migrations. `sync` without `--to` captures Prep's current indexed height and completes at that fixed height. `--to` is inclusive and must already be available. `--follow` continues following Prep with `--poll-seconds 5`; it cannot be combined with `--to`. Ctrl+C stops the loop, finishes any in-flight database transaction, and closes connections. Restart resumes the database checkpoint.

Prep currently serves archives beginning at height 1 or later. This example therefore starts at height 1; it does not claim genesis-through-head completion. The source must contain the entire requested range. The sample's `transparentInputCount` counts `vin` entries, including the coinbase input entry when present.

The transaction entity has seven fields: transaction ID, mined height, version, locktime, serialized size, transparent input count, and transparent output count. Block counts are updated in the same transaction. Amounts, addresses, and memo plaintext are not collected by this example. Source `decoded.size` must be an exact integer string; missing source fields fail the block instead of becoming guessed values.

Query with the Chef token:

```sh
curl http://127.0.0.1:39370/graphql \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $CHEF_API_TOKEN" \
  --data '{"query":"{ PublicTransactionList(first: 10) { items { id minedHeight version locktime sizeBytes transparentInputCount transparentOutputCount } nextCursor } _meta { height hash status } }"}'
```

Lists use ID ascending order and an `after` ID cursor. For example, `where: { minedHeight: 2048 }` selects exact matches. BigInt fields are decimal strings in GraphQL and `bigint` in TypeScript handlers. The initial API has no mutations, subscriptions, introspection, fragments, or directives. It supports at most five root fields, 100 selected fields, depth five, 100 items per list, and two active requests. Responses are capped at 2 MiB. Bind defaults to loopback; external deployment needs an operator-managed TLS proxy and access controls.

JSON progress is emitted after each committed page. The completion JSON records blocks and transactions committed during that invocation, captured target, initial/final checkpoint, and elapsed milliseconds. `prepRequests` counts calls to Prep, including height and reconciliation-header requests. `fetchMs` measures Prep requests, `handlerIncludingEntityIoMs` includes entity database I/O inside handlers, and `transactionOverheadMs` measures the remaining block-application time. `blocksPerSecond` and `transactionsPerSecond` divide committed invocation counts by total elapsed time. Overall elapsed time also includes reconciliation, checkpoint reads and other orchestration. These are application indexing measurements, not node synchronization or Prep archive-build timings. Benchmark a fresh project for a complete backfill; a resumed project measures only remaining work.

GraphQL returns HTTP 503 while the database checkpoint is `reconciling` or `blocked`. Entity writes and the block checkpoint commit atomically, and rollback restores prior entity values before replay. Handlers must remain deterministic and confine effects to `context.entities`: external HTTP calls, email, file writes or payments do not participate in the database transaction and can repeat on retry/reorg. Invocation counters describe successfully returned pages; an interrupted or failed page may already have committed earlier blocks. Use `status` and the durable database checkpoint to determine the restart position.

Project identity hashes config bytes, schema fingerprint, network, start height, project name, reorg window, handler version and Prep URL. Tokens are excluded so rotation does not require rebuilding. Changes to imported helper modules must increment `handlerVersion`. An identity mismatch requires a new project namespace and replay; in-place schema/handler migration and destructive reset commands are deferred.
