# Bounded concurrent HTTP load

These scripts measure operator-prepared private services. They do not start Docker,
mutate sources, migrate/drop schemas, ingest chain data, or retry rejected requests.
Run Prep and Chef separately. Keep the VPS experiment within 3 CPU, 8 GiB RAM,
40 GiB disk and use one shared `--exclusive-lock` path across all runs. The lock
only coordinates these harness invocations; the operator must check for other
benchmarks and place the controller and services in bounded cgroups.

The Python runner uses only the standard library and the existing independent
oracle loader. Numeric RFC1918/loopback HTTP endpoints are preferred; DNS must
resolve entirely to those address classes and is frozen before requests begin.
Bearer tokens come from an existing environment variable and never enter reports.
Output must be a new file inside ignored `benchmarks/results/`.

```sh
python -m unittest benchmarks.load.test_run -v

# From the candidate checkout; existing authenticated Prep archive service.
python -m benchmarks.load.run \
  --profile prep --endpoint "$PREP_LOAD_ENDPOINT" --token-env PREP_API_TOKEN \
  --oracle "$ORACLE_32768" \
  --out benchmarks/results/load-prep-32768-baseline.json \
  --exclusive-lock /opt/zeer-scale/20261014/load.lock \
  --requests-per-client 400 --max-seconds 600
```

For the existing 2,048-block public fixture, use
`benchmarks/fixtures/mainnet-public-2048/oracle.json.gz`. For the admitted 32,768
tier, use the independently captured matching oracle under
`/opt/zeer-scale/20261014/oracles/` and the corresponding prepared archive. An
oracle ending at 2,048 cannot validate a frozen service ending at 32,768. The
operator should record the candidate binary hash, actual endpoint/container,
resource limits, host counters and service logs beside the result. The script
records its own source hash and exact compressed oracle hash.

Each concurrency level 1, 2, 4, 8 runs a fixed number of requests per client with
one outstanding request per client, a simultaneous client start and rotated
equal-weight work cases. `--requests-per-client` must be a multiple of four,
between 4 and 1,000. Every attempt opens a fresh TCP connection. Default 40 means
600 attempts total, with 10 successful samples per case at concurrency one if
there are no rejections. With 400, the total is 6,000 attempts, 100 per case at
concurrency one before rejections. Successful sample counts can be lower under
admission pressure. Per-attempt HTTP time includes connection establishment,
complete response receipt and JSON decode. Oracle checking is outside that timer,
but achieved throughput includes checking and Python scheduling. Frozen expected
rows and digests are precomputed in untimed preflight; active prefix expectations
use a bounded 64-entry cache. No sample is
discarded as warmup; four exact-oracle preflight requests are separately untimed.

`--think-ms` optionally adds a fixed 0..100 ms pause after every attempt, including
every rejection, without retries. The default is zero, preserving the static and
unpaced active-Chef measurement behavior. The pause is outside HTTP latency and
inside overall achieved throughput; the report records its exact value. For an
active Prep append experiment, `--think-ms 5` can keep requests spread across real
archive publications instead of exhausting attempts during a readiness gate.
Such a paced run measures consistency under controlled requests; do not use its
throughput as a maximum-capacity result or compare it to an unpaced run.

The cases intentionally form separate profiles:

| Case | Prep | Chef public projection |
| --- | --- | --- |
| `small_id` | One txid, its known block, two scalar fields | Transaction by ID, two scalar fields |
| `page` | Up to 128 blocks, txid and height metadata | First 100 transactions in ID order |
| `sparse` | One txid over up to 1,000 available blocks | First 100 rows matching a known mined height |
| `full_metadata` | Up to 128 blocks, all eight indexed tx scalar fields | First 100 transactions, all seven public projection fields |

They do not have equivalent row counts or execution semantics, so the reports do
not establish a Prep-versus-Chef performance ranking. Full metadata does not mean
raw transaction bytes, scripts, decrypted shielded fields, or full-chain coverage.
Every successful response verifies exact independent-oracle rows, scalar encodings,
checkpoint identity and page cursor/progress. Prep verifies the independently
captured current head header before and after the run. Chef verifies `_meta.hash`
against that height's independent oracle on every successful response.

