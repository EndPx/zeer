# Chef application query baseline

For the implemented opt-in partial indexes, run with
`--compare-declared-indexes` instead of `--compare-expression-indexes`. That mode
annotates only `PublicTransaction.minedHeight` and `Block.transactionCount`, uses
the actual `PostgresStore.migrate()` implementation, and records PostgreSQL's
index definitions. The version field remains unindexed. Baseline phases remove
the declared indexes only in this fresh benchmark namespace; this is not an
operator procedure for modifying an existing application. Both modes preserve
the same read SQL, rows, authorization and keyset contract.

Use `write_cost.mjs --oracle FILE --anchor GENESIS_HASH --out
benchmarks/results/NEW.json` with `CHEF_QUERY_DATABASE_URL` to measure the
maintenance tradeoff separately. It processes the genuine oracle's first 2,048
blocks in five alternating fresh namespaces per variant, commits through
`PostgresStore.apply`, and independently verifies complete entity digests. The
anchor must be the known predecessor hash of height one, for example the admitted
archive catalog's first segment predecessor. It also rolls back/replays the last
three blocks and verifies the exact surviving prefix and restored projection.
PostgreSQL fsync, synchronous commit and full-page writes must remain enabled.
This isolates persistence and index maintenance: source fetching, actual-node
reorg detection and schema initialization are outside those timers. The
application projection writes each final block summary directly; it is not the
entire default handler's read/modify sequence or a whole-chain ingestion benchmark.

This query-only harness measures the existing public example's developer
workflows through authenticated HTTP GraphQL and records PostgreSQL
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` for the corresponding production SQL.
It is a baseline and an optional database-index experiment, not a public
performance result or evidence of whole-chain ingestion.

The four workflows are:

| Workflow | Application use | Query shape |
| --- | --- | --- |
| Transaction detail | Open a transaction from an explorer or activity feed | `PublicTransactionById`, three ID positions |
| Transactions in a block | Inspect a busy block without downloading the entire projection | `minedHeight` equality, 100 rows, first and next pages when available |
| Version browser | Examine protocol-version cohorts | Rare and common version equality, 100 rows, first and middle ID cursors |
| Block summaries | Read handler-produced per-block transaction counts | `BlockList`, busy-count equality and unfiltered lexical ID pagination |

The API currently orders IDs lexically. Block IDs are decimal strings, so their
order is not numerical height order. The harness preserves that contract and
does not invent a range-filter or aggregate-query feature. Block counts are
application aggregates already produced by the public example's handlers.

The default input is the committed genuine early-mainnet projection oracle in
`benchmarks/fixtures/mainnet-public-2048/oracle.json.gz`. Pass `--oracle` to use
another independently verified projection with the same `blocks` and
`transactions` shape. Both compressed `.gz` and ordinary JSON are accepted.
Input bytes, entity-content digest, provenance, source range, and checkpoint are
recorded locally. Conflicting counts and duplicate identities are rejected.

An explicitly selected synthetic dataset uses reproducible hash IDs, thin/busy
blocks, exact integer strings, and a documented skew in version frequency. It
is useful for larger-table selectivity tests, but its blocks, transactions and
version distribution are not real chain observations.

## Run on the isolated PostgreSQL experiment host

Build Chef first and inspect host resource health under the existing experiment
ceiling. The harness requires `pg`, Chef and Prep client from the repository's
existing installation; it introduces no dependencies. The database environment
variable must be supplied explicitly. The default name is
`CHEF_QUERY_DATABASE_URL`; a DSN is never printed or written to a report.

```sh
npm ci
npm run build:chef
node --test benchmarks/chef/query/fixture.test.mjs

# Set CHEF_QUERY_DATABASE_URL through the operator's existing secret environment.
node benchmarks/chef/query/run.mjs \
  --out benchmarks/results/chef-query-public-baseline.json

# Run baseline before experimenting with indexes on exactly the same rows.
node benchmarks/chef/query/run.mjs \
  --out benchmarks/results/chef-query-public-expression-comparison.json \
  --compare-expression-indexes

