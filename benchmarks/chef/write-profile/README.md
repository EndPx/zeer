# Chef prepared write replay and SQL profile

This bounded harness profiles the actual compiled `PostgresStore.apply` over a
fresh, marked PostgreSQL namespace. It uses the canonical public oracle format
already accepted by `benchmarks/chef/query/fixture.mjs`: `blocks` with final
`Block` entities and `transactions` with final `PublicTransaction` entities.
Both legacy and modern public oracle captures work; the range must be contiguous,
contain at most 32,768 blocks and 500,000 transactions, and have more blocks than
the warm prefix (32 by default).

Build Chef first using the existing workspace build command. Supply a disposable
database through an environment variable, with PostgreSQL `fsync`,
`synchronous_commit`, and `full_page_writes` all `on`.

```powershell
node benchmarks/chef/write-profile/run.mjs --oracle benchmarks/fixtures/mainnet-public-2048/oracle.json.gz --schema examples/chef-public/schema.graphql --module packages/chef/dist/store.js --anchor-hash <verified-first-block-predecessor> --profile true --dsn-env CHEF_WRITE_DATABASE_URL --out benchmarks/results/write-profile-baseline.json
node --test benchmarks/chef/write-profile/*.test.mjs
```

`--anchor-hash` is required: obtain the exact predecessor from the independently
captured block/header source. Do not substitute an invented hash. `--warmup N`
changes the excluded warm prefix, and permits zero for diagnostic runs. All
replayed blocks, including warmup, are verified. Each invocation creates a new
random `chef_wp_*` namespace, migrates it, acquires its actual advisory writer
lock, and retains its rows after closing all connections. Existing namespaces
are never selected as a write target. Outputs must be new files below the
ignored `benchmarks/results/` directory.

The prepared workload repeats the public example's entity operations: set the
block count to zero, then for each transaction set its entity, get the block,
and set the incremented block count. Transactions run in oracle txid order. This
preserves the example's mutation/cache/coalescing work for its order-independent
counts. It excludes Prep fetch, decoding, decoded-field validation, module
startup, migration, verification, and report serialization from apply timers.
It is storage replay evidence, not full pipeline throughput.

With `--profile true`, a measurement-only `pg.Client.prototype.query` wrapper
uses `AsyncLocalStorage` only around each `apply`. Setup, verification and close
queries are excluded. The wrapper records count, elapsed client-observed SQL
time and failure count by category: BEGIN, locked state read, entity get, undo
insert, entity upsert/delete, block insert, checkpoint update, separate journal
pruning, experimental `history_prune` and `block_bookkeeping`,
COMMIT, ROLLBACK, or other. It records no SQL text, parameters, DSN, or database
error messages. Per-block wall timing includes instrumentation overhead. Unknown
SQL stays visible under `other` and should be inspected before interpreting a
profile after store changes.

The `history_prune` and four-operation `block_bookkeeping` classifiers preserve
SQL shapes from optimization experiments for retained evidence.
Neither query shape is the accepted production default; the accepted store
keeps its original separate bookkeeping statements. Static fixture regressions
preserve classification of both experiments without depending on production
source containing them.

Use `--profile false` for every actual before/after timing run. This mode never
installs the query wrapper. Compare multiple alternating baseline/candidate
invocations using identical oracle, schema, anchor, warmup and database settings;
point `--module` at the respective compiled store module. Keep its adjacent
relative imports intact. Profiled modules must resolve the same `pg.Client`
instance as this harness; use the store module from the harness's own checkout
with its shared installed dependencies. Every profiled apply must observe
exactly one BEGIN and one COMMIT, or the run fails with
`PROFILE_SQL_NOT_OBSERVED`. A separately installed `pg` copy in another checkout
can bypass the wrapper and is rejected by this guard. Keep the shared schema encoder identical across
variants. Each report pins the store module, schema and raw oracle SHA-256.
Report the steady total, median and p95 apply wall times, with SQL category
profiles used to explain where work occurs. Timings do not establish a speed
claim from a single run or from instrumented profiles alone.

Verification directly compares every SQL entity row and the final checkpoint
to the prepared oracle in one read-only repeatable-read transaction; identity,
model, network, anchor, readiness and reorg-window checks are also mandatory.
Cleanup failures force FAIL. Reports include Node process resource counters;
the external controller must separately retain PostgreSQL/container CPU/RAM
limits, memory/CPU observations and shared-host activity. No cache eviction is
performed. No report or preserved namespace constitutes public capacity,
live-network ingestion, reorg/recovery, or production-readiness proof.