Reports preserve every attempt and classify `verified_200`, `capacity_429` (Prep
`QUERY_CAPACITY_EXCEEDED`), `capacity_503` (Chef `Query capacity reached`), and
`unready_503` (`SOURCE_NOT_READY` or Chef `Indexer is not ready`) separately.
Unknown HTTP errors, failed row checks, transport failures, incomplete deadline
samples and levels without any verified success fail the run. Expected admission
rejections do not fail a capacity measurement. They stay in attempt throughput and
all-attempt latency; successful latency and successful throughput are separate.
No rejected request is retried. Every case at every level needs at least one
verified success; `--min-successes-per-case` can raise that acceptance threshold.
A frozen service returning readiness failures fails the run, and its concurrency
one level requires every attempt to succeed. `PASS` means the bounded measurement and integrity
checks passed, not that all requests succeeded or that a service meets an SLO.

Quantiles use nearest-rank order statistics and expose `n`, including empty
success sets. A p99 from fewer than 100 successful samples is usually just the
observed maximum. `p99_tail_samples` reports `floor(n/100)` and does not imply
confidence, independence or statistical tail guarantees. Use the raw per-case
samples rather than pooling unlike workloads for performance claims.

## Serve a retained Chef query fixture

The existing query harness closes its HTTP server at completion. This optional
wrapper serves its passing retained namespace read-only on loopback. It checks
the exact schema/fingerprint and checkpoint before binding, never calls migrate
or acquire, and closes after a bounded lifetime. Start it only in the operator's
prepared resource allocation, then run the Python profile from another controlled
shell. Use the exact schema that created the retained namespace, including any
`@index` directives. `--source` can select a preserved compiled `graphql.js`
baseline beside its existing relative imports; otherwise the current build loads.

```sh
node benchmarks/load/serve_chef.mjs \
  --report benchmarks/results/query-baseline.json \
  --schema examples/chef-public/schema.graphql \
  --port 39379 --token-env CHEF_API_TOKEN \
  --dsn-env CHEF_QUERY_DATABASE_URL --max-seconds 900

python -m benchmarks.load.run \
  --profile chef --endpoint http://127.0.0.1:39379 --token-env CHEF_API_TOKEN \
  --oracle benchmarks/fixtures/mainnet-public-2048/oracle.json.gz \
  --out benchmarks/results/load-chef-2048-baseline.json \
  --exclusive-lock /opt/zeer-scale/20261014/load.lock \
  --requests-per-client 400 --max-seconds 600
```

## Query while actual ingestion advances

Use a newly owned archive and namespace and an independently captured final
oracle from the same deterministic frozen source. The controller, not this
read-only script, runs the real Prep sync and real Chef PostgreSQL worker. Admit
an initial ready prefix (for example 128), run the load, and pace actual append
commits until 2,048. Keep source identity and writer events with nanosecond/Unix
timestamps so they can be compared with each HTTP attempt's start/completion.
No public chain broadcasting is required. Never rewrite a readiness status file
to make a changing archive appear ready.

```sh
python -m benchmarks.load.run \
  --profile prep --endpoint "$PREP_INGEST_ENDPOINT" --token-env PREP_API_TOKEN \
  --oracle benchmarks/fixtures/mainnet-public-2048/oracle.json.gz \
  --active-min-height 128 --assert-final-height 2048 \
  --out benchmarks/results/load-prep-active-ingest.json \
  --exclusive-lock /opt/zeer-scale/20261014/load.lock \
  --requests-per-client 1000 --max-seconds 900
```

Repeat for `--profile chef` with the actual public projection worker/server. Prep
query ranges stay within the initial prefix, so no request asks for a future
block. Chef pages are checked against exactly the prefix specified by that same
response's `_meta`, excluding all future rows. Each successful Prep response must
have the initial epoch and a revision/height within the admitted append-only
oracle; each successful Chef response must have the corresponding canonical hash.
The output retains all observed checkpoint identities. Active mode requires
multiple distinct heights among successful load responses and a higher final
ready head; `--assert-final-height` additionally pins its expected final height.
It fails if the entire append happened before or after the successful load
responses. Final ready probes do not retry; the controller must pace its writer
to finish inside the measured run. Re-run only with a fresh output name and a
fresh planned ingestion experiment.

This proves per-response consistency during an observed append scenario when
combined with real writer logs. It does not independently prove overlap from
external writer logs, reorg recovery, crash durability or production readiness.
Use the existing connected recovery and reorg harnesses for those separate gates.

## Actual Chef ingestion with a synchronized start

