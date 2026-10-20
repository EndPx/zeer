# Performance & benchmarks

| Workload | Measure |
| --- | --- |
| Prep retrieval | Equivalent selected records received and decoded |
| Chef indexing | Expected entities and checkpoint durably committed |
| GraphQL | Valid query latency at a known checkpoint, including during ingest |
| Receipt scanning | Authorized receipts processed for the selected range |

Pin the source range/hash, schema, handlers, dependencies and resource limits. Run a bounded baseline in a fresh namespace, change one bottleneck, then repeat the same workload and complete output checks.

Record elapsed time, committed blocks/transactions, fetch time, handler/entity I/O, database overhead, CPU/RSS and concurrent read latency.

**Notes:** A raw scan or fixture replay is not a whole-chain application indexing benchmark. Reproduction details are in the [benchmark specification](https://github.com/EndPx/zeer/blob/main/docs/BENCHMARK_SPEC.md) and [harnesses](https://github.com/EndPx/zeer/tree/main/benchmarks).
