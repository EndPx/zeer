# Zeer benchmark specification v0.1

Date: 2026-10-12 (Asia/Jakarta).
Status: **broad specification; first limited provider-serving experiment completed on 2026-10-13**. See [harness](../benchmarks/README.md) and [results](../benchmarks/results/reports/2026-10-13.md). Most scenarios below remain planned.
Product and event semantics: [Zeer implementation plan](../.omc/plans/zeer-v0.1.md).

## 1. Questions the benchmark must answer

The current implemented scenario reads and normalizes already-available compact blocks into memory. Its timer is explicitly labelled `read_normalize_ns`, not durable ingestion. It is preparatory evidence for the later provider comparison track; no Zeer consumer exists yet. Initial data is 1,024 synthetic transparent-coinbase-only regtest blocks. This bounded smoke dataset does not replace D1/D2 or establish performance on their planned sizes.

1. Does the indexer produce the expected canonical data without omissions, duplicates or incorrect values?
2. How long does a fixed historical workload take to become durably queryable?
3. How much CPU, RAM, disk, network traffic and source/API activity does that workload require?
4. What is the added cost of the TypeScript handler/storage/API framework above direct scanning?
5. What changes as tracked account count, matching-note density and memo enrichment change?
6. Does the output converge to clean replay after crashes, reorgs, source outages and database outages?
7. Can a third party reproduce every published claim without private credentials or unpublished fixtures?

Do not combine these dimensions into a weighted overall score. Publish per-scenario results, eligibility and limitations.

## 2. Comparison tracks and eligibility

| Track | Candidates | Claim permitted |
| --- | --- | --- |
| Public application indexing | Zeer public example; CipherScan Rust; another actual Zcash indexer only after capability proof | Time/resource/correctness for a declared shared workload; extra native work must be disclosed |
| Source/provider comparison | Same Zeer build against lightwalletd, Zaino and Zinder versions that pass preflight | Effect of changing the data provider under one fixed consumer |
| Shielded framework cost | Zeer; direct library scanner + equivalent reference persistence | Framework cost on the same keys/bytes/protocol, not an independent competitor ranking |
| Scanner-only characterization | Pinned Zcash library runner; Zeer scanner adapter on identical input | Scanning overhead, excluding explicitly listed application work |
| GraphQL | Zeer query API; external app API only if it exposes equivalent semantics through a declared adapter | Query performance, not chain-ingestion performance |
| Fault correctness | Tools with a verified compatible injected-failure path | Named checks passed/failed/unsupported and convergence time |

An external indexer means an independently maintained implementation. The direct-library reference is maintained by us and must be labelled as such in every chart. Envio's EVM workloads are methodology references, not direct competitors on Zcash.

For every candidate freeze: repo/commit, license, build instructions, node/library dependencies, features, source mode, initialization requirements and exact expected output mapping. A failed build is `UNAVAILABLE` with logs, not a throughput of zero. A feature not implemented is `UNSUPPORTED`, not a correctness failure. An executed scenario with wrong output is `FAIL`.

### CipherScan-specific eligibility

Its README documents direct Zebra RocksDB ingestion, PostgreSQL output and additional explorer data [B2]. Zeer's RPC path and native CipherScan ingestion differ. Report their source/storage access in the result row.

Start with the common block/transaction identity projection: height, block hash, parent hash, txid, transaction position, and supported public count/version fields. Do not add private decrypted values to this track. Prevout resolution, address histories, fees and pool-value analysis remain excluded unless every participant's required work is defined and validated.

If CipherScan necessarily performs additional indexing, publish a **native-stack task comparison** with those operations listed. Do not describe it as isolated engine speed or claim a universal multiplier. An isolated like-for-like chart requires evidence that required ingestion, transformation and persistence work match; a projection adapter that only reads one tool's already-built database is not equivalent to another tool's fresh indexing.

Do not fork away competitor validation or durability to make a result convenient. Minimal format adapters must be public and separately identified.

## 3. Datasets and ground truth

### D1: historical public chain snapshot

- Freeze network, genesis hash, inclusive start/end heights and boundary hashes.
- Initial planned scales: 10,000 and 100,000 blocks, subject to G0 storage/runtime feasibility; final ranges are preregistered before performance tuning.
- Record transaction count, relevant outputs/actions by pool, serialized bytes and density distribution, not just block count.
- Include both ordinary and dense ranges; do not select only empty stretches. Select documented network-upgrade boundary cases for compatibility separately.
- Publish raw-data acquisition commands, checksums and provenance. If bytes cannot be redistributed, reproduce them from a declared source and verify hashes before timing.
- Generate expected common fields independently from a validated-node snapshot/reference decoder. Comparing only each tool's row count or to Zeer's own output is insufficient.

