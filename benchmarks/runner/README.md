# Fixed-range public chain-data runner

Python 3.12+, standard library only. This is a benchmark harness, not the Zeer
engine, SDK or CLI product. No candidate has been measured merely by adding or
passing these tests.

## Measurement contract

`public-chain-data-read` measures elapsed time from starting a source read until
all required block identities have been normalized **in memory**. It does not
measure fresh indexing into a durable database. Reference validation and source
identity preflight run before timed repetitions. Candidate output verification
runs after the read timer stops and has its own duration. The small timer boundary
includes thread launch, request parsing and adapter normalization.

The common projection is `{height, hash, prev_hash, txids}`. Hashes are lowercase
64-character hex in conventional RPC display order; gRPC byte fields must be
converted deliberately by their adapter. Transaction IDs retain chain order.
Record order is ascending height, with inclusive start/end. No receipt, memo,
balance, address or private viewing key is required.

Five sequential repetitions are the default. All requested repetitions must
pass and at least five must run before a report becomes comparison eligible.
Failed/partial experiments have no headline median and never receive a winner
label. A passing rehearsal with fewer than five runs is not comparison eligible.
Reports record the source-call count if an adapter exposes `request_count`.

## Reference manifest

`freeze_manifest(records, network=..., genesis_hash=..., reference_name=...,
reference_version=..., provenance=..., projection="full_transactions")` constructs a JSON-serializable manifest.
Acquire and validate the reference independently before freezing it. Do not
regenerate expected data from the candidate during a benchmark run.

Required fields:

- `schema_version: 1`, `scenario: "public-chain-data-read"`.
- `projection`: `full_transactions` (default when freezing) or `shielded_compact`.
  The latter lists only txids represented by the declared compact projection.
  Derive that list independently from reference transaction shielding fields;
  do not copy candidate compact output into the reference. Include the exact
  selection rule and upgrade assumptions in provenance. Never compare these two
  projections as the same workload. Reports label the projection explicitly.
- `network`: `mainnet`, `testnet` or `regtest`; `genesis_hash`.
- `start_height`, `end_height`, `start_hash`, `end_hash`.
- `reference_source`: nonempty `name`, `version`, `provenance`.
- `records`: ordered complete block identity list.
- `records_sha256`: canonical JSON SHA-256 of the normalized record list.
- `field_sha256`: one SHA-256 per field over that field's ordered value list.

Canonical JSON uses sorted keys, ASCII escaping, compact separators, UTF-8 and
no NaN. A checksum detects changed data; it cannot establish chain correctness
by itself. Freeze the manifest hash in the preregistration/provenance evidence.
Additional manifest metadata is allowed and covered by `manifest_sha256` in
the report. Genesis outside the selected range is checked in source preflight.

## Adapter API

```python
from benchmarks.runner import run_benchmark, write_report

class CandidateAdapter:
    def check_source(self, manifest, deadline):
        # Check network and genesis against the actual source before measuring.
        # Raise on mismatch; deadline is an absolute time.monotonic() deadline.
        ...

    def read_blocks(self, start, end, deadline):
        # Yield ordered dicts with height/hash/prev_hash/txids.
        # Observe deadline and transport timeouts. No hidden retries or cache.
        ...

report = run_benchmark(
    CandidateAdapter(), frozen_manifest,
    candidate={
        "name": "declared-candidate",
        "version": "pinned-build-id",
        "source_version": "pinned-source-id",
        "endpoint": "http://127.0.0.1:18232",
    },
    repetitions=5,
    run_timeout_s=120,
)
write_report(report, "path/to/candidate-run")
```

`JsonRpcAdapter` supplies this API using `getblockchaininfo`, `getblockhash(0)`
for preflight, then sequential `getblockhash(height)` + `getblock(hash, 1)`.
No request batching or retries are hidden in this adapter. Candidate/source
versions are required declared metadata, not binary attestation.

The timeout guard bounds caller waiting. Python cannot kill a stalled adapter
thread, so a timeout aborts all remaining repetitions. **Exit the process after
TIMEOUT before starting another candidate.** Custom adapters must also honor the
deadline. The built-in RPC client applies transport timeouts and response-size
limits. The guard does not authorize load beyond the external container limits.

Endpoints are reduced to scheme/host/port in reports. Paths, query parameters,
fragments and userinfo are omitted; exception messages are never persisted.
Candidate names/version strings must be nonsecret. Use environment variables for
endpoint/auth inputs and do not commit them. The RPC client rejects redirects
and URL-embedded userinfo; supply Authorization separately when required.

## Run the RPC adapter

Set `ZEER_BENCH_RPC_URL` in the process environment, then from the repo root:

```text
python -m benchmarks.runner --manifest path/to/frozen.json --candidate candidate-name --version pinned-build --source-version pinned-source --output path/to/report
```

Optional `--auth-header-env VARIABLE_NAME` loads an Authorization header from the
environment. JSON and Markdown outputs share the output stem. Exit code 0 means
all requested runs passed; 1 means an executed experiment failed; 2 means invalid
input/setup. Check `summary.eligible_for_comparison` separately (short rehearsals
can exit 0 but are ineligible).

For a gRPC adapter, use `projection="shielded_compact"` with its separately frozen
reference. A projection missing transparent-only transaction IDs must fail a
`full_transactions` workload. Never silently call both equivalent. The record
field structure is shared but the projection and manifest hash remain distinct.

## Offline verification

```text
python -m unittest discover -s benchmarks/tests -v
```

Tests construct explicit synthetic hashes and records, corrupt them, and check
omissions, duplicates, parent/boundary mismatches, transaction order, timeout,
preflight rejection, deterministic serialization and separate verification time.
No live chain, package install, wallet, or remote source is contacted.
