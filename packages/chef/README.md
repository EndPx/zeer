# Zeer Chef (developer preview)

Chef reads complete public Zcash data from Prep, invokes trusted TypeScript
handlers, commits application entities to developer-owned PostgreSQL, and serves
an authenticated read-only GraphQL API. The default profile reads public data. An explicit local
[watch-only receipt profile](../../docs/SHIELDED_RECEIPTS.md) adds a native scanner
and `receipt` handlers for authorized testnet notes. Viewing keys stay in the
operator's environment. The public playground publishes only one selected Zeer
demo receipt. See the [shielded inbox](../../examples/shielded-inbox/README.md)
for local indexing and the `readShieldedTransaction` helper for a known TX ID.

## Quickstart

Initialize a standalone project with:

Requires Node 24.14+ on Linux x86_64 or WSL2, pnpm (or npm) and PostgreSQL.

```sh
pnpm --package=@zeer-dev/chef@0.2.0 dlx zeer init
cd my-indexer
pnpm install
pnpm run codegen
pnpm run typecheck
```

Answer the project name, folder and start block questions. The defaults are
`my_indexer`, `my-indexer` and `latest`. Latest reads the chosen Prep's ready,
full-data testnet archive height once and saves a numeric start. Use an explicit
`0` for genesis history or another height for offline setup. Lookup failures do
not silently choose a different range. `--prep-url` overrides `PREP_URL`; otherwise
the public testnet Prep is selected and written to the new `.env`. Existing private
tokens are not sent to that default source or copied into generated files.

For a short command after one global installation, use
`pnpm add -g @zeer-dev/chef@0.2.0`, then `zeer init`. The `zeer-chef` alias remains.
With npm, use `npx @zeer-dev/chef@0.2.0 init` and the matching npm project scripts.
Scripts should supply all three setup flags and `--json`; redirected sessions
never prompt. Use `zeer <command> --help` for details and `zeer --version` to check
the installed version. Cancelled questions or height lookups create no project.