node benchmarks/chef/query/run.mjs \
  --dataset synthetic --rows 200000 \
  --out benchmarks/results/chef-query-synthetic-expression-comparison.json \
  --compare-expression-indexes
```

Use a fresh output path for each run; exclusive creation refuses an existing
report. Generated evidence must stay under ignored `benchmarks/results/`.
Use `--dsn-env NAME` for a different environment variable. `--rounds` accepts
5–20, defaults to five, and `--samples` accepts 1–50, defaults to five HTTP
samples per workload per phase. No cache-flush or planner-forcing setting is
used. One request is in flight; query admission remains at its existing limit.

Each run creates only one fresh randomly named `chef_q_<hex>` namespace through
Chef's explicit migration API. It refuses an existing namespace, holds the
ordinary writer advisory lock, and seeds the query projection directly in one
transaction. This avoids conflating source ingestion with serving latency.
The seed is labelled as a direct query-fixture import. It does not contain a
complete block/undo history and must not be used for runtime or reorg tests.
Neither the namespace nor its rows are dropped afterwards. Stop only the
isolated experiment services through the existing operator workflow.

For each phase, the harness verifies SQL rows and complete GraphQL entity fields,
including exact BigInt strings and pagination cursors, against an independent
in-memory fixture oracle. It verifies the entire persisted entity digest and
checkpoint after every phase. Authentication rejects a missing token, and
reconciling state rejects a query before measured reads begin.

Each case has an explicit untimed HTTP warmup. SQL plans execute after a checked
SQL read. Cases rotate by round; HTTP order alternates by sample. When comparison
is enabled, five paired rounds alternate baseline-first and candidate-first.
Raw HTTP latencies, response byte counts, complete JSON plans, plan settings,
per-index build seconds, per-index bytes, and total table/index footprint are
retained. Min, median, p95 and max summarize repeated warm-cache HTTP samples;
they are not cold-cache, WAN or capacity measurements. SQL instrumentation time
is kept separate from HTTP latency.

## Index experiment and decision boundary

The optional experiment adds three native JSONB expression indexes to this
fresh fixture namespace:

```sql
CREATE INDEX qe_mined_height ON <fixture>.entities (entity, (data -> 'minedHeight'), id);
CREATE INDEX qe_version ON <fixture>.entities (entity, (data -> 'version'), id);
CREATE INDEX qe_transaction_count ON <fixture>.entities (entity, (data -> 'transactionCount'), id);
```

Those expressions match the current parameterized equality predicate and
preserve the existing ID keyset order. The primary key remains the baseline for
entity/ID details and unfiltered pagination. Index creation, drop, and analyze
timings are recorded separately; index changes occur outside the measured HTTP
samples. Repeated phases retain the same dataset, queries, parameters and limits.

Index maintenance overhead during application ingestion and reorg replay is
**unmeasured** in this harness. The baseline-only fixture import duration does
not establish that overhead. New indexes also cover entities with missing
fields, so their storage footprint must be assessed rather than assumed cheap.
Do not turn an improvement in one selective lookup into a default-index policy.
An opt-in developer field-index declaration is a possible follow-up only if
actual plans and repeated HTTP samples justify it, and write/reorg acceptance
still passes. A GIN containment experiment would change predicate shape and
needs its own equivalence checks; this harness does not add it speculatively.

Production code pointers:

- `packages/chef/src/store.ts`: `read` establishes one repeatable-read snapshot;
  `get` uses the entity/ID primary key; `list` builds parameterized JSONB equality
  and an ID cursor, then orders/limits rows.
- `packages/chef/src/graphql.ts`: entity resolvers validate filters, request an
  extra row for pagination, preserve BigInt strings, and keep the read/auth gates.
- `packages/chef/src/schema.ts` and `types.ts`: the model currently declares
  scalar fields only. Any eventual opt-in index contract must validate field
  names and contribute to durable project identity rather than silently change
  existing operator-owned namespaces.

All timings, SQL plans, comparisons and run outcomes remain local. Publish only
the harness, fixture generation rules and methodology under the current policy.