### D2: synthetic shielded payments with known recipients

- Generate valid transactions/blocks in an isolated test environment; generation/proving time is excluded from indexing time and reported separately.
- Publish reproducible fixture creation plus final serialized fixture checksums. If cryptographic randomness prevents byte-identical regeneration, pin and publish the resulting fixture.
- Only disposable fixture keys may be public, conspicuously labelled unsafe for funds. Never publish real-user/mainnet private data or operational secrets.
- Freeze cases for 1, 10 and 100 independent account keys over the same chain input.
- Specify exact note-match ratios, unmatched outputs, multiple outputs in one tx, internal/change cases, binary/text/absent memos and amount boundaries. Vary one factor at a time where practical.
- Separate Orchard and Sapling results, then mixed-pool results. Unsupported active protocols are a test failure for claimed compatibility; do not classify them as empty blocks.
- Keep receipt-only discovery and full-transaction/memo enrichment as separate named workloads.
- For isolated key-count scaling, keep the matching-note set constant by adding unfunded distractor accounts; measure growth in funded-account/match density as a separate profile. Never attribute extra successful decryptions/enrichment work solely to key-count overhead.
- Expected receipts come from fixture construction records and independent recipient-wallet observations. Verify logical note IDs, atomic amounts, memo bytes/status and block placement.
- A direct-library baseline shares cryptographic code, so disclose common-mode risk. Independent sender/recipient records and deliberately corrupted inputs are still required.

### D3: public-testnet observation

- Demonstrate a real payment to a dedicated test account and correct API output.
- Report the actual source, timestamp boundaries, chain lag and transaction/block IDs; obtain scoped authority before initiating a send.
- This is integration evidence under live network conditions, not a reproducible throughput leaderboard.
- A two-hour following soak is prototype observation only. Network inclusion time is not indexer processing latency.

### D4: GraphQL data profile

- Use exactly 10,000 and 100,000 generated entities initially, containing realistic field sizes and indexed/non-indexed distributions.
- Publish generated data seed/manifest, schema, SQL indexes, query text/variables, auth mode and expected responses.
- A synthetic database-only load does not prove chain-to-API throughput; show its track label on every chart.

## 4. Scenarios and measurement boundaries

| ID | Scenario | Start -> finish / output |
| --- | --- | --- |
| P1 | Historical public backfill | Initialized empty app index starts reading the frozen range -> last required row durably stored and queryable |
| P2 | Live public following | Observer first sees canonical source block -> matching coherent API snapshot available |
| S1 | Shielded discovery | Frozen compact input available to scanner -> all expected notes durably recorded at declared boundary |
| S2 | Shielded end-to-end | Source range available -> enrichment, TS handler and app writes complete and GraphQL verifies last expected record |
| S3 | Key-count scaling | S1/S2 repeated with 1/10/100 accounts; same bytes, source, schema and configuration except keys |
| Q1 | GraphQL by ID | Fixed-rate authenticated requests; correctness, p50/p95/p99, errors and achieved rate |
| Q2 | Filtered paginated query | Fixed filters/page size/order; verify rows and cursor semantics on a stable head |
| Q3 | Queries during indexing | Repeat Q1/Q2 with declared ingestion; assert cursor invalidation when forward progress changes the head and report useful completed-query rate, restart responses and ingestion regression |
| R1 | Restart | Kill at scanner/journal/PG commit/ack boundaries -> same canonical result as uninterrupted run |
| R2 | Source/DB outage | Inject outage at known input progress -> retry safely and eventually catch up |
| R3 | Reorg | Replace declared branch -> exact canonical state, confirmation state and notification history |
| R4 | Restore | Restore one/both stores at declared cursors -> reconcile or explicitly require rebuild; no automatic historical redelivery |
| R5 | Privacy boundaries | Unauthorized reads, secret canaries, memo rendering and query abuse -> no specified disclosure |

Do not include initial full-node sync inside P1 while excluding it for a competitor. Report node provisioning/catch-up and indexer cold-start separately. Conversely, every service needed to deliver the measured output belongs in the stack's resource accounting.

Use monotonic clocks for durations. Same-host measurements share an observer; cross-host runs document synchronization/error bounds. Block timestamps are not latency clocks. Policy-confirmation waiting time is separate from block-observation-to-API time.

