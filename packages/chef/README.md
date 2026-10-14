# Zeer Chef (public-data prototype)

Chef reads complete public Zcash data from Prep, invokes trusted TypeScript
handlers, commits application entities to developer-owned PostgreSQL, and serves
an authenticated read-only GraphQL API. This private workspace package is not
published to npm. The current slice has no viewing-key scanner or private memos.

Install the repository with `npm ci`, build with `npm run build:chef`, and follow
the [public example](https://github.com/EndPx/zeer/blob/main/examples/chef-public/README.md).
For installation into a separate consumer project, use the
[local tarball packaging instructions](https://github.com/EndPx/zeer/blob/main/docs/PACKAGING.md).
Node 24.14+ is required
for the validated native TypeScript config path. Use erasable TS syntax.

```sh
node packages/chef/dist/cli.js codegen --config examples/chef-public/chef.config.ts
node --env-file=.env packages/chef/dist/cli.js migrate --config examples/chef-public/chef.config.ts
node --env-file=.env packages/chef/dist/cli.js sync --config examples/chef-public/chef.config.ts --to 2048
node --env-file=.env packages/chef/dist/cli.js serve --config examples/chef-public/chef.config.ts
```

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
PostgreSQL's atomic block transaction.

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
and `delete` operate inside one block transaction with before-images and a
checkpoint. A failed block rolls back all its writes; earlier committed blocks
remain. Contexts cannot be used after their transaction finishes. BigInt values
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
Changes in imported helper modules must increment `handlerVersion` because the
entry-file fingerprint does not discover the whole module dependency graph.

Handlers are trusted executable code, not a sandbox. Supported handlers are
deterministic and use only the entity context for effects; network calls, payments,
email, randomness and wall-clock inputs are outside this supported contract.
There is no transactional outbox in this slice.

GraphQL supports scalar entities, equality filters, ID-order cursor pagination
and `_meta` checkpoint data. It has no mutations, relations, subscriptions,
introspection, fragments or executable directives. A bearer token is required.
See the example for request, response and concurrency bounds. No public
production endpoint or Neon compatibility result is claimed.

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
