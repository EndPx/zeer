# Performance & benchmarks

Measure the workload your application actually needs. A fast raw data scan, a committed application projection and a quick GraphQL response are different results.

## Separate the measurements

| Workload | Useful completion boundary |
| --- | --- |
| Prep retrieval | Equivalent selected source records received and decoded |
| Chef backfill | Expected application entities and checkpoint durably committed |
| GraphQL reads | Valid response latency at a known committed prefix, including reads during ingest |
| Local receipt scanning | Authorized receipt output and committed entities for the selected transaction range |

Starting from block zero does not establish a universal whole-chain duration. Filters, density, selected fields, source transfer, handler work, database writes, trial decryption and hardware all affect elapsed time.

## Build a reproducible comparison

Pin the source network, historical range, target hash, configuration, schema, handler generation and dependency lockfiles. Use a fresh project namespace for each clean backfill and preserve independent expected output.

Record elapsed time, committed blocks/transactions, process CPU/RSS, source-fetch time, handler time including entity I/O, database transaction overhead and query latency under the chosen concurrent load. Verify complete entity values and checkpoint hashes, not just matching row counts.

Run one bounded baseline first. Change one bottleneck, then repeat the same workload and correctness checks. An indexer waiting at the head measures block arrival rather than historical catch-up capacity.

## Repository evidence and methodology

The repository maintains [the benchmark specification](https://github.com/EndPx/zeer/blob/main/docs/BENCHMARK_SPEC.md), [Chef preflight](https://github.com/EndPx/zeer/blob/main/docs/CHEF_BENCHMARK_PREFLIGHT.md) and [reproduction harnesses](https://github.com/EndPx/zeer/tree/main/benchmarks). Machine-specific result artifacts remain local, as described there.

This page is a measurement guide, not a published ranking or an unmeasured speed multiplier. Equivalent durable output is required before comparing Chef with another application indexer. Do not present fixture replay, a prepared lookup or a browser response time as whole-chain application indexing proof.
