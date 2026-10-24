# Chef application study with direct and buffered Prep reads

Recorded 24 October 2026. Both variants produced identical application state and
passed restart, ordered pagination and relation checks. Buffered reads did not
consistently improve application indexing time and remain opt-in.

## Workload

The [address analytics example](../examples/address-analytics) used the published
`@zeer-dev/chef@0.6.1` from an independent registry installation. Six fresh project
namespaces indexed **512 real testnet blocks, 4,525,000–4,525,511 inclusive**, with
**621 transactions**. Each used 16-block source pages, eight-block commit batches
and PostgreSQL 18 with `fsync`, `synchronous_commit` and `full_page_writes` enabled.

Three runs per reader alternated direct/buffered, buffered/direct, direct/buffered.
The binaries came from source `dc66d8b`; only the candidate enabled
`buffered-range-reads`. Both retained the normal HTTP API, admission, integrity and
canonicality gates. The example's coverage handler was corrected to preserve its
actual first indexed height; the artifact records its content hash separately.

## Measurements

| Metric | Direct reads | Buffered reads, opt-in |
| --- | ---: | ---: |
| Median indexing CLI elapsed time | 2.460766 s | 2.496932 s |
| Median external process observation | 2.831163 s | 2.967047 s |
| Median cumulative source-fetch time | 1.017528 s | 0.562161 s |
| Median measured Prep reader CPU time | 0.720000 s | 0.250000 s |
| GraphQL reads during indexing | 79, all successful | 81, all successful |
| Pooled GraphQL median | 0.007510 s | 0.009076 s |
| Pooled GraphQL p95 | 0.031536 s | 0.022927 s |

CLI elapsed time includes the indexing command's processing, source reads,
handlers and database work. External observation also includes process startup
and completion detection through a loop that queries GraphQL and pauses for
0.100000 s. Database migration, code generation, typechecking, reader admission,
server startup and final correctness checks are outside these indexing timers.
Fetch and CPU medians are diagnostic components, not additive explanations of
the difference between the two total-time medians.

The candidate was slower in two of the three paired indexing runs. With three
samples, warm caches and a changing source catalog, this is exploratory evidence,
not a significance test or a new default-promotion gate. It provides no basis to
replace the default reader. It also does not replace the compact RPC comparison.

## Correctness and concurrent ingestion

Every run matched **1,076 complete entity rows** against independent Python Decimal
accounting over the same normalized input: 514 outputs, 47 address summaries,
514 address activities and one coverage row. There were **13 resolved spent
outputs**, **12 unresolved inputs** and **two outputs without a single attributable
address**. Unknown input amounts were not converted to zero-value attributed
spends. These are observed transparent totals over a partial range, not balances.

All six indexing processes restarted at the same target without changing any
entity. After restarting each GraphQL server, a bounded height-range query read
all 514 activities in 14 pages of at most 37 rows, ordered by `blockHeight` and
`id`. No row was missing or duplicated; related summaries matched the database.
There were 84 pagination requests in addition to the 160 timed availability reads.

A separate real Prep follower read the existing remote Zebra node through SSH
and published **314 additional blocks**, from 4,533,442 to 4,533,756, during the
study. Publication overlapped one timed indexing interval. This was catch-up of
real chain history, not a fabricated replay or a measurement of time at chain
head. Ten source block-hash checks covered sampled query headers and the archive
boundaries. The arithmetic oracle shares Prep's normalized input; it is not an
independent transaction decoder or consensus validator.

The study did not exercise shielded decryption, a natural reorg, settlement or a
capacity stress test. Existing scanner/reorg evidence remains separate.

## Environment and reproduction

WSL2 Ubuntu 24.04 on AMD Ryzen 5 6600H. Prep used CPU affinity 0–1 and two Tokio
workers; Chef and PostgreSQL shared CPUs 2–3, the local follower used CPU 4, and
the monitor used CPU 5. This study used affinity, **not cgroup CPU/memory quotas**.
Child process RSS was sampled every 1 s with a 1 GiB abort threshold; the largest
sample was 139,526,144 bytes. Sampling is not a hard memory ceiling or a claim
about exact peaks. Caches were warm and were not cleared. The shared VPS guard
passed before and after testing; no hosted engine was replaced.

To repeat the workload, build ordinary Prep twice, copying the binaries between
builds: `cargo build --release -p prep --bin prep`, then the same command with
`--features buffered-range-reads`. Serve the same prepared modern `full-v1`
archive through `serve-http`, with a real follower active. Do not share a writer
with another benchmark or use a stale synthetic readiness status.

Copy the address example into a fresh namespace per run. Set `startHeight` to
`4525000`; configure protected local database/API credentials; generate types,
typecheck and migrate. Time `chef sync --to 4525511 --json` while another process
serves GraphQL. Read coverage and a bounded activity list with nested summaries
every 0.100000 s. Preserve the final CLI metrics; compare all stored entities
using exact integer amounts. Repeat sync at the same target, restart the query
server, then paginate using `range: { blockHeight: { gte: 4525000, lte: 4525511 } }`,
`orderBy: [{ blockHeight: ASC }, { id: ASC }]`, `first: 37` and `after: ID`.

[Recorded measurements and artifact hashes](../apps/docs/static/benchmarks/2026-10-24-prep-application.json)
include all six timing rows, 160 query samples, resource observations, binary
hashes, coverage and pagination checks. Raw input, local controller and process
logs are retained separately; their hashes are recorded. Recompute published
aggregates with `node apps/docs/scripts/verify-compact-benchmarks.mjs`.
