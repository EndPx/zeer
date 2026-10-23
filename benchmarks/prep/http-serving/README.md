# Native HTTP serving during ingestion

This workload measures Prep's full-data HTTP API while a separately observed
follower ingests modern testnet blocks. It is separate from the lightwallet
compact-stream benchmark. Different payloads and protocols must not be placed
in the same throughput comparison.

Build `load.go` with Go, and generate an untimed oracle directly from a checked
full archive:

```sh
go build -o /path/to/http-load benchmarks/prep/http-serving/load.go
cargo run --release -p prep --example http_benchmark_oracle -- \
  /path/to/full-archive /path/to/new-oracle.json
```

The oracle contains stored headers and up to eight transactions from each of
transparent, Sapling, Orchard, and Ironwood activity. Before measurement,
cross-check every selected transaction's raw bytes and containing block hash
against the existing source node. Preserve the oracle checksum, block range,
actual pool counts, and source check results.

Run the follower and `serve-http` on separate CPU sets, then execute a bounded
phase (the API token is read from the environment):

```sh
/path/to/http-load --oracle /path/to/new-oracle.json \
  --endpoint http://127.0.0.1:39481 --case headers1000 \
  --clients 8 --seconds 30 --out /path/to/new-result-prefix
```

Cases are `headers1000`, `txid`, and `raw_shielded`; concurrency is bounded to
1–128 and each phase to 1–60 seconds. The runner makes no retries. It verifies
every successful response against the oracle, saves compressed per-request
samples, and separates capacity/readiness failures from successful work.

Latency covers request dispatch through complete response reception and JSON
decoding. Oracle comparison occurs after that timer, but still contributes to
achieved workload throughput. The runner's quantiles use index
`floor((n - 1) * p)`; retain that convention when comparing its results.

Record live source height/hash, archive epoch/revision, follower/reader resource
usage, and canonicality checks alongside every phase. A listening follower with
no observed progress is not evidence of concurrent ingestion. Do not remove
capacity or readiness errors to improve the reported latency. Raw evidence and
machine-specific controllers remain local; no API token or RPC credential
belongs in the report.