Separate three timers: `ingestion_duration` ends at the declared durable/queryable checkpoint (including only a uniform lightweight readiness probe), `verification_duration` covers full independent export/comparison afterward, and optional `verified_task_duration` includes both. Every finite-run artifact records their start/end timestamps. A result is eligible as a successful performance measurement only after full correctness verification passes at the recorded ending block hash; verification time is not silently added to ingestion time. Any verified-task comparison uses equivalent extraction/checking boundaries for all candidates. Partial rows are not a successful full backfill. If a time limit is hit, report processed range/count, elapsed time and `PARTIAL`; do not extrapolate a finished duration.

## 5. Correctness and failure oracle

- Compare every expected normalized entity field, canonical block membership and deterministic ordering after each finite run.
- Compare exact integer amounts, not rounded display ZEC.
- Count missing, unexpected, duplicated and mismatched records independently.
- Use sorted canonical serialization/digest plus a detailed diff; a matching digest against an output generated solely by Zeer is not an independent oracle.
- Compare aggregates and confirmation-triggered entities after rollback to a clean replay of the final canonical branch.
- Test reorg depths 1, 10, the advertised effective retention boundary and boundary+1. The last must enter a visible safe rebuild state where unsupported.
- Inject duplicate batches and lost acknowledgements. One transaction with multiple relevant outputs must remain multiple distinct notes.
- HTTP deliveries may duplicate under retry. Check stable delivery identity and consumer idempotency, not a false exactly-once assertion.
- Track reversion and reconfirmation transitions separately from note identity; test a transaction appearing in another block and the same branch being re-observed.
- Preserve append-only observation history separately from reversible canonical entities. Query current receipt/status/history after removal, confirmation-only rollback and re-inclusion; compare canonical entities to clean replay, not transition histories that intentionally differ.
- Crash at each durable two-store reconciliation phase and ensure stale journal batches cannot become normal input after restart. Test fencing for dispatcher and control operations as well as handler writes.
- Have a webhook receiver accept a request but drop its response, then trigger reorg; the declared reversion/reset protocol must still reconcile it. Restore an old outbox snapshot after later deliveries reached the receiver and prove new content cannot reuse old delivery IDs.
- Interleave normal block progress with paginated queries that insert/delete/change matching entities. Expect the documented snapshot-changed response, not a mixed-head result disguised as a successful page.
- Use fresh isolated stores for each fault repetition. A check passes only if all three repetitions pass; publish failure details.
- Distinguish actual node/regtest branch changes from simulated event/source fault injection. The latter proves the tested interface path only.

## 6. Fair execution protocol

1. Freeze methodology, fixture hashes, expected output, versions and resource budget before measuring optimized candidates.
2. Build release/production artifacts. Exclude compilation from engine runs and report install/build time separately.
3. Use the same hardware allocation and local PostgreSQL settings for eligible DB comparisons. Preserve production-like durability; do not disable fsync for one candidate.
4. Run candidates sequentially in randomized/rotated order; no uncontrolled CPU/disk contention. Record host CPU model, assigned cores, RAM, disk, OS/kernel and container limits.
5. Separate cold-index runs (empty application index) from warm-cache runs. State whether source cache, OS cache, SDK DB and database buffers are cold/warm; resetting a database does not reset all caches.
6. Repeat primary performance scenarios five times. Report all values, median and min/max; do not select the fastest successful attempt. Include failures/timeouts.
7. Use a distinct cached-input engine profile to reduce network noise, and a native-stack profile preserving each source path. Never merge these into one ranking.
8. For live remote providers, record rate limits, retries, bytes and errors. If sources differ, the claim is about those measured stacks. Do not silently swap endpoints mid-run.
9. Run GraphQL at declared offered rates/concurrency; report offered and achieved throughput, timeout/error rate and enough requests for meaningful percentiles. Use a load generator that records scheduled latency rather than hiding stalls through coordinated omission.
10. Initial GraphQL profiles: concurrency 1/10/50, page size 50, 60-second warm-up and 180-second measurement. Record total samples; reduce scope explicitly if the hardware cannot sustain it.
11. Local PostgreSQL is the reference. Neon runs pin region, compute size and pooling mode and report network RTT/autosuspend/cache state separately. They do not replace local engine comparisons.
12. Re-run only changed or affected scenarios during development; execute the complete frozen suite for a release candidate.

Proposed workload sizes/durations above may be revised after the first preflight for feasibility. Record the revision before comparing results; never tune the benchmark after seeing which candidate wins without publishing that change.

## 7. Metrics and reporting

