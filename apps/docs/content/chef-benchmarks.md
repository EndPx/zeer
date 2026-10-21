# Chef indexing benchmarks

Chef's benchmark measures the application-indexing pipeline: reading from Prep, running TypeScript handlers, committing entities to PostgreSQL and making committed data readable through GraphQL.

Recorded **20 October 2026** on real **Zcash Testnet** data. All durations are in **seconds (s)**.

## Workload and results

Range: **0–9,999 inclusive**, starting from an empty project namespace. The installed starter produced **10,000 BlockSummary entities** while a separate GraphQL process served reads.

| Chef input profile | First data observed in GraphQL | 10,000 entities indexed |
| --- | ---: | ---: |
| Fixed source pages, 32-block commits | 1.201 s | 36.696 s |
| Adaptive source pages, 32-block commits | 1.591 s | 35.215 s |

These are **one recorded run per profile**, not medians. Both finished at checkpoint 9,999 with identical entities; every entity was compared against the separately collected source projection. The timer includes CLI startup and polling through completion; database setup and the final full comparison are excluded.

The first-data measurement records when the polling client first observed entities. It is an indexer-startup observation, rather than the execution time of an individual GraphQL query. These public block-summary runs do not measure shielded memo decryption.

## Environment & evidence

The shared pipeline envelope was **3 CPU quota / 8 GiB RAM**. The experiment worker had **0.5 CPU / 512 MiB**, excluding supporting Prep and PostgreSQL processes. Quotas are ceilings, not dedicated cores. These results do not measure whole-chain indexing, cold startup or public-internet latency.