`ingest_chef.mjs` provides the prepared writer and loopback server for the Chef
append experiment. It calls the real `PrepClient` and `syncStep`, imports the
existing `examples/chef-public/chef.config.ts` handlers, creates a fresh random
marked PostgreSQL namespace and warms only the initial 128 blocks before READY.
It uses separate `PostgresStore` instances for the writer and HTTP reader. The
source must be an already ready immutable private numeric IPv4 Prep endpoint
covering the final range; its epoch/revision/head/network identity must match
before and after writing. It uses no source RPC mutation and sends no blockchain
transactions. `fsync`, `synchronous_commit` and `full_page_writes` must be enabled.

Run this helper in its prepared allocation; after its READY event, run the Python
client from a separately bounded controller. The helper intentionally keeps the
server alive after WRITER_DONE for client postflight. `--max-seconds` (default
120, maximum 600) aborts source requests, pacing, waiting and serving, but some
database operations and cleanup do not honor that signal. A complete-process
bound requires an outer supervisor: run the writer under a systemd unit with
`RuntimeMaxSec=300`, `TimeoutStopSec=10` and `KillMode=control-group` for an
internal `--max-seconds 240` experiment. Run the load client with its own outer
`RuntimeMaxSec=210` for an internal `--max-seconds 180` budget. These hard limits
remain necessary if PostgreSQL or cleanup stalls. Stop the writer after the
client finishes.
The random namespace, report and PostgreSQL rows are retained.

```sh
node --test benchmarks/load/ingest_chef.test.mjs

node benchmarks/load/ingest_chef.mjs \
  --oracle benchmarks/fixtures/mainnet-public-2048/oracle.json.gz \
  --out benchmarks/results/active-chef/writer.json \
  --start-file benchmarks/results/active-chef/start.json \
  --prep-url "$PREP_FROZEN_2048_ENDPOINT" \
  --port 39380 --initial-height 128 --end-height 2048 \
  --page-size 16 --delay-ms 50 --max-seconds 120

# After READY, in the bounded client allocation:
python -m benchmarks.load.run \
  --profile chef --endpoint http://127.0.0.1:39380 \
  --token-env CHEF_API_TOKEN \
  --oracle benchmarks/fixtures/mainnet-public-2048/oracle.json.gz \
  --active-min-height 128 --assert-final-height 2048 \
  --start-signal-file benchmarks/results/active-chef/start.json \
  --out benchmarks/results/active-chef/client.json \
  --exclusive-lock /opt/zeer-scale/20261014/load.lock \
  --requests-per-client 1000 --max-seconds 110
```

The helper reads `CHEF_QUERY_DATABASE_URL`, `CHEF_API_TOKEN` and `PREP_API_TOKEN`
by default, with explicit `--dsn-env`, `--token-env` and `--prep-token-env`
overrides.
`--source-timeout-ms` explicitly bounds each Prep request between 100 and 30,000
milliseconds (default 30,000); the overall abort signal also applies. API tokens
and database credentials never enter the report or cleanup diagnostics.
`--schema` selects the exact optional `@index` schema; `--source`
selects a preserved compiled GraphQL module for the HTTP server. All request
handlers remain the actual imported public example config. Both the writer output
and start file must be new files under ignored `benchmarks/results/`.

`--start-signal-file` is an explicit local file write authorized by that flag. The
load runner atomically publishes a complete no-overwrite signal only after its
initial checkpoint, head proof and all four exact-oracle preflight cases pass.
The writer validates the signal event, timestamp and report path, then starts its
actual paced append. This avoids starting the writer while client oracle loading
or initial correctness checks are still in progress. The signal is retained and
never reused; choose fresh paths for a new experiment.

The helper records each page's start/end Unix milliseconds, real runtime timing,
block/transaction counts and resulting independently checked checkpoint. At the
end, it verifies every persisted `Block` and `PublicTransaction` entity and the
actual final database checkpoint against the independent oracle in one read-only
repeatable-read transaction. This verification is separate from query timing.
WRITER_DONE includes that digest/count/checkpoint proof. Compare writer page
intervals with client `started_unix_ns`/`http_completed_unix_ns` timestamps and observed successful checkpoint
heights to establish actual overlap. Deliberate delays are part of this
consistency experiment and must not be reported as maximum ingestion throughput.
`completed_unix_ns` additionally includes oracle verification and should not be
used as the HTTP-completion boundary. Any rejected owned cleanup is recorded by
resource/error class and changes the final writer report to FAIL.
