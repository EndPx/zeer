# Chef request profiling

This harness measures a disposable instrumented copy of built `graphql.js` against an existing, passing query-benchmark namespace. It performs no migration, fixture import, index operation or database write. The public Chef API has no profiling flags or timing headers.

Build Chef first, then use the retained namespace report and **the exact schema used to create it**, including index declarations:

```sh
node benchmarks/chef/profile/run.mjs \
  --report benchmarks/results/query-baseline.json \
  --schema examples/chef-public/schema.graphql \
  --out benchmarks/results/request-profile-baseline.json \
  --dsn-env CHEF_QUERY_DATABASE_URL --rounds 5 --samples 20

node --test benchmarks/chef/profile/instrument.test.mjs
```

`--source` optionally selects another compiled GraphQL module. Its relative schema/store imports must resolve from its own directory. All reports must remain inside ignored `benchmarks/results/`; the output path must be new. Database credentials are read from the named environment variable and excluded from reports.

The module copy is created beside the built source in ignored `dist/` to preserve relative imports, imported with a unique name, and immediately deleted. Exact single-match transformations fail closed if the source layout changes. `sourceSha256` identifies the original compiled source. Instrumentation preserves the HTTP checks and store transaction/readiness path. The runner binds only loopback, requests each retained workload through authenticated HTTP, and checks every response against its independent expected digest and checkpoint.

Each case receives one untimed warmup. Workloads rotate by round and reverse by sample. Samples are sequential, within the normal two-query admission limit. Raw per-request values and per-case median/p95 values are saved.

The measured phases are GraphQL parsing, document surface limits, schema validation, execution (including variable coercion and resolver SQL), the remaining store-read envelope (pool/transaction/checkpoint), and initial response JSON serialization. `readMs` includes `executeMs`; use `readEnvelopeMs = readMs - executeMs` for nonoverlapping attribution. `handlerMs` also includes body arrival and uninstrumented work. `httpMs` runs through complete client response JSON parsing. Serialization of the small oversized-response error is outside the serialization phase; accepted benchmark responses must match the fixture and are below the ceiling.

Instrumentation adds overhead, so use these phases to identify plausible optimization targets and ordinary uninstrumented HTTP measurements to assess a candidate. Compare baseline and candidate using identical retained namespace, schema, workload variables, concurrency and warmup/sample counts, alternating run order. Keep correctness/readiness/admission tests separate. These warm loopback measurements do not establish WAN latency, cold-cache behavior, public service capacity, ingestion throughput or production readiness.

## Validated-document candidate

Chef retains up to 64 successful parsed/validated documents per server, with a 256 KiB budget for retained query source bytes. This is a source-text budget, not a total AST heap measurement. Invalid documents never enter the cache. An LRU hit skips parsing and document validation, so their phase fields are absent in raw instrumented samples and summarized as zero. Request admission, authentication and body limits precede lookup. Each hit still enters a fresh store snapshot, checks readiness, validates variables/operation selection through GraphQL execution, executes resolvers and serializes fresh results.

Preserve the compiled baseline **before building the candidate**, beside its relative imports, for example `packages/chef/dist/graphql.baseline.js`. Then use the uninstrumented runner:

```sh
node benchmarks/chef/profile/compare.mjs \
  --report benchmarks/results/query-baseline.json \
  --schema examples/chef-public/schema.graphql \
  --baseline packages/chef/dist/graphql.baseline.js \
  --out benchmarks/results/request-comparison.json \
  --dsn-env CHEF_QUERY_DATABASE_URL --pairs 5 --samples 20
```

The runner requires at least five alternating pairs and 100 total samples per case per variant. It records source hashes, raw client timings, median/p95 per case, and each pair's median change. Both servers share the same read-only PostgresStore. Every phase has one warmup per case and checks every response against independent expected digests and checkpoint, with an unchanged full checkpoint check after each phase. SQL caches and runtime warmup remain potential sources of noise; interpret per-pair direction and p95 alongside pooled medians. The optional `--candidate` selects another compiled candidate module. Identical source hashes are rejected. No profiler transformations or public timing API are involved in this comparison.