[Download recorded samples and provenance](pathname:///docs/benchmarks/2026-10-20-chef-testnet.json). This Chef-only snapshot contains both indexing runs, entity checks, checkpoint and source provenance. Validate its aggregates with `node apps/docs/scripts/verify-benchmarks.mjs` from the checkout.

For new measurements, use the [benchmark specification](https://github.com/EndPx/zeer/blob/main/docs/BENCHMARK_SPEC.md) and [harnesses](https://github.com/EndPx/zeer/tree/main/benchmarks). Keep retrieval, durable indexing and GraphQL latency as separate workloads.

<span id="prep-retrieval"></span>

For chain-data retrieval timings, see [Prep performance benchmarks](/docs/prep/benchmarks/).

<span id="live-following-polling-interval-and-read-availability"></span>

## Live update delay: polling experiment

Recorded **21 October 2026**, using published **Chef 0.1.3** against an authenticated native Prep service and Zebra on the same host. Two fresh indexers processed each observed block; their polling assignments crossed over after six samples. Each study contains **12 paired blocks**. These are separate trials with different live blocks; their samples are not pooled.

This experiment asks: **does checking for new blocks more often make data readable sooner, without interrupting reads?** It compares the default **5-second polling interval** with 1-second and 2-second intervals. A polling interval is how often Chef checks for work; it is not a completion-time guarantee.

**Read the timings as the delay from a new block being seen at Zebra RPC to its data being returned by GraphQL.** Median is the middle of the observed delays. The p95 column describes the slower observations; with only 12 samples, it is the slowest sample in each trial.

| Polling tested | Default 5 s: median | Default 5 s: p95 | Tested: median | Tested: p95 | Adopt as default? |
| --- | ---: | ---: | ---: | ---: | --- |
| 1 s, with extra Prep checks | 9.10 s | 14.49 s | 4.99 s | 8.56 s | No: temporary 503s |
| 1 s, without extra Prep checks | 7.25 s | 10.01 s | 5.38 s | 6.76 s | No: temporary 503s |
| 2 s, without extra Prep checks | 5.88 s | 10.51 s | 4.51 s | 6.74 s | No: temporary 503s |

**The shorter intervals were faster in these samples, but we did not adopt them.** Some queries temporarily returned 503 while Chef rechecked its source. The predeclared rule required no failed read probes, so all three experiments failed that availability condition. Entity correctness and restart checks passed in every trial.

The first trial adds a separate observer that repeatedly checks when Prep makes a block available. Those checks add source traffic. The other trials remove that observer; they also use different live blocks, so compare the two indexers within each row rather than treating the rows as one ranking.

The timer starts when the RPC observer first sees a new block and ends when GraphQL returns its expected hash and complete transaction count. It includes source ingestion, Chef processing and read availability. It does not measure block production time. With 12 samples, the nearest-rank p95 is the maximum observed value.

### Availability matters alongside latency

| Study | GraphQL probes per indexer | 503 responses: baseline / candidate | Writer Prep requests: baseline / candidate | Writer source errors: baseline / candidate |
| --- | ---: | ---: | ---: | ---: |
| 1-second candidate, extra Prep observer | 1,127 | 274 / 82 | 127 / 416 | 12 / 13 |
| 1-second candidate, no extra observer | 1,240 | 0 / 5 | 147 / 475 | 0 / 1 |
| 2-second candidate, no extra observer | 994 | 25 / 10 | 118 / 230 | 1 / 1 |

Every candidate reduced the median, but **none passed the predeclared zero-error read criterion**. Prep capacity responses caused Chef to revalidate its source, temporarily closing the GraphQL read gate. These responses remain in the results. We kept the existing gates and polling defaults; no production polling change was deployed.

The extra Prep observer received 30 capacity responses in the first study. Removing that observer changed the load substantially, but did not eliminate all read interruptions. Without the extra observer, the earliest Prep timestamp comes from a writer and includes its polling delay; it cannot isolate Prep publication latency.

### Correctness and measurement boundaries

All three studies passed their independent source comparison. Each exported every entity from both indexers and a clean replay, including cumulative totals that detect duplicate handler execution. **15 restart checks** preserved entities and checkpoint height/hash, including process termination and no-op resumption. This does not prove recovery from a crash inside a database commit or exercise a live chain reorganization.

The workload processes public block summaries and transaction metadata. It does not decrypt shielded notes or measure receipt-to-consumer latency. The source reference includes public pool activity counts, not private values or memos.

The experiment shared a **3 CPU / 8 GiB** pipeline envelope with active production services. Its observer and children had **0.5 CPU / 1 GiB**; Zebra had **2 CPU / 4 GiB** and PostgreSQL **0.5 CPU / 512 MiB**. Prep followed every **2 seconds** with **1 confirmation**. PostgreSQL used durable writes. Services were warm; bootstrap was excluded and caches were not cleared. Quotas are ceilings rather than dedicated cores. This is a same-host observation, not an engine ranking, public-internet estimate or SLA.

Three earlier setup attempts stopped before collecting paired samples. Their causes and the final harness maintenance change are disclosed in the evidence. None supplied comparative timings.

[Download live following samples](pathname:///docs/benchmarks/2026-10-21-chef-head-testnet.json). Each study links its exact recorded harness source and includes raw paired timestamps, probes, source reference, entity digests and restart checks. Reproduce it with the [live head harness](https://github.com/EndPx/zeer/tree/main/benchmarks/chef/head); validate the published evidence with `node apps/docs/scripts/verify-head-benchmarks.mjs`.

## Live following: bounded source admission

A later study held **Chef 0.2.0 and two-second polling fixed** and changed one Prep behavior: height/readiness requests could wait in the existing bounded query queue instead of immediately failing when both workers were busy. Authentication, queue limits and canonicality gates were preserved.

| Prep admission used by Chef | Source → GraphQL median | Source → GraphQL p95 | Failed timed reads |
| --- | ---: | ---: | ---: |
| Original metadata admission | 2.26 s | 3.75 s | 0 |
| Queued metadata admission | 1.63 s | 3.06 s | 0 |

These are **12 paired future blocks**, with binary assignments crossed after six. Each reader also received two concurrent 16-block background queries every two seconds. All entities matched the independent source projection, and five restart checks passed. The candidate met this study's acceptance conditions.

**Both variants had zero observed read failures.** This run therefore does not establish a reduction in the live error rate. The median paired difference was only **0.005 s**; the difference between the two aggregate medians is not a per-block speedup. Native busy-worker tests separately reproduce the original immediate capacity response and verify bounded waiting, cancellation and timeout behavior.

The experiment used a fully validated **modern tail archive**, starting 32 blocks before the then-current node tip. It did not open the full historical archive during timing. Two earlier full-history startup attempts exceeded their 15-second and 120-second bounds before collecting any pairs; those failures are retained. The tail's bootstrap took 0.21 s and is excluded from live timing. This result does not establish whole-history cold-start performance.

The shared envelope remained 3 CPU / 8 GiB; the observer, shadow follower and readers shared 0.5 CPU / 1 GiB. The experiment's observed peak memory was 326,873,088 bytes. Public production followers remained active. Source observation, Prep retrieval, commits and GraphQL used same-host monotonic timestamps, with detection/polling bounds and warm caches. With 12 samples, nearest-rank p95 is the maximum.

[Download admission samples, source and validation logs](pathname:///docs/benchmarks/2026-10-21-chef-admission-testnet.json). Recompute the aggregates and check provenance with `node apps/docs/scripts/verify-reliability.mjs`. This public-data workload does not decrypt notes; receipt measurements are separate.

### Full-history rollout check

After timing finished, the candidate was started separately against the full historical archive, while the original public reader kept serving. It did not reach readiness within **1,200 s** at **0.5 CPU / 1 GiB**, so the temporary candidate was stopped and the public route was left unchanged. The check used 599.04 s of CPU and reached the 1 GiB memory ceiling; it does not prove which resource dominated startup. Its journal and outcome are included in the artifact. The accepted tail study therefore supports the bounded admission change, but **a production rollout has not passed**. Full-history startup remains a separate issue to resolve.

## Shielded receipts: live observations and recovery

The standalone consumer used **Chef 0.2.0 installed from npm outside the checkout**, a local native scanner and an owned testnet viewing key. Six Ironwood self-transfers each delivered a selected 100,000-zatoshi note with a numbered memo. All six were mined in distinct blocks, matched their expected memo/value, and were rechecked against the source chain. The API/consumer restart retained 12 notes, including change, with no duplicate IDs.

**The original target of six live samples in one run was not met.** The first measurement process stopped after one completed sample; its generic failure diagnostic did not preserve the cause. The second transaction was already broadcast and was inspected before continuing. The recovery run read those two transactions as catch-up data and measured four newly mined transactions. These runs remain separate, and catch-up observations are excluded from the live timings below.

| Stage, recovery run's 4 live samples | Median | p95 |
| --- | ---: | ---: |
| Prep response received → native decryption complete | 0.05 s | 0.05 s |
| Decryption complete → Chef commit acknowledged | 0.99 s | 1.10 s |
| Chef commit acknowledged → consumer storage observed | 1.82 s | 2.06 s |
| Prep response received → consumer storage observed | 2.86 s | 3.20 s |

The commit stage includes canonical-header revalidation and a Windows-to-VPS PostgreSQL connection over an encrypted SSH tunnel. It is not database execution time alone. The consumer uses a separate process and private SQLite database; its timestamp is an upper bound taken after reading a coherent committed snapshot. Producer and consumer polling targets were 2 s and 1 s. With four samples, p95 is the maximum. The first run's single observation took 2.64 s from Prep response to consumer storage; it is not pooled with the recovery run.

The source returned three 429 responses in the initial run and two in the recovery run. During recovery, the consumer waited four times for reconciliation and restarted eight traversals after a revision change. It retained the last complete projection until a compatible traversal finished. These waits are part of the evidence, even though every recorded GraphQL request returned 200.

Block-production and confirmation waits are excluded; their exact durations were not measured. The public endpoint's shared ingress remains limited to 2 requests/s with burst 8. Parent-process peak RSS was 80,777,216 bytes in the recovery run; scanner/child aggregate peaks were not measured. This small test does not establish an SLA, sustained throughput or a deployment-wide memory limit.

[Download receipt observations, source hashes and recovery checks](pathname:///docs/benchmarks/2026-10-21-chef-receipts-testnet.json). Verify the published timings and sample separation with `node apps/docs/scripts/verify-receipt-benchmarks.mjs`. The separate controlled-reorg test uses synthetic branches; the six mined receipts are real testnet observations. Viewing keys and internal change amounts are excluded from the public artifact. See the [reference consumer](https://github.com/EndPx/zeer/tree/main/examples/receipt-consumer) to repeat the application workflow.