Set `PREP_URL` and database settings in the generated `.env`, then migrate before
running sync and serve. Follow the [complete quickstart](https://zeer.endpx.cloud/docs/chef/quickstart/)
for source coverage, database setup and your first GraphQL query.

For filtered indexing from block 0, see the
[Orchard metadata example](../../examples/chef-filtered/README.md).
`sync.transactionFilter` pushes public predicates to Prep; `transactionMetadata`
receives only `txid`, block height, position, version and locktime. Use the existing
`transaction` handler for decoded bodies; the two modes are mutually exclusive.
Block-only indexers request no transactions. Block handlers always run for every
scanned block, even when the transaction filter matches nothing.

```ts
sync: {
  pageSize: 1000, // 1..1000 whole blocks per Prep response
  batchSize: 32, // 1..100 blocks per atomic PostgreSQL transaction
  transactionFilter: { has_orchard: true },
},
```

Supported predicates are Prep's `txids`, `versions`, `has_sapling`, `has_orchard`
and `transparent_output_addresses`; predicates combine with AND and entries
within an array with OR. Empty arrays match nothing. Filters do not expose
encrypted shielded data. All headers remain present and contiguous: a page with
zero matching transactions still advances the checkpoint after validation.
Fixed scans remain bounded to 1,000 blocks per request. With a Prep server
advertising `max_adaptive_scan_blocks`, opt into `sync.adaptiveScan: true` and
set `pageSize` up to 1,000,000. The server may return fewer blocks due to its
500 ms soft work slice, 512 KiB target or 4 MiB hard response ceiling. Chef still verifies all headers
and commits bounded batches; it does not replace chain checks with a sparse jump.
Do not enable this against older servers, which reject the unknown scan mode.

Existing configs retain defaults of 16 blocks per page and one block per commit.
New scaffolded projects use metadata handlers and explicit 1,000/32 settings.
Page/commit sizes are independent; response byte limits may shorten a page.
Changing entry configuration changes project identity. Use a new namespace when
adopting a different filter or handler rather than attaching it to old entities.

Install the repository with `npm ci`, build with `npm run build:chef`, and follow
the [public example](https://github.com/EndPx/zeer/blob/main/examples/chef-public/README.md).
For installation into a separate consumer project, use the
[local tarball packaging instructions](https://github.com/EndPx/zeer/blob/main/docs/PACKAGING.md).
Node 24.14+ is required
for the validated native TypeScript config path. Use erasable TS syntax.

For a standalone testnet project, use **[Run your own Chef project](https://github.com/EndPx/zeer/blob/main/docs/CHEF_QUICKSTART.md)**.
After obtaining the local package artifacts, the installed CLI can scaffold a new
directory with `zeer-chef init --dir ./my-indexer --project my_indexer --start-height 1000`.
It creates config, schema, handlers, env files, optional local PostgreSQL and npm
commands for the full GraphQL workflow. It never overwrites existing directories,
installs dependencies or starts services automatically. A real Prep URL with matching
testnet coverage must be supplied; no public hosted endpoint is assumed.

```sh
node packages/chef/dist/cli.js codegen --config examples/chef-public/chef.config.ts
node --env-file=.env packages/chef/dist/cli.js migrate --config examples/chef-public/chef.config.ts
node --env-file=.env packages/chef/dist/cli.js sync --config examples/chef-public/chef.config.ts --to 2048
node --env-file=.env packages/chef/dist/cli.js serve --config examples/chef-public/chef.config.ts
```

For an interactive demo, start `serve` before starting `sync` or `follow` in a
second terminal. The API and writer can run as separate Node processes against
the same project. Queries expose committed data with `_meta.height` as their
coverage; source reconciliation may temporarily close the read gate. Run only
one writer per project. This lets the first committed results appear before
historical catch-up finishes.

The starter's batch size of 32 is a starting configuration. Smaller batches add
commits and do not automatically improve query latency. Measure indexing time and
query latency together, sampling queries during active indexing. Separate Node
processes can still share a CPU quota and PostgreSQL bottlenecks; process separation
alone does not guarantee a lower p99. Keep comparable resource limits when tuning.

Use `status` to compare the persisted checkpoint with one bounded Prep metadata
observation. It reads PostgreSQL first and requests Prep metadata with a five-second
timeout. It does not acquire a writer, migrate, reconcile, or change the read gate.
It reports a blocked database before any source problem. An unavailable or unready
Prep, a source identity mismatch, or a blocked project returns a diagnostic on stdout
and fixed guidance on stderr with exit code one. A ready historical archive can be
usable while its source freshness remains unknown. A successful `status` observation
does not establish current canonical consensus or confirm that a separate writer
is running.
If the checkpoint is ahead of Prep's archive, status reports `reconciliation_needed`
and exits with failure until a writer validates/reconciles the retained branch.

```sh
node --env-file=.env packages/chef/dist/cli.js status --config examples/chef-public/chef.config.ts --human
node --env-file=.env packages/chef/dist/cli.js sync --config examples/chef-public/chef.config.ts --follow --poll-seconds 5 --json
```

Output defaults to readable text on an interactive terminal and newline-delimited
JSON elsewhere. `--human` and `--json` select either format explicitly and cannot
be combined. Installed consumers use the same flags with `zeer-chef`. JSON retains
structured progress and failures. The diagnostic separates Prep HTTP availability,
Prep readiness, the archive's indexed height, and source freshness. Source height
is reported only as a timestamped Prep observation from a ready follower; it is
unknown for an unready source or historical snapshot. Chef lag measures remaining
blocks to Prep's indexed height, not an invented current chain tip. The persisted
`ready`, `reconciling`, or `blocked` read gate is reported separately from this
read-only source observation.

Sync output labels the invocation as `backfill` or `follow` and includes its actual
durable checkpoint on progress, completion, observed source loss, and graceful stop.
`metricsScope: "completed_pages"` identifies counters and rates from successfully
returned pages in this invocation. They exclude previously indexed work and any
committed prefix of an interrupted page; the checkpoint still includes that prefix.
No ETA is reported. Source outages are detected by the writer's requests and polling,
not instantaneously. SIGINT/SIGTERM during finite-sync metadata preflight or polling
emit `stopped` and release resources. A handler already executing may finish its
current block before graceful cancellation; forced process interruption relies on
PostgreSQL's atomic transaction. With `sync.batchSize > 1`, cancellation or
failure rolls back the current batch; earlier committed batches remain.

For `REBUILD_REQUIRED`, retain the old namespace for inspection, choose a new
project name, run `migrate`, and replay from a Prep archive covering `startHeight`.
Independently verify the new projection before switching readers. Chef does not
automatically reset a blocked namespace. Auth failures direct the operator to
the appropriate token; missing configuration, schema, migration, unavailable
ranges, writer contention and identity mismatches have fixed actionable guidance.
Third-party exception messages, SQL and credentials are omitted from CLI errors.

Migration is explicit. Each project owns a marked `chef_<project>` namespace.
The framework refuses unmarked existing namespaces and configuration/schema
identity mismatches. One session-level advisory lock admits one writer.
The database operator supplies access and owns backups; no hosting or billing
service is provisioned by Chef.

Block and transaction handlers execute in canonical order. Entity `get`, `set`
and `delete` operate inside a transaction with per-block before-images and a
checkpoint. By default a failed block rolls back its writes; with batching the
entire current batch rolls back. Earlier committed batches remain. Contexts cannot
be used after their block handler context closes. BigInt values
are JS `bigint` in handlers and canonical decimal strings in storage/GraphQL.

Within a block, entity operations run in invocation order. `set` snapshots its
input immediately; `get` returns a separate decoded copy and observes prior
staged writes/deletes. Repeated writes coalesce by entity/key. Before commit,
bounded SQL batches capture each key's original database value and flush its
final value or deletion, within the same block transaction as the checkpoint.
An entity-operation failure still rejects the block even if handler code catches
or discards its promise. A database flush failure rolls the whole block back.

Limits are 10,000 mutation calls, 10,000 cached keys, 10,000 queued operations,
and 16 MiB of accounted serialized cache/queued payload per block. Flushes contain
at most 500 keys and 4 MiB of serialized input. These byte budgets are not a cap
on total JavaScript heap/RSS. A limit failure rejects the block; writes are never
silently omitted. Existing project schemas and handler interfaces are unchanged.

Reorg recovery uses retained block hashes and before-images. Reads are unavailable
while the framework reconciles/replays or cannot validate its source, and deep
reorgs enter a rebuild-required state. The caller starts a fresh project namespace
for changed handlers/schema; automatic migration and replay cutover are deferred.
If a Prep follower temporarily exposes a prefix below Chef's retained ancestor
window while rebuilding replacement segments, Chef remains reconciling when the
observed upstream tip can still supply that window. It resumes comparisons once
the required history is published. A proven deeper fork, a permanently shorter
source or an insufficient historical snapshot still requires a rebuild; missing
temporary follower history does not itself establish that proof.
Stop the old writer and run `migrate` when upgrading: reconciliation reason and
`undo_floor` are additive state columns. The persisted undo floor never decreases
after a rollback; deleted undo history cannot be recreated by moving a checkpoint
backward. For legacy projects, migration conservatively uses the earliest retained
block as an ancestor, which may exclude rollback through the initial anchor.
Restart all processes using the upgraded package; do not run older writers against
the upgraded namespace. A source outage reopens a verified prefix after recovery, including
after restart; reorg replay remains gated until its target. Legacy unclassified
reconciliation stays conservative, and an unmigrated state fails closed.
Changes in imported helper modules must increment `handlerVersion` because the
entry-file fingerprint does not discover the whole module dependency graph.

Handlers are trusted executable code, not a sandbox. Supported handlers are
deterministic and use only the entity context for effects; network calls, payments,
email, randomness and wall-clock inputs are outside this supported contract.
There is no transactional outbox in this slice.

GraphQL supports scalar equality, bounded ranges on required indexed Int fields,
deterministic Int/ID ordering, signed revision-bound cursors and `_meta` checkpoint data.
Authenticated `GET /status` reads cached source freshness without RPC and remains
available during entity reconciliation. See [the consumption API contract](../../docs/CHEF_CONSUMPTION_API.md)
for cursor recovery and the required additive migration from 0.1.x. It has no mutations, relations, subscriptions,
introspection, fragments or executable directives. A bearer token is required.
See the example for request, response and concurrency bounds. No public
production endpoint or Neon compatibility result is claimed.

Each GraphQL server admits two active requests and up to eight FIFO waiters.
Authentication, route/method and content-type checks precede admission; waiting
requests stay paused with no application body reader or database snapshot.
The fixed queue deadline is 250 ms. A full queue or expired wait returns HTTP 503
with `Retry-After: 1`; Chef does not automatically retry. Include queue waiting in
the caller's overall latency and timeout budget. This bounded burst allowance is
not a sustained-throughput guarantee. The existing 10-second body deadline starts
only after admission, and the 64 KiB body and 2 MiB response limits still apply.

Queued disconnects remove their waiter immediately. Once admitted, the request
holds its active slot until application work completes and its response finishes
or closes; a disconnected in-flight database read keeps its slot until it settles.
Server close rejects waiters and cancels admitted body readers. A database snapshot
and readiness check are acquired only after admission, so a queued request observes
the checkpoint/read gate when its read starts, including reorg state changes.

Each server instance reuses successfully parsed and validated GraphQL documents
through an LRU bounded to 64 entries and 256 KiB of retained UTF-8 query source.
That byte budget does not describe total AST heap. Invalid documents are never
retained. Authentication, body/admission limits and request-shape checks still
run before cache lookup; every request performs fresh variable/operation coercion,
checkpoint/readiness checks and a repeatable-read database snapshot. Query results,
variables and checkpoints are never cached. See the
[request profiling harness](../../benchmarks/chef/profile/README.md) for separate
instrumented attribution and ordinary HTTP comparisons.

Field equality indexes are opt-in through one argument-free `@index` annotation
in the entity schema. For example, a block transaction browser can declare
`minedHeight: Int! @index`, and a block-summary projection can declare
`transactionCount: Int! @index`. `migrate` creates partial PostgreSQL B-tree
indexes on that entity's native JSONB field value plus ID. Unannotated schemas
create no extra field indexes and retain their existing model fingerprints.

Annotations support `Int`, `Boolean`, `BigInt`, and non-primary `ID` fields,
including nullable fields, with at most eight indexes per project. The primary
`id` already has an index. `String` is excluded because its larger value bound
can exceed PostgreSQL B-tree tuple limits. Equality types, null handling, exact
BigInt strings, pagination, authorization and snapshot/read gates stay unchanged.
Adding or removing an annotation changes model identity: choose a fresh project
namespace, migrate and replay before switching readers. Existing projects are
not automatically altered when the application schema changes. Indexes consume
space and add work to writes and undo/replay; select fields from actual query
plans instead of annotating every filter. See the
[query-index contract](https://github.com/EndPx/zeer/blob/main/docs/CHEF_QUERY_INDEXES.md)
and [schema-evolution procedure](https://github.com/EndPx/zeer/blob/main/docs/SCHEMA_EVOLUTION.md).

```sh
npm run build:chef
# Use a disposable database; integration tests create isolated generated namespaces.
CHEF_TEST_DATABASE_URL=postgresql://... npm run test:chef
```

PostgreSQL tests skip when their environment variable is absent. Such a run is
not a database integration proof. Keep database durability settings, source
coverage and deployment limits explicit in evidence.