| Metric | Definition |
| --- | --- |
| Ingestion seconds | Declared start to durable/queryable checkpoint, with uniform lightweight readiness probe |
| Verification seconds | Full independent output extraction and correctness check after ingestion timing |
| Verified task seconds | Optional combined duration, explicitly labelled and using equivalent boundaries |
| Blocks/s, transactions/s | Actual processed count / elapsed time; density provided |
| Shielded outputs/s | Outputs/actions examined / scanner time, with pool/key count |
| Matches/s | Successfully decrypted relevant notes / elapsed time; match ratio provided |
| Candidate key-output pairs | Optional normalized workload count; not a claim of literal crypto operations for a batched implementation |
| Framework overhead | End-to-end vs matched direct-library pipeline under identical required persistence/enrichment; scanner-only has a separate denominator |
| Freshness lag | Source observed height/time versus coherent committed API head/time |
| Query latency | p50/p95/p99 with offered load, total samples, errors and data profile |
| CPU/RAM | Total CPU seconds and aggregate peak resident memory of included processes |
| Disk/network | Application entities, runtime journal, SDK cache and source storage separated; bytes and API calls counted |
| Recovery time | Fault resolution or branch replacement observation -> correct coherent application state |
| Correctness | Expected/missing/unexpected/mismatched counts, digest and independent evidence |

Use actual local measurements only. Upstream README numbers may be contextual quotations but never rows in the measured leaderboard. Resource totals include background processes required by the declared boundary.

Example report columns, with no invented measurements:

| Tool / commit | Track / source | Dataset | Time | Throughput | Peak RAM | Correctness | Limitations |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Zeer | To measure | Frozen manifest | Not measured | Not measured | Not measured | Not run | No implementation yet |
| External candidate | Eligibility pending | Same eligible workload | Not measured | Not measured | Not measured | Not run | Source/native extra work must be listed |

## 8. Reproducible artifacts

Planned layout:

```text
benchmarks/
  README.md
  manifests/       # versions, workload, sources, hardware, checksums
  fixtures/        # public/disposable data only
  expected/        # independently derived normalized outputs
  adapters/        # peer format adapters, clearly labelled
  reference/       # our direct-SDK baseline, never called an external peer
  scenarios/      # public, shielded, GraphQL, recovery, privacy
  scripts/        # prepare, run, verify, report
  results/raw/    # per-run machine-readable data and redacted logs
  results/reports/
```

Each result carries schema version, UTC run timestamp, tool commit, fixture hash, configuration hash, source identity, hardware profile, run number, timing boundary, correctness result and failure reason. Export no operational keys, database credentials or private memos. Publish fixture-only secrets only inside clearly identified disposable test data.

CI runs small deterministic correctness/fault fixtures per change. The complete performance suite runs on a documented stable host/manual release job; shared CI numbers are labelled with runner variability. Do not promise scheduled runs until a workflow actually exists.

## 9. Acceptance and claim policy

- At least one measured independent indexer comparison is required for the planned submission evidence.
- If no peer passes eligibility, report the blocker and incomplete gate; do not quietly relabel the direct-library reference as a competitor.
- Correctness failures invalidate a performance winner for that scenario; raw timing still remains visible with `FAIL`.
- Different workload/source/native extra work prevents an isolated-engine speedup claim.
- A passed finite fixture suite does not establish zero bugs, complete anonymity, production reliability or unlimited scale.
- No absolute latency/throughput target is a release promise before the first baseline. The first frozen baseline becomes the reference for later regression budgets.
- Publish supported capabilities separately from measured performance. Unsupported GraphQL is not evidence another chain-data server is slow.

## 10. References

- **B1:** [Envio Open Indexer Benchmark](https://github.com/enviodev/open-indexer-benchmark) and [methodology](https://github.com/enviodev/open-indexer-benchmark/blob/main/METHODOLOGY.md). Reference structure; project-maintained benchmark, not an independent certification of Envio.
- **B2:** [CipherScan Rust](https://github.com/Kenbak/cipherscan-rust) and [deployment architecture](https://github.com/Kenbak/cipherscan/blob/main/DEPLOYMENT.md). Capabilities and native source path require local verification.
- **B3:** [Zaino](https://github.com/zingolabs/zaino), [lightwalletd](https://github.com/zcash/lightwalletd), [Zinder](https://github.com/ZcashFoundation/zinder). Provider candidates, not interchangeable performance claims.
- **B4:** [Zcash scanning module](https://docs.rs/zcash_client_backend/latest/zcash_client_backend/scanning/index.html). Direct-library baseline foundation.
- **B5:** [Zebra regtest](https://github.com/ZcashFoundation/zebra/blob/main/book/src/user/regtest.md). Controlled chain infrastructure, subject to actual harness capability.
