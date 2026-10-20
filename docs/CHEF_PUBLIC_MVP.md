# Chef public-data first slice

Accepted 14 October 2026: hold Prep at its current MVP, begin Chef with **public
data only**, then benchmark. Viewing-key scanning is deferred. This contract
supersedes the scanner-first sequencing of the earlier Chef proposal for this
slice; it does not certify the older shielded/two-store/outbox gates.

## Delivery

- One local, unpublished `@zeer-dev/chef` package with TypeScript handlers and generated
  entity types; CLI `codegen`, `migrate`, `sync`, `serve`, `status`.
- Existing Prep HTTP/SDK as source; ordered block then transaction handlers.
- Developer-supplied PostgreSQL, one marked namespace per project, one writer.
- Entity writes, first before-images, canonical block journal and checkpoint in
  one transaction per block by default, or one bounded transaction per configured
  batch. A failed batch never silently advances its checkpoint.
- Bounded application undo/replay on a changed source branch; unavailable reads
  during reconciliation or observed source unavailability. This conservative
  first-slice policy supersedes the earlier proposed stale-read outage behavior.
- Authenticated read-only GraphQL with bounded scalar schemas, equality filters,
  fixed-ID pagination and exact BigInt decimal strings.
- Reproducible public example and actual PostgreSQL integration evidence.

Handlers are trusted operator code. Network calls, time/random-dependent results
and external side effects are outside the deterministic supported contract. No
outbox is implemented here. Entry-file/schema/config fingerprints bind a project;
changes to imported helper logic require a `handlerVersion` bump. Rebuild into
a new project namespace when identity changes; automatic migration/replay cutover
is not implemented. Namespace ownership is a guard against accidental writes,
not database credential isolation from the operator.

Prep and Chef admit histories starting at height 0 when the archive covers genesis.
Older bounded fixtures starting later are not genesis-inclusive evidence.
Unsupported source ranges, deep reorgs, malformed batches and oversized entities
fail visibly. Private wallet data, hosted services, npm publication, subscriptions,
joins, dashboards and arbitrary SQL handlers are deferred.

The optimized writer stages ordered entity operations in a bounded per-block
cache, then flushes unique final values and their original undo images in SQL
batches inside the existing atomic block transaction. The handler interface and
database schema remain the same. Exact cache, queue and flush limits are defined
in the [package contract](../packages/chef/README.md); exceeding them rejects the
block rather than advancing a partial checkpoint. SQL flush time is accounted
under transaction overhead, so compare complete durable elapsed time when judging
performance changes.

Filtered backfill supports explicit public Prep predicates, lightweight metadata
handlers, up to 1,000 headers per fetched page, and up to 100 blocks per commit.
All headers are still validated; empty filtered blocks need no transaction handler
or entity writes. Per-block undo remains available inside committed batches.
See the [filtered example](../examples/chef-filtered/README.md). This does not
implement speculative prefetch or a generic cross-block entity preload system.
Compatible Prep servers additionally support opt-in time/byte-bounded adaptive
scans via `sync.adaptiveScan`; Chef still requests every header. See
[the query contract](PREP_QUERY.md) for limits and continuation semantics.

## Benchmark separation

The user supplied Envio's [indexing metrics guide](https://docs.envio.dev/docs/HyperIndex/benchmarking)
and [data retrieval overview](https://docs.envio.dev/docs/HyperSync/overview).
Adopt the separation of application indexing from source retrieval:

| Product | Primary task | Timing endpoint |
| --- | --- | --- |
| Prep | Full scan, sparse public matches, selected fields | Requested equivalent records received/decoded |
| Chef | Source reads, handlers and durable application projection | Final entity/checkpoint commit |

Chef uses fresh project namespaces for repeated historical runs. Report committed
transactions/s, blocks/s, elapsed time, fetch time, handler time **including entity
I/O**, transaction overhead, Node CPU/RSS and correctness. Do not pretend to
separate handler CPU from database calls without instrumentation. Schema setup,
oracle collection, persistence verification and GraphQL validation are separate
timers. Throughput at the live head measures block arrival, not catch-up capacity.

Zcash public queries use transaction IDs, transparent outputs, block metadata and
public shielded-pool structures. They are not EVM event-log queries and cannot
filter encrypted memo text or shielded recipients without separate authorized
scanning. A prepared lookup comparison is supplementary, not an indexing ranking.

The full-chain request is conditional on feasibility. Pin tip height/hash, source
coverage, resource limits and common output before a run. The fresh preflight is
[recorded separately](CHEF_BENCHMARK_PREFLIGHT.md). Unrun whole-chain cases get no
invented duration or extrapolated speedup; provider ineligibility is not a
performance failure. External framework comparisons require equivalent durable
outputs, not merely the same transaction IDs.

## Acceptance evidence

- [x] TypeScript build, CLI/schema/API tests and real PostgreSQL transaction tests.
- [x] Runtime restart, source-unavailability gating and application reorg tests.
- [x] Actual Prep -> TS handlers -> PostgreSQL -> GraphQL example.
- [x] Five fresh bounded indexing runs with independent source/output verification.
- [x] Explicit whole-chain feasibility and eligible external comparison evidence.
- [x] Independent review, source/runtime hashes and cleanup of isolated services.

Execution evidence and comparisons are retained locally under
`benchmarks/results/`; see the [harness](../benchmarks/README.md) for reproduction.
An independent application-framework ranking requires equivalent durable entity
workloads and resource allocations. Native explorer ingestion, prepared lookups
and Chef application ingestion must be measured separately. Whole-chain
execution remains unproven.
