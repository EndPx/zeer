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

## Live following: polling interval and read availability

Recorded **21 October 2026**, using published **Chef 0.1.3** against an authenticated native Prep service and Zebra on the same host. Two fresh indexers processed each observed block; their polling assignments crossed over after six samples. Each study contains **12 paired blocks**. These are separate trials with different live blocks; their samples are not pooled.

| Study | 5-second median | 5-second p95 | Candidate median | Candidate p95 | Change accepted? |
| --- | ---: | ---: | ---: | ---: | --- |
| 1-second candidate with independent Prep observer | 9.101496 s | 14.490752 s | 4.989191 s | 8.564376 s | Rejected |
| 1-second candidate without independent Prep observer | 7.248339 s | 10.009997 s | 5.375185 s | 6.756668 s | Rejected |
| 2-second candidate without independent Prep observer | 5.881772 s | 10.512270 s | 4.506570 s | 6.735981 s | Rejected |

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
