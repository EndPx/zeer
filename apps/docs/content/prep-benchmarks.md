# Prep retrieval benchmarks

Prep retrieves selected public chain data from a prepared archive. This benchmark compares that retrieval path with native Zebra RPC over the **same block range, fields and expected results**. It does not measure Chef indexing or shielded decryption.

All durations are in **seconds (s)**. The compact retrieval study below uses the published Zaino/Ztreamer workload. The HTTP comparison with Zebra and full-history startup measure different operations and retain their original dates and environments.

## Catalog recovery under real ingestion

Recorded **27 October 2026 (WIB)** after a live writer reached 30,000 references. The count and 16 MiB byte limits stayed unchanged. Bounded lossless consolidation restored source freshness and let the existing Chef consumer advance without a project/account reset. An independent check covered all **4,544,784 original blocks**; a held snapshot and its refreshed view returned identical data.

The observation retained **178 successful data queries, nine capacity 429 responses and three layout-change 409 responses** across 190 attempts. A further 755 metadata samples included 53 capacity responses. The reader remained under its existing shared resource ceiling; these results do not establish an error-free service SLA or a ten-application capacity limit. The writer's full archive-admission phase took **573 seconds** at a temporary 100% CPU ceiling, then returned to 50%. Caches were not cleared and this was not a comparative startup speed test.

