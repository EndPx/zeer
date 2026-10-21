# Prep retrieval benchmarks

Prep retrieves selected public chain data from a prepared archive. This benchmark compares that retrieval path with native Zebra RPC over the **same block range, fields and expected results**. It does not measure Chef indexing or shielded decryption.

Recorded **21 October 2026 (UTC)** on **Zcash Testnet**. All durations are in **seconds (s)**. Full-history startup is reported separately below.

## Workload and results

Range: **4,522,544–4,522,799 inclusive** — 256 blocks and 531 transactions. It contains 163 non-coinbase transactions with transparent components, **2 Sapling**, **2 Orchard** and **181 Ironwood** transactions. Component counts can overlap. The range and lookup selections were frozen before timing; the reference includes their selection rules and block hashes.

Each value is the median of **three alternating measured runs** per candidate, after one verified warmup per workload and candidate. All **42 measurements and 14 warmups** matched every expected row and its digest.

| Query | Returned rows | Prep median | Zebra RPC median |
| --- | ---: | ---: | ---: |
| Block headers | 256 | 0.003608 s | 0.262936 s |
| All transaction metadata | 531 | 0.159506 s | 0.347455 s |
| 16 selected TX IDs | 16 | 0.018925 s | 0.014246 s |
| Transactions paying one transparent address | 200 | 0.134044 s | 0.157427 s |
| Sapling component filter | 2 | 0.127810 s | 0.288864 s |
| Orchard component filter | 2 | 0.177232 s | 0.300796 s |
| Ironwood component filter | 181 | 0.142961 s | 0.287944 s |

**Zebra RPC is faster for the 16 selected TX IDs.** Prep is faster for the broad metadata and pool-filter workloads in this run. The address lookup winner changed between the preliminary and final trials; this result does not establish a consistent advantage for either path. Both complete trials are included in the evidence. The final trial uses corrected absolute-deadline checks on the same dataset and settings.

## Requests and response sizes

Counts below are medians per complete retrieval. Each cell shows **Prep / Zebra RPC**. Bytes are actual HTTP response bodies, including RPC envelopes and fields discarded by client-side filtering; HTTP/TLS headers are excluded. Responses use identity encoding.

| Query | HTTP requests | Response body bytes |
| --- | ---: | ---: |
| Block headers | 1 / 256 | 49,925 / 876,997 |
| All transaction metadata | 1 / 256 | 159,846 / 9,884,371 |
| 16 selected TX IDs | 1 / 16 | 5,070 / 264,286 |
| Transactions paying one transparent address | 1 / 201 | 60,261 / 293,435 |
| Sapling component filter | 1 / 256 | 863 / 9,884,371 |
| Orchard component filter | 1 / 256 | 863 / 9,884,371 |
| Ironwood component filter | 1 / 256 | 54,695 / 9,884,371 |

Zebra uses native `getblockheader(height)` for headers, `getrawtransaction` for selected IDs, and `getaddresstxids` followed by transaction lookup and **output-only** filtering for the address query. Other transaction workloads read decoded blocks and apply the same projection and public component filters. Up to **four RPC requests run concurrently**, with persistent connections and individual requests rather than JSON-RPC batch envelopes. Prep uses adaptive `/query` requests and follows cursors with one page in flight.

