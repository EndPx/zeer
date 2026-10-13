# Zeer Chef public-data benchmark preflight

Observed on **2026-10-14 WIB** (2026-10-13 17:49:55–17:50:05 UTC). This is a
coverage and resource preflight, not a completed Chef benchmark. Public-chain
means publicly available transaction data; no viewing keys or decrypted shielded
notes, values, recipient addresses, or memos are involved.

Subsequent execution is recorded in the [Chef report](../benchmarks/results/reports/2026-10-14-chef.md).

## Decision

Build Chef's first public-data path over Prep, and measure both its complete
ingestion-to-GraphQL path and a separate native transaction lookup comparison.
Use the complete historical range 1–2048 for the application-indexing measurement
with a separately collected all-entity oracle. The existing independently
verified 128-transaction manifest is an additional check and serving workload.
**Do not label either case as a genesis-to-current-tip run.**

A complete mainnet run is not currently admitted under the existing shared-VPS
profile: the available local node is frozen at height 6764, Prep currently starts
at height one, and no complete compatible local source/archive has been provisioned.
The remote CipherScan node reports roughly 263 GiB of node data, while the current
experiment has a 40 GiB incremental disk allowance. Its reported size is an
observation of that provider, not a claim that every implementation needs exactly
that amount. No duration for indexing the whole chain has been measured or
extrapolated.

## Fresh public-source observations

[Raw observation record](../benchmarks/results/raw/2026-10-14-chef/preflight.json)
and [read-only probe](../benchmarks/chef/preflight.py).

The fixed observation target is height **3516619**, block hash
`00000000005284c5d40bc799b7cb0f34feebe9a427e5240f1a782f295794ccf9`.
That is the tip observed at capture time, not a permanently latest height. Both
gRPC providers returned the same hash and parent as CipherScan for this height.

| Source | Height 0 | Height 1 | Fixed observed tip | Data shape |
| --- | --- | --- | --- | --- |
| CipherScan public HTTP, source reports Zakura 1.6.0 | HTTP 200 | HTTP 200 | HTTP 200, 16 transactions in block listing | Explorer block/transaction summaries |
| `zec.rocks:443`, lightwalletd v0.5.3 | `InvalidArgument`: unspecified identifier | Success | Success, 16 compact transaction entries | Compact protocol |
| `zec.0xrpc.io:443`, Zaino 0.10.1 | Success; protobuf omits default zero height | Success | Success, 8 compact transaction entries | Compact protocol |

At height one, lightwalletd returned one compact transaction entry and Zaino
returned zero. The same header can therefore be accompanied by different
transaction subsets. **Compact entry counts cannot be treated as the number of
all public transactions or a substitute for complete public transaction fields.**
Three sampled heights do not prove that every intervening block is available.
The height-zero lightwalletd result is a request-path limitation, not a claim that
its underlying node lacks genesis or that every alternative retrieval method
must fail.

