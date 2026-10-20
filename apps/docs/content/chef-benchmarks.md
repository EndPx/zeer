# Performance & benchmarks

Recorded **20 October 2026** on real **Zcash Testnet** data. These runs use a prepared historical archive on a shared VPS, with requests over loopback.

All durations below are shown in **seconds (s)**.

## Prep retrieval

Range: **0–99,023 inclusive**. Each value is the median of **three alternating runs** per mode. All runs completed the range and matched row counts and digests.

| Query | Returned rows | Fixed scan median | Adaptive scan median |
| --- | ---: | ---: | ---: |
| Block headers (`height`, `hash`) | 99,024 | 0.967156 s | 0.689918 s |
| Genesis transaction ID | 1 | 0.234639 s | 0.004171 s |
| Orchard filter | 0 | 0.418542 s | 0.108843 s |

Fixed mode used 1,000-block pages. Adaptive mode allowed up to 1,000,000 scanned blocks per response, subject to time and byte bounds. Header scans used 100 versus 18 pages; the two filtered scans used 100 versus 1.

The Orchard query had **no matches in this early range**. It measures an empty filtered scan, not modern shielded-transaction processing. Source preparation is excluded; response retrieval, decoding and incremental row hashing are timed. Cache state was not controlled.

## Chef indexing

Range: **0–9,999 inclusive**, starting from an empty project namespace. The installed starter produced **10,000 BlockSummary entities** while a separate GraphQL process served reads.

| Profile | First data observed in GraphQL | Indexing complete |
| --- | ---: | ---: |
| Fixed source pages, 32-block commits | 1.201 s | 36.696 s |
| Adaptive source pages, 32-block commits | 1.591 s | 35.215 s |

These are **one recorded run per profile**, not medians. Both finished at checkpoint 9,999 with identical entities; every entity was compared against the separately collected source projection. The timer includes CLI startup and polling through completion; database setup and the final full comparison are excluded.

## Environment & evidence

The shared pipeline envelope was **3 CPU quota / 8 GiB RAM**. The experiment worker had **0.5 CPU / 512 MiB**, excluding supporting Prep and PostgreSQL processes. Quotas are ceilings, not dedicated cores. These results do not measure whole-chain indexing, cold startup or public-internet latency.

[Download recorded samples and provenance](pathname:///docs/benchmarks/2026-10-20-testnet.json). The snapshot includes every Prep timing, ranges, digests, source revision, original evidence hashes and both Chef runs. Validate its aggregates with `node apps/docs/scripts/verify-benchmarks.mjs` from the checkout.

For new measurements, use the [benchmark specification](https://github.com/EndPx/zeer/blob/main/docs/BENCHMARK_SPEC.md) and [harnesses](https://github.com/EndPx/zeer/tree/main/benchmarks). Keep retrieval, durable indexing and GraphQL latency as separate workloads.