Both paths select four header fields or eleven transaction metadata fields. Pool queries observe public component counts; note values and memos remain encrypted. The [reproduction harness](https://github.com/EndPx/zeer/tree/main/benchmarks/prep/rpc) lists the exact fields, predicates and commands.

## Preparation cost

Preparing a **new compressed archive for these 256 blocks** from the already synchronized, warm Zebra node took **1.576383 s** in one direct native run. It used **0.555225 CPU s**, reached **26,521,600 bytes of sampled process RSS**, and wrote **3,275,437 bytes of archive files**. RSS was sampled every **0.020000 s**. Archive verification took another **0.165051 s**, outside the preparation timer.

This separate preparation result includes source reads, normalization, compression and persistence. It excludes discovery, reference capture and the full node's initial sync. It is one observation, not a median or the cost of preparing the entire chain. Direct preparation request counts were not instrumented; a preliminary proxy diagnostic added overhead and is excluded from this native timing.

## Environment and measurement

Requests ran over loopback on a shared VPS, with existing production followers active. The aggregate Zeer envelope was **3 CPU quota / 8 GiB RAM**. Service ceilings were **2 CPU / 4 GiB** for Zebra, **0.5 CPU / 1 GiB** for the frozen Prep reader, and **0.5 CPU / 1 GiB** for the benchmark client, all subject to the shared parent limit. Quotas are ceilings, not dedicated cores. This is a service-path comparison with **unequal service allocations**.

The source was already synchronized. Both candidates received warmups; OS and server caches were warm and were not cleared. There is no cold-cache result. Timing includes request dispatch, response reads, JSON decoding, normalized projection and ordering. Exact-row and digest verification, plus source-boundary checks before and after each measurement, are outside the retrieval timer and counters. The evidence records verification durations separately.

Five background reads each of the production Prep and Chef endpoints completed without errors during the final trial. These are availability smoke checks, not a load test or an SLA. The results describe this small range, query mix and shared environment; they do not establish a universal speedup, public-internet latency or performance against another indexer.

## Evidence and reproduction

[Download recorded samples and provenance](pathname:///docs/benchmarks/2026-10-21-prep-zebra-rpc.json) — all measured samples and warmups, medians, response sizes, resources, binary and source hashes, native preparation, and the earlier complete trial.

[Download the frozen reference](pathname:///docs/benchmarks/2026-10-21-prep-zebra-rpc-reference.json) — expected rows, lookup IDs, output address, block hashes and selection rules. Validate the published aggregates with `node apps/docs/scripts/verify-benchmarks.mjs`, or follow the [benchmark README](https://github.com/EndPx/zeer/tree/main/benchmarks/prep/rpc) to repeat the work against your own node.

## Full-history startup

This later experiment measures **opening and validating an existing archive**, before serving queries. Both fresh processes read the same frozen catalog: **4,526,100 blocks, heights 0–4,526,099, in 13,513 segments**. All retained record and segment integrity checks remained enabled.

| Admission work | Previous implementation | Candidate |
| --- | ---: | ---: |
| Complete archive admission | 1,098.55 s | 897.79 s |
| Raw-reference reconstruction, included above | 551.40 s | 390.53 s |
| Process-group CPU usage | 549.23 s | 447.99 s |

These are **one sequential run per implementation**, under the same **0.5 CPU / 1 GiB** reader ceilings and shared **3 CPU / 8 GiB** pipeline, with production ingestion active. The candidate's observed admission time was **18.3% lower**. Host caches were not cleared; metadata pinning and the preceding run can affect filesystem cache. This is not a cold-disk comparison, median, throughput claim or SLA. Both pinned runs passed the 1,200 s readiness criterion.

Profiling identified raw-reference reconstruction as the largest measured phase. The candidate reconstructs supported canonical JSON directly from validated spans, avoiding a full intermediate JSON tree. Unsupported forms use the existing decoder. Payload and segment checksums, decoded-record validation, bounds and optional-index budgets remain unchanged. Both profiles record **4,526,100 record/payload/integrity checks**, identical index topology and **13,513 segment checks**.

The ordinary service binary, built without profiling timers, then opened the **live full archive** and answered HTTP readiness in **837.42 s**. That separate observation uses a later live catalog and is not another sample of the pinned comparison. Six query cases checked metadata and raw/decoded responses across first, middle and modern 16-block windows. Each matched the previous reader; headers and transaction IDs also matched the configured Zebra node. These sample checks complement admission validation rather than proving every possible query.

After the [six-receipt application test](/docs/chef/benchmarks/#shielded-receipts-six-uninterrupted-live-samples) passed, the public Prep upstream switched to this candidate. Post-switch checks returned the expected six mined transactions and ready status; existing Chef remained available. The original native reader stays warm for rollback. Public rate limits, canonicality gates and existing Chef namespaces were preserved.

[Download startup measurements and provenance](pathname:///docs/benchmarks/2026-10-22-prep-startup-testnet.json), including links to the compressed full profiles and exact source archives. Recompute the checks with `node apps/docs/scripts/verify-startup-benchmarks.mjs`; the [reproduction guide](https://github.com/EndPx/zeer/tree/main/benchmarks/prep/startup) explains the diagnostic build and resource bounds. The earlier unsuccessful full-history warmup remains in the [Chef admission study](/docs/chef/benchmarks/#full-history-rollout-check); its workload and cache conditions differ from these pinned runs.

## Earlier fixed versus adaptive comparison

The **20 October 2026** experiment compares two Prep scan modes over blocks **0–99,023 inclusive**. It is an internal comparison, not a Zebra RPC baseline. Each value is a median of three runs; both modes matched row counts and digests.

| Query | Returned rows | Fixed Prep median | Adaptive Prep median |
| --- | ---: | ---: | ---: |
| Block headers (`height`, `hash`) | 99,024 | 0.967156 s | 0.689918 s |
| Genesis transaction ID | 1 | 0.234639 s | 0.004171 s |
| Orchard filter | 0 | 0.418542 s | 0.108843 s |

Fixed scans used 1,000-block pages; adaptive scans allowed up to 1,000,000 scanned blocks subject to time and byte bounds. Headers used 100 versus 18 pages, and the filtered queries 100 versus 1. The Orchard scan had no matches in this early range. Timings included response retrieval, decoding and incremental hashing, excluded source preparation, and did not control cache state. The shared pipeline limit was 3 CPU / 8 GiB; the experiment worker had 0.5 CPU / 512 MiB, excluding supporting Prep processes.

[Download the earlier Prep-only snapshot](pathname:///docs/benchmarks/2026-10-20-prep-testnet.json). The **56.26×** genesis lookup ratio belongs to this internal fixed/adaptive experiment.

For application entity writes, PostgreSQL commits and GraphQL availability, see [Chef indexing benchmarks](/docs/chef/benchmarks/).
