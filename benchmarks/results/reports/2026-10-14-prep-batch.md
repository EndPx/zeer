# Prep batch lookup: pinned reference review and same-session comparison

Executed 14 October 2026, Asia/Jakarta. The [pinned ShieldedLabs fork review](../../../docs/SL_CIPHERSCAN_RESEARCH.md)
identified useful batch-transport, grouped-read and metadata-first patterns.
The new code is independently written in Zeer around its existing query engine;
no external source, WASM or dependencies were copied, and Zeer's license is unchanged.

## Delivered behavior

`POST /transactions` completes a bounded ID lookup under one immutable snapshot.
It accepts up to 128 lowercase ID entries over a required range of at most 10,000
blocks, returning at most 4,096 canonical transaction locations and 4 MiB.
Default fields are public metadata; explicit raw/decoded projections retain the
same byte bound. The existing 64 KiB request limit, two shared active-query
permits, authentication, cancellation and 30-second worker budget apply.

Requested duplicates do not duplicate output rows, but all canonical occurrences
remain ordered by height/index. `missing_txids` is unique in request order and
only describes IDs absent from the successfully completed requested range.
Read, pagination, response-limit and timeout failures reject the whole request.
`complete: true` is never used to represent partial success.

The returned snapshot binds network, archive start, exclusive range end, epoch
and canonical boundary hash. Optional `at` reuses that prefix for another ID set.
The server checks conflicts before source readiness and rechecks the generated
snapshot after response encoding. Same-epoch append beyond the range is allowed;
epoch/boundary changes conflict. This preserves archive consistency, not an
independent consensus/finality guarantee.

`GET /capabilities` reports compiled routes, field lists, filters and limits from
the implementation constants. It does not replace `/height` or `/ready`. The SDK
adds `getTransactions()` and `getCapabilities()` with bounded response validation,
complete ID accounting, snapshot checks, cancellation and typed errors.

## One session, four prepared paths

The same 128 independently selected early-mainnet transactions are requested
from heights 1–2048. All cases return the same normalized seven-field projection.
The batch additionally returns transaction index and snapshot metadata; its index
positions are checked against the retained node `block.tx` order outside timing.
These are equivalent final benchmark records, not identical wire responses.

Five cyclic rounds produce **20 measured visits and 20 verified warmups**.
Every field, record count, location check where applicable, and source check
passed. Only one backend runs at a time. Each backend has **1 CPU / 2 GiB**, and
client plus controller share **1 CPU / 1 GiB**, with zero swap limits. The full
node is stopped. All sources are prepared and warmup precedes each timed pass.

| Case | Median for all 128 records | Min–max | Timed requests/commands | HTTP response body |
| --- | ---: | ---: | ---: | ---: |
| Previous Prep, metadata `/query` pages | **20.654 ms** | 15.496–25.080 ms | 16 HTTP requests | 36,410 bytes |
| New Prep, same `/query` pages | **22.209 ms** | 14.602–32.945 ms | 16 HTTP requests | 36,410 bytes |
| New Prep, `/transactions` batch | **8.901 ms** | 7.573–15.182 ms | **1 HTTP request** | 26,605 bytes |
| CipherScan prepared PostgreSQL | **4.550 ms** | 3.163–7.166 ms | 6 SQL commands | Not measured |

The batch's observed median is **2.321× faster than previous pagination** and
**2.495× faster than pagination on the new binary**. Previous and new pagination
ranges overlap; no performance improvement to the unchanged scan route is claimed.
The HTTP response body is 26.93% smaller despite including an additional index
field and snapshot envelope, because per-page wrappers/cursors are eliminated.
Request counts do not include preflight/readiness or verification calls.

CipherScan SQL remains faster in this session. It performs one principal `ANY`
selection over prepared columns, with read-only transaction and timeout commands
included in the six-command count. Prep also performs HTTP/JSON transport, snapshot
and completeness checks. This is not an isolated storage-engine ranking and does
not measure the ShieldedLabs explorer's deployed REST API. The SQL data was built
by the previously pinned separate Rust indexer at `15d7f528`, not by executing
the reviewed ShieldedLabs fork.

The four cases rotate through five rounds; one position repeats. OS caches are
not dropped, other VPS applications remain running, and five observations are
descriptive rather than universal speed ratios. Startup/index admission, source
preparation, independent equality checks and SQL index construction are excluded
from the request timer and recorded or disclosed separately.

## Validation and operational evidence

- **96 Rust tests**, formatting, Clippy with warnings denied and release build passed.
- **27 SDK tests** and **7 benchmark-driver tests** passed.
- New Rust tests cover duplicate occurrences, scoped missing IDs, empty requests,
  bounds, exact response-byte edges, cancellation, partial/late-page failure,
  append/reorg/rebuilt-prefix conflicts and shared HTTP admission/frame lifetime.
- The real SDK verified all 128 metadata rows and their independent positions,
  two raw transactions, duplicate/missing accounting, empty lookup, snapshot reuse,
  capabilities, and actual epoch/boundary conflict responses.
- A separate real SDK call against three retained genuine NU5 fixture blocks
  verified **17 v4/v5 transactions**, exact raw bytes, public metadata and reused
  snapshot results. This is historical fixture coverage, not mainnet synchronization
  or decryption. The new route's append/reorg tests use actual HTTP over controlled
  archive fixtures; no new actual-node branch replacement is claimed by this run.

All benchmark and proof containers were stopped. PostgreSQL's original resource
limits were restored, and the five existing application services remained active.
No public deployment, paid infrastructure or viewing-key processing was performed.
No scripts or WASM from the reviewed fork were executed.

## Evidence

- [Execution/source manifest](../raw/2026-10-14-prep-batch/execution-manifest.json).
- [Session, limits, all observations and cleanup](../raw/2026-10-14-prep-batch/compare/session.json).
- [Rust validation](../raw/2026-10-14-prep-batch/rust-validation.txt),
  [SDK tests](../raw/2026-10-14-prep-batch/sdk-tests.txt), and
  [benchmark tests](../raw/2026-10-14-prep-batch/benchmark-tests.txt).
- [Live SDK behavior](../raw/2026-10-14-prep-batch/sdk-live.json) and
  [modern fixture batch](../raw/2026-10-14-prep-batch/modern-batch.json).
- [Host recipe](../../prep/full/batch_session.py),
  [retrieval verifier](../../prep/full/batch_retrieval.py), and
  [query/lookup contract](../../../docs/PREP_QUERY.md).