CipherScan's documented endpoints were used: `/api/blockchain-info` and
`/api/block/:heightOrHash`. The former reported `pruned=false` and
`size_on_disk=282311217721` bytes. The public API has bounded response limits and
documents HTTP 429 rate limiting; it must not be silently turned into an
unlimited bulk-backfill source. [API documentation](https://cipherscan.app/docs).
Provider endpoints were discovered through the operator's
[server directory](https://hosh.zec.rocks/zec). Single-request response times in
the raw record are diagnostic observations, not a comparative speed ranking.

## Separate the measured jobs

| Track | Start and finish of timer | Eligible comparison |
| --- | --- | --- |
| Chef application ingestion | First Prep request after empty application DB initialization, through all handler writes and final durable checkpoint commit; persisted verification and final GraphQL availability are also reported separately | Chef configurations or another app indexer performing the same entity workload; count source preparation separately |
| Native transaction lookup | Request each known transaction ID and normalize the same seven fields | Chef GraphQL, CipherScan SQL, and the three existing gRPC adapters with their different preparation costs disclosed |
| Source retrieval | Read and normalize an identical bounded public projection, without app DB persistence | Prep versus a compatible provider; this is a source comparison, not Chef indexing speed |
| Full genesis-to-pinned-tip application backfill | Complete coverage from exactly height 0 through one frozen head, all required rows committed and verified | Only implementations with complete source coverage and the same agreed entity semantics |

Time source synchronization, Prep archive construction, Chef DB initialization,
Chef ingestion, first GraphQL availability, and warm lookups separately. Also
record total cold-start wall time where all those phases were actually run.
A prepared-source ingestion result must not be presented as fresh node sync.

The other candidates are not equivalent frameworks: lightwalletd, Zaino and
Zinder serve node/wallet-oriented data; CipherScan builds explorer entities. They
can share a specific lookup projection, but their native ingestion work and
APIs differ. CipherScan's direct RocksDB path requires its compatible node state;
its upstream README lists around 50 GB for the indexed database in addition to
the node requirement. Treat that as the upstream estimate, not a measured Chef
comparison. [Pinned CipherScan README](https://github.com/Kenbak/zecblock-rust/blob/15d7f528f07a84d796ed89029de21bfb26a24d23/README.md).

## Next executable comparison

Reuse [`mainnet-transactions-v1/manifest.json`](../benchmarks/fixtures/mainnet-transactions-v1/manifest.json):
128 independently verified transactions selected from mainnet heights 1–2048;
78 coinbase and 50 non-coinbase, all pre-Overwinter v1. The source is frozen at
height 6764 with hash
`0000000160e11c9403141d7c2a16b07a2459919fc774795da3f687628c5ece54`.

1. Confirm the preserved source's exact head/hash before and after each run.
2. Ingest the complete contiguous Prep range 1–2048 into a new Chef application
   database. Persist the shared transaction fields and its checkpoint atomically.
3. Record ingestion seconds, actual block/transaction/entity counts, first
   successful GraphQL read, and database footprint. Check all ingested public
   fields against the independent source, separately from the lookup timer.
4. Query the same 128 IDs in the manifest order via Chef GraphQL. Normalize
   `txid`, `mined_height`, `version`, `locktime`, `size_bytes`,
   `transparent_input_count`, and `transparent_output_count`; coinbase counts as
   one input. Verify the complete manifest projection after stopping each timer.
5. Run one full verified warmup and five repetitions. Re-run at least one
   existing service against the same frozen source and resource allocation in
   this session. Keep 2026-10-13 measurements in a separate historical-results
   column unless the service was actually re-run today.
6. Report seconds for all 128 requests, requests/second, min/median/max, response
   bytes where available, source/candidate/client allocations and actual peak
   resource measurements if captured. Never mix serving and ingestion timers.

The existing runner in `benchmarks/transactions/benchmark.py` already validates
the manifest, raw v1 transaction identity, five repetitions, and source anchors.
Its native SQL adapter expects the preserved CipherScan database to reach 6764;
Chef's application range only needs 1–2048. A Chef adapter must check its own
indexed boundary and source identity rather than pretending its application
table contains all 6764 blocks.

Useful preserved services were inspected read-only and were stopped at preflight:

| Container | Limits | Connection / state |
| --- | --- | --- |
| `zeer-bench-four-frozen` | 1 CPU / 2 GiB | Private network alias `zebra:8232`; host loopback `127.0.0.1:39432` |
| `zeer-bench-four-lightwalletd` | 1 CPU / 4 GiB | Internal `zeer-bench-four-frozen` Docker network; no host port |
| `zeer-bench-four-zaino` | 1 CPU / 4 GiB | Same private network; no host port |
| `zeer-bench-four-pg` | 1 CPU / 4 GiB | Private alias `pg`; disposable CipherScan state under `/opt/zeer-bench/four-20261013/state/postgres` |

These are deployment handoff facts, not authorization to connect to unrelated
databases. Root controls actual starts, resource sums, service readiness, and
shutdown. The aggregate envelope remains **3 CPU / 8 GiB RAM / 40 GiB incremental
disk**. `df` reported about 80 GiB physically free; physical space does not expand
the authorized experiment allowance. No service was started or changed by this
preflight.

## Admission gate for a genuine whole-chain run

Before claiming or timing block zero to latest:

- Implement and test exact height-zero semantics in Prep/Chef, including genesis
  identity and checkpoint behavior. Current Prep archive creation explicitly
  rejects zero; never silently relabel a height-one run as genesis.
- Provision a compatible complete source, or a verified bulk source covering all
  required public fields. Three endpoint probes and a headers-only stream do not
  satisfy this prerequisite.
- Measure/provision source, archive, temporary files and application database
  storage inside an explicitly permitted resource profile.
- Pin `H` and `hash(H)` at the start. Store run timestamps, versions, every height's
  coverage, row counts, checksums, and reorg/continuation decisions. Newer blocks
  that arrive afterward are a separate catch-up/live-follow measurement.
- Start the stopwatch for the declared workload, finish only after all required
  persisted data and final API reads pass verification. Preserve actual elapsed
  seconds for an interrupted run, its last completed height and interruption
  reason; completed whole-chain seconds remain null.

Until those conditions hold, status is **not run: prerequisites incomplete**.
This is not an indexer performance failure and no full-chain completion time is
estimated from the small historical prefix.

## Executable bounded Chef benchmark

[`benchmarks/chef/indexing.mjs`](../benchmarks/chef/indexing.mjs) is the primary
prepared-source application benchmark. It imports the same TypeScript config,
schema and handlers as the application, then runs the full contiguous range
1–2048 five times. Each repetition initializes an empty, independently checked
`chef_bench_<random>_<repetition>` PostgreSQL namespace. Existing namespaces are
rejected; the runner never drops a schema or table. Keep every namespace until
the result has been reviewed and the supplemental reads have finished.

Build the workspace and generate the example's handler types before running.
Set `DATABASE_URL`, `PREP_URL` and `PREP_API_TOKEN` using the explicitly isolated
experiment environment. Connection secrets are read from environment variables,
not included in the report or command-line flags. From the repository root:

```sh
node benchmarks/chef/indexing.mjs \
  --config examples/chef-public/chef.config.ts \
  --manifest benchmarks/fixtures/mainnet-transactions-v1/manifest.json \
  --source-url http://PRIVATE_NODE_IP:8232 \
  --out benchmarks/results/raw/2026-10-14-chef/indexing.json
```

The report is exclusively created so a previous result cannot be overwritten.
Its status remains incomplete until all five repetitions pass. A failure keeps
previous repetitions, the failing namespace, partial elapsed time and the last
observable committed checkpoint. The default timeout is 1,800 seconds for oracle
preparation and separately for each ingestion repetition; `--timeout-seconds`
accepts an explicit bounded value. This is a prefix benchmark harness, not
evidence that a mainnet benchmark has been executed.

Before measured ingestion, the runner independently collects every block and
transaction in the range from the frozen full node. It checks parent continuity,
the node's frozen head/genesis, raw pre-Overwinter v1/v2 transaction identities and
the previously independently verified 128-record manifest. After each ingestion,
it releases the writer, opens a new store, and verifies every persisted Block and
PublicTransaction entity against that oracle. Exact row counts reject missing or
extra output. A real local GraphQL HTTP request then checks the committed boundary
and one complete transaction projection. Oracle preparation, persisted verification
and GraphQL validation each have separate elapsed metrics.

Primary throughput is **committed transactions / ingestion seconds** and
**committed blocks / ingestion seconds**. The ingestion timer includes Prep
requests, source checks, TypeScript handlers, entity reads/writes, undo retention
and durable PostgreSQL checkpoint commits. The runner records per-page timings,
fetch time, handler time including entity I/O, and transaction overhead. The
last metric is the remainder of `store.apply` after awaited handler work; it
includes transaction begin, journal/checkpoint/pruning and commit, and must not be
described as isolated PostgreSQL COMMIT latency. Elapsed time from ingestion start
through successful verification and GraphQL response is recorded separately.

Node CPU user/system deltas and sampled RSS are captured during ingestion. The
process lifetime maximum RSS is labeled separately because all repetitions share
one process. These do not measure Prep, PostgreSQL or the source container; the
deployment operator must preserve separate resource observations for those
services. Namespaced relation size includes application entities, retained undo,
state, and associated PostgreSQL relation storage, not the complete node/archive.

To reuse a verified repetition for the secondary native lookup job, set
`CHEF_API_TOKEN` and launch the read-only server; it validates the original config,
schema and stored fingerprint without migration or writer acquisition:

```sh
node benchmarks/chef/serve.mjs \
  --config examples/chef-public/chef.config.ts \
  --report benchmarks/results/raw/2026-10-14-chef/indexing.json \
  --run 5 --port 39370

python -m benchmarks.chef.lookup \
  --manifest benchmarks/fixtures/mainnet-transactions-v1/manifest.json \
  --chef-url http://127.0.0.1:39370/graphql \
  --source-url http://PRIVATE_NODE_IP:8232 \
  --out benchmarks/results/raw/2026-10-14-chef/lookup
```

The lookup adapter performs one complete verified warmup and five measured
128-ID repetitions. It checks the source at height 6764 and Chef at 2048; these
boundaries are intentionally different. Its results must remain a secondary
serving comparison and cannot rank Chef's indexing performance. A benchmark
against another application indexer needs identical persisted entities and source
coverage; wallet data servers and an explorer's native tables do not establish
that equivalence by themselves.

The metric design follows Envio's guidance to measure historical fixed-range
work that has reached the database, rerun from fresh databases, and distinguish
fetch, handler, entity and storage costs. The workloads here count native Zcash
public transactions and blocks; Envio's EVM events or logs are not assumed.
[Envio benchmarking guide](https://docs.envio.dev/docs/HyperIndex/benchmarking).
Prep source retrieval experiments should independently cover a complete public
scan, sparse public filters and selected fields. Those are source/API experiments
with their own coverage checks and timers, separate from application indexing.
[HyperSync overview](https://docs.envio.dev/docs/HyperSync/overview).

## Same Chef workload over Prep and direct RPC

Run the same command with `--source-mode rpc` and a distinct `--out` path for a
controlled source comparison. The default is `--source-mode prep`. Each mode
performs five fresh namespace runs with the identical handlers, schema, page
size, PostgreSQL commit semantics and all-entity verification. RPC mode requires
the frozen node and database but does not require `PREP_URL` or a Prep archive.
Both modes exclude source preparation and share the fixed height/hash admission
checks. Preserve both reports and their oracle files; compare results only if
their range, manifest, config/schema hashes, actual persisted counts, resource
profile and source anchor agree.

The RPC candidate is labeled **Chef + full-node RPC (benchmark adapter)**. Its
source adapter uses one sequential in-flight request, `getblockhash` followed by
`getblock` verbosity 2 for each full block, and verbosity 1 for header checks.
There is no source preload/cache or concurrent request pool. It records measured
RPC request count and response bytes. Native Node 24 `JSON.parse` reviver source
context preserves every decoded number as its original JSON token, including
decimal/exponent monetary values and integers beyond JavaScript's safe range;
validated bounded metadata becomes numeric runtime fields separately.

The complete early range may contain legacy v1 and v2 transactions, including
public JoinSplit data. Raw double-SHA256 identities are checked for both. Only
v1's locktime is checked at the final four raw bytes; v2 appends JoinSplit fields
after locktime, so its locktime uses the independent full-node decoded projection.
The 128 selected manifest records are still all v1 and remain the secondary
lookup workload. Public data does not reveal decrypted shielded notes.

This comparison isolates source access while retaining real entity writes and
durable commits. It does not compare Chef with a different application indexer,
and it must not label the full node, lightwalletd or Zaino as equivalent indexers.
The adapter is a benchmark fixture for this frozen range, not a production RPC
integration or reorg/live-follow implementation.

## Native CipherScan ingestion observation

`benchmarks/chef/cipherscan.mjs` runs the pinned, unmodified upstream binary over
heights 1–2048 five times, each with a fresh database and the unchanged upstream
schema. It opens a prepared RocksDB secondary with a read-only primary mount;
the source node must be stopped. Every block and all seven common public
transaction fields are verified against the same independent oracle, followed
by the native checkpoint check. Additional explorer tables are counted, without
claiming independent verification of all their semantics.

This is an ingestion observation with a different output workload and CPU
allocation. It cannot establish a pure framework ranking. Its primary timer
includes container/process startup, secondary opening, native ingestion and
shutdown; schema preparation and verification are separate. Node synchronization
is excluded. Native printed elapsed time and sampled Docker memory are secondary
metrics; precise process CPU and peak RSS are unavailable.

The runner deliberately targets the dedicated `zeer-chef-pg` benchmark container
and localhost port 39460. It requires an internal `zeer-chef-cs` network with the
database alias `chef-pg`, an administrator DSN in `DATABASE_URL`, the pinned
binary, its matching RocksDB state, and its unchanged schema. All five databases,
containers and logs are retained. Reproduction requires equivalent isolated
resources and prepared state; it is not a generic production installer.

```sh
node benchmarks/chef/cipherscan.mjs \
  --oracle /path/to/indexing-oracle.json.gz \
  --out /path/to/new-cipherscan-results.json \
  --binary /path/to/pinned/cipherscan-indexer \
  --state /path/to/state/v29/mainnet \
  --schema /path/to/pinned/schema/postgres.sql \
  --runtime-image zeer-benchmark/native-runtime:20261013
```