[Download the source pins, integrity proof and all query/metadata samples](pathname:///docs/benchmarks/2026-10-27-prep-catalog-recovery-testnet.json). Recompute the statistics with `node apps/docs/scripts/verify-catalog-recovery.mjs`. The [incident report](https://github.com/EndPx/zeer/blob/main/docs/PREP_CATALOG_INCIDENT_20261027.md) explains retained segments, memory pressure, timestamps and the separate observation scopes.

## Compact-block retrieval

Recorded **23 October 2026** on Zcash testnet. Prep downloaded **4,102,798 compact blocks** in a median of **32.28 seconds**. The three runs took **31.88, 34.09 and 32.28 seconds**.

| Prepared compact-block download | Median total time |
| --- | ---: |
| Prep, measured locally | **32.28 s** |
| Zaino 0.10.1, published reference | 368.82 s |
| Ztreamer v0.1.0, published reference | 21.70 s |

The range is **280,000–4,382,797 inclusive**, retrieved in 411 consecutive requests of at most 10,000 blocks. The wire protocol, shielded-only projection, deterministic height/range schedule and ghz version match the compact retrieval subset of the [pinned reference study](https://github.com/pearl-max468/zcash-indexer-bench/tree/b01dab9df6256185e9c96fac96286b9d41f1c7ce). Reference total times are calculated from its fixed block count and published median throughput. Zaino and Ztreamer were not run again for this experiment.

### Concurrent retrieval

With **128 clients** each requesting 1,000-block ranges:

| Metric | Prep | Published Zaino | Published Ztreamer |
| --- | ---: | ---: | ---: |
| Blocks per second | 229,087 | 110,093 | 229,527 |
| Median request latency | 0.499132 s | 0.908112 s | 0.458177 s |
| p95 request latency | 0.813780 s | 1.829424 s | 0.732681 s |

Prep completed **16 scenarios over three repeats**, with **2,592,262 measured requests, all OK**. Scenarios cover metadata, single blocks, ranges of 100–100,000 blocks, 1/8/32/128 clients, and the complete download. Before timing, all 4,102,798 streamed blocks matched ordered heights and per-chunk/global payload digests; 2,000 seeded unary payload hashes and the supported published compatibility cases also passed.

### Environment and scope

Prep ran on **WSL2 Ubuntu 24.04, AMD Ryzen 5 6600H**. The server used CPUs 0–1, a two-CPU quota, a 2 GiB memory ceiling and no swap; the client used CPUs 2–3. The reference used Ubuntu 24.04 GitHub runners with 4 vCPUs, 16 GB host RAM and several CPU models. These results compare the same retrieval workload across different environments; they do not isolate an implementation speedup.

Prep served a **prepared immutable archive**, while the reference services have a broader wallet API and a local backing node. Archive acquisition, startup validation, live ingestion, wallet scanning, decryption and confirmations are outside these timings. Caches were warm and were not cleared. Client CPU approached its two-core allocation under high concurrency, limiting the interpretation of maximum server throughput.

The measured `serve-compact` profile supports height-based block retrieval and snapshot metadata. Its tip is the archive tip. Tree state, address history, mempool and the remaining wallet RPCs are outside this profile. This study does not measure the public hosted HTTP endpoint or Chef.

[Download the recorded compact summary](pathname:///docs/benchmarks/2026-10-23-prep-compact.json), including all 48 measurements, payload checks and binary hashes. Full per-request logs remain retained locally. The [reproduction guide](https://github.com/EndPx/zeer/tree/main/benchmarks/prep/compact-serving) describes acquisition, verification, resource limits and the complete schedule.

Run `node apps/docs/scripts/verify-compact-benchmarks.mjs` from the repository to check the recorded summary counts and aggregates.

### Buffered-read experiment — 24 October

An opt-in range-read candidate was tested against a fresh run of the previous binary on the same machine. The candidate completed the full 16-scenario matrix three times; the baseline repeated the complete download and two 128-client scenarios. Variant order alternated by repeat. All **4,606,704 requests across 57 measurements** were OK, and both binaries passed full payload verification before timing.

| Complete download metric | Fresh baseline | Experimental candidate |
| --- | ---: | ---: |
| Median total time | 22.920197 s | 21.186483 s |
| Median server CPU time | 26.106398 s | 16.754105 s |
| Maximum sampled anonymous memory, across measured scenarios | 835.04 MiB | 927.81 MiB |

Median download time improved **7.56%**; median server CPU time fell **35.82%**. The baseline itself was faster than its 23 October result, which is why the historical 32.28-second value is not used to attribute the candidate's improvement.

The candidate **was not promoted to default**: it missed the predeclared minimum 10% download-time improvement. The other gates passed: each paired download improved; 128-client throughput, p95 and anonymous memory stayed within their declared tolerances; all requests succeeded. Range128 median p95 was slightly higher, **0.571452 s versus 0.556283 s**, within the 5% allowance. These results do not establish a cross-hardware ranking against Ztreamer.

The experimental `buffered-range-reads` Cargo feature uses a 64 KiB range buffer and one initial seek. Every returned record retains its length, checksum and identity checks; singleton requests do not prefetch. Default builds retain direct reads. This study did not replace the hosted Prep engine or change Chef.

[Download the experimental summary and gate results](pathname:///docs/benchmarks/2026-10-24-prep-buffered.json). The [reproduction guide](https://github.com/EndPx/zeer/tree/main/benchmarks/prep/compact-serving/#compare-a-read-path-optimization) covers the paired controller and diagnostic build. Per-request logs remain retained locally.

### Transport and consumer diagnostics

A follow-up examined the cost of the benchmark consumer. A diagnostic build of pinned ghz v0.121.0 used the same Go 1.23.0 compiler as the official binary, adding CPU/allocation profiling only. About **64% of sampled CPU** was under protobuf unmarshalling. Its allocation profile estimated roughly **5 GiB cumulative allocation churn**, while the normal consumer runs below peaked near **33 MiB RSS**. Cumulative allocations are not live memory usage. One instrumented four-CPU sensitivity run did not improve time; it is not part of the comparison table.

The selected transport experiment increased internal batches from 64 to 512 blocks while retaining the 4 MiB byte cap and one block per gRPC message. In three paired screening runs, median time changed from **30.933800 s to 29.963266 s**: **3.14% lower**, with two pairs slower. It failed the predeclared screening gate, so no full concurrency acceptance matrix followed. The default batch remains **64**. Fewer write syscalls and lower server CPU did not produce a consistent latency improvement.

A separate consumer diagnostic used the same frozen range, server caps and client CPU affinity, with three runs per combination:

| Prepared engine | Consumer | Median total time | Median client CPU time |
| --- | --- | ---: | ---: |
| Direct reads, batch64 | Official ghz | 29.678618 s | 38.028973 s |
| Direct reads, batch64 | Typed Rust probe | 23.715860 s | 6.229306 s |
| Opt-in buffered reads, batch64 | Official ghz | 29.790342 s | 37.527285 s |
| Opt-in buffered reads, batch64 | Typed Rust probe | 13.993732 s | 6.164829 s |

**These are different client algorithms and validation workloads.** The typed probe checks height ordering and within-range parent links, re-encodes the pinned protobuf and verifies the complete payload digest inside its timer. All six typed downloads matched **4,102,798 blocks, 411 requests, 529,228,615 payload bytes** and the expected digest. Every official-ghz request was OK. Both engines used 2 CPU / 2 GiB; clients used affinity to two separate CPUs. Client memory was observed, not capped in this diagnostic. Caches were warm and engine/client order alternated.

The typed timings are **not replacements for the reference ghz benchmark** and cannot rank Prep against Zaino or Ztreamer measured with ghz. They show that consumer processing can limit this end-to-end workload and obscure some engine-side savings. Buffered reads remain opt-in; no hosted engine cutover followed this study.

[Download profiling, screening and consumer summaries](pathname:///docs/benchmarks/2026-10-24-prep-consumer.json). The [reproduction notes](https://github.com/EndPx/zeer/tree/main/benchmarks/prep/compact-serving/#transport-and-consumer-diagnostics) include the typed probe, profiling hooks and rejected batch patch. Raw profiles and per-request logs remain retained locally.

The next [Chef 0.6.1 application study](/docs/chef/benchmarks/#address-analytics-with-chef-061) tested PostgreSQL writes, concurrent GraphQL reads, pagination and restart against both reader modes while real Prep ingestion progressed. It found identical application results, but no consistent indexing-time improvement. Those application timings are kept in the Chef chapter; buffered reads remain opt-in.

## Workload and results

The following matched HTTP retrieval study was recorded **21 October 2026 (UTC)**.

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
