# Prep retrieval benchmarks

Prep's benchmark measures retrieving selected public chain data from a prepared archive. It times response retrieval, decoding and incremental row hashing.

Recorded **20 October 2026** on real **Zcash Testnet** data. All durations are in **seconds (s)**.

## Workload and results

Range: **0–99,023 inclusive**. Each value is the median of **three alternating runs** per mode. All runs completed the range and matched row counts and digests.

| Query | Returned rows | Fixed scan median | Adaptive scan median |
| --- | ---: | ---: | ---: |
| Block headers (`height`, `hash`) | 99,024 | 0.967156 s | 0.689918 s |
| Genesis transaction ID | 1 | 0.234639 s | 0.004171 s |
| Orchard filter | 0 | 0.418542 s | 0.108843 s |

Fixed mode used 1,000-block pages. Adaptive mode allowed up to 1,000,000 scanned blocks per response, subject to time and byte bounds. Header scans used 100 versus 18 pages; the two filtered scans used 100 versus 1.

The Orchard query had **no matches in this early range**. It measures an empty filtered scan, not modern shielded-transaction processing. Source preparation is excluded. Cache state was not controlled.

## Environment & evidence

Requests ran over loopback on a shared VPS. The pipeline envelope was **3 CPU quota / 8 GiB RAM**; the experiment worker had **0.5 CPU / 512 MiB**, excluding supporting Prep processes. Quotas are ceilings, not dedicated cores.

These results compare fixed and adaptive Prep retrieval. They do not measure PostgreSQL entity writes, Chef indexing, public-internet latency or performance against another indexer.

[Download recorded samples and provenance](pathname:///docs/benchmarks/2026-10-20-prep-testnet.json). This Prep-only snapshot contains all 18 retrieval samples, ranges, row counts, digests and source provenance. Validate its aggregates with `node apps/docs/scripts/verify-benchmarks.mjs` from the checkout.

For application-indexing results, see [Chef indexing benchmarks](/docs/chef/benchmarks/).
