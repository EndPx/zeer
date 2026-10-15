# Full-block verification and native-read observation

`verify.py` requires a frozen Zebra-compatible JSON-RPC source and a running
Prep HTTP archive containing mainnet blocks 1000-2023. Its allowlisted source
reads compare complete raw blocks and every decoded source field with Prep,
then validate transaction-ID and transparent-output filtering. JSON decimals
are read independently with Python Decimal while retaining the original source
token, including scientific notation and trailing zeros. A conversion such as
`str(Decimal('1e-6'))` would change the expected string into `0.000001` and create
a false mismatch. No spending or signing occurs.

```sh
export PREP_API_TOKEN='your-local-deployment-token'
python benchmarks/prep/full/verify.py \
  --source http://your-private-node:8232 \
  --prep http://127.0.0.1:39368 \
  --from-block 1000 --to-block 2024 --out /path/to/new-results
```

The script is for a trusted isolated benchmark network. The plaintext node URL
must have no credentials; the actual experiment uses private Docker networking
with no public Prep port. Do not point it at a changing or untrusted source.

The timed task projects only height/hash/time. The RPC side uses eight workers,
reused connections and known hashes; Prep uses pages of 128 blocks. Both normalize
the same final fields. It includes native transport/decoding work but excludes
initial node synchronization and Prep ingestion. This is not an isolated-engine
comparison or a benchmark of full transaction throughput. Preserve every run.

`live_smoke.py` is a separate **Regtest-only mutating test**: it checks the fixed
Regtest genesis and initial height 1024, then mines two disposable blocks using
`generate`. Use a private copy of the original
[1024-block fixture](../../fixtures/regtest-1024), never an application node.
The provided `zebra-regtest.toml` uses the same activation schedule and disables
seed discovery for an internal Docker network. Start `prep sync --follow` from
1020 with confirmations 1, segment size 2 and a finite rehearsal step limit; start
`prep serve-http` against that archive, then run:

```sh
python benchmarks/prep/full/live_smoke.py \
  --source http://your-private-regtest:18232 \
  --prep http://127.0.0.1:39368 --out /path/to/new-live-result.json
```

Its source checks precede mining. The assertion on initial height prevents an
accidental rerun against an already advanced fixture. Source growth must become
queryable while an old cursor retains its captured range. Reorgs are tested by
the Rust controlled-source suite rather than claimed from this two-block test.

Record source images, process limits, code/binary hashes and all outcomes in
local execution manifests under `benchmarks/results/`. Reports and measurements
are excluded from Git; see the [retention policy](../../README.md#local-results-policy).

## Comparing Prep revisions

`compare.py` serves a different purpose: compare two release binaries against
the **same already prepared immutable archive**. Give each server the same CPU
and memory limits, use the same private Docker network, and stop ingestion while
measuring. No new Python dependencies are needed.

```sh
python -m unittest benchmarks.prep.full.test_compare -v
python benchmarks/prep/full/compare.py \
  --before http://prep-before:39368 --after http://prep-after:39368 \
  --from-block 1000 --to-block 5096 --runs 5 --out comparison.json
```

It tests headers, raw blocks, transaction metadata, full block/transaction
projections, a matching transaction ID, and a no-match version scan. Each case
warms both servers and alternates their order over all measured runs. The
reported duration sums request times through JSON decoding; ordered record
hashing and equivalence checks run **between requests, outside the timer**.
These durations are not uninterrupted wall-clock scan times. Record counts and
SHA-256 digests must match independently of page boundaries. The client releases
each page before the next request instead of retaining the entire dataset.

The benchmark never overwrites an existing output. Ordinary failures preserve
completed measurements with `FAIL`; an externally killed process may leave an
incomplete file. It is a regression comparison, not a consensus oracle. Use the
separate full-node verifier for source equality. Record the exact binaries,
archive identity, resource limits and any regressions; do not publish only the
fastest case.

## Modern complete-block compatibility

The committed [NU5 fixture](../../fixtures/mainnet-nu5-full-v1/README.md) has
three genuine complete mainnet blocks with nonempty Sapling and Orchard data.
It is replayed through a small read-only RPC adapter; the block envelope is
assembled from official raw headers and separately captured decoded transactions.
It is not a running modern full node. On Linux, run the replay in one terminal:

```sh
python benchmarks/prep/full/modern_capture.py serve \
  --fixture benchmarks/fixtures/mainnet-nu5-full-v1/fixture.json --port 18232
```

In another terminal, ingest the three-block range and start Prep:

```sh
target/release/prep sync --source http://127.0.0.1:18232 --network mainnet \
  --archive ./data/modern-proof --from 1687106 --to 1687108 \
  --confirmations 0 --segment-blocks 2
target/release/prep serve-http --archive ./data/modern-proof
```

Then verify full blocks, full transactions, pagination and all four true/false
pool-filter cases. `PREP_API_TOKEN` is forwarded when configured:

```sh
python benchmarks/prep/full/modern_capture.py verify \
  --fixture benchmarks/fixtures/mainnet-nu5-full-v1/fixture.json \
  --prep http://127.0.0.1:39368 --out modern-proof.json
```

## Actual-node outage and branch-change proofs

These tools **mutate only an explicitly disposable, peerless Regtest node**.
Use a copy of the frozen 1024-block state and `zebra-regtest.toml`. Never use an
application node. The pinned Zebra binary can run directly with Docker options
`--entrypoint zebrad --user 10001:10001` and container command
`--config /config.toml start`; the copied
state must be writable by that UID. This avoids relying on privileged entrypoint
initialization when all Linux capabilities are dropped.

The Docker-host outage harness requires these exact container roles, all labelled
`zeer.benchmark=prep-proof-20261013`, without published ports:

| Name | Role | Executed resource cap |
| --- | --- | --- |
| `zeer-prep-proof-node` | Disposable Zebra Regtest at initial height 1024 | 0.75 CPU / 2 GiB |
| `zeer-prep-proof-follow` | Prep directly as PID 1, no restart supervisor | 0.5 CPU / 2 GiB |
| `zeer-prep-proof-http` | Prep HTTP over the same follow archive | 0.5 CPU / 1 GiB |

Run the follower from 1020 with segment size 2, confirmations 1, polling 1 second,
`--follow --max-source-retries 8`. Start HTTP after the archive exists and is
ready at 1024. Use its bearer token in `PREP_API_TOKEN`. The host driver was
separately limited to 0.5 CPU / 512 MiB by a temporary systemd unit.

```sh
python benchmarks/prep/full/resilience_proof.py \
  --source http://PRIVATE_NODE_IP:18232 --prep http://PRIVATE_PREP_IP:39368 \
  --expected-head 1024 --duration-seconds 600 \
  --allow-disposable-regtest-mutation --out resilience-proof.json
```

The source IP must match the labelled node container. The harness checks the
actual Regtest genesis and empty peer list, mines periodically, and stops the
same source container for 30 seconds at each of two scheduled points. It checks
stopped state, unready status, HTTP 503, automatic recovery and unchanged Prep
container/PID/start time. Final raw data and the complete old cursor continuation
are compared with the source. Evidence is a ten-minute rehearsal, not a long-term
production soak. Source address changes and initialization failures are outside
the current retry policy.

After it finishes, stop all other mining and use the recorded final height as
`N`; set `FROM=N-4`. Keep the same Prep follower and HTTP service running:

```sh
python benchmarks/prep/full/reorg_proof.py \
  --source http://PRIVATE_NODE_IP:18232 --prep http://PRIVATE_PREP_IP:39368 \
  --expected-head N --from-block FROM --depth 2 --confirmations 1 --timeout 90 \
  --allow-disposable-regtest-mutation --out reorg-proof.json
```

This uses Zebra's real `invalidateblock` and `generate` RPCs to replace the last
two canonical blocks and extend the new branch. It requires an advanced epoch,
HTTP 409 `REORG` for the old cursor, and exact replacement blocks/transactions
without duplicates. It is an administrative canonical branch replacement,
not a naturally occurring P2P race. Both harnesses retain stage journals on
failure and reject existing result paths. Stop the experiment services afterward.

Offline guard and fixture checks:

```sh
python -m unittest benchmarks.prep.full.test_modern_capture \
  benchmarks.prep.full.test_reorg_proof benchmarks.prep.full.test_resilience_proof -v
```

## Repeat native retrieval comparisons

`retrieval_session.py` can reuse the preserved six-provider environment with a
new verified Prep binary/container and fresh results. Set `--source`, `--out`,
`--prep-container`, `--client-prefix` and `--token-env` explicitly. The prepared
container must mount the matching immutable archive read-only, expose no public
port, and accept its token through the environment. The controller does not build
or replace that container. Record binary, source and archive identities alongside
the session record.

Use `--prep-projection metadata --prep-sparse-access batch` to measure current
native public metadata retrieval: `/query` for complete header/transaction scans
and `/transactions` for the 128 selected IDs. The sparse batch must complete in
one request; its extra transaction-index positions are checked against independent
oracle order outside timing. The default `decoded`/`query` options preserve the
older overfetch workload for explicit historical reproduction.

The same seven normalized fields and complete digests are checked across native
HTTP, SQL and gRPC paths. Native batching and RPC concurrency differ and must be
disclosed. gRPC adapters in this harness measure sparse lookup only; empty scan
cells mean unmeasured compatibility, not a failed provider or zero throughput.
Five cyclic rounds yield five observations per applicable workload. Run inside
the enforced `zeerretrievalclient.slice` (1 CPU / 512 MiB / zero swap); source and
active backend each have 1 CPU / 2 GiB ceilings. Start no parallel experiments.
Retain failures, all observations, actual limits, and cleanup checks under ignored
results. Source preparation, startup, warmup and independent equality checks are
outside the measured retrieval interval.

## Bounded contiguous NU5 dataset capture

`modern_dataset.py` captures a contiguous historical mainnet range from
CipherScan, without Prep or Chef producing the expected metadata. Keep its output
under an ignored results directory; captured transaction bodies must not be
committed.

```powershell
python benchmarks/prep/full/modern_dataset.py capture --out .deploy-local/modern256 --from-block 1687106 --blocks 256
python -m unittest benchmarks/prep/full/test_modern_dataset.py
```

Capture performs sequential requests at least 0.7 seconds apart (below 90 per
minute), with at most five attempts for HTTP 429 and transient server errors.
`Retry-After` is honored within a 120-second retry wait and the overall deadline.
Each invocation is limited to 1,800 seconds and 512 MiB of local capture files,
including response caches, temporary writes and generated outputs. Responses are
limited to 16 MiB each. The CLI accepts 2â€“1,024 blocks. Run only one capture
process against this provider at a time so the request budget remains global.

The same capture command resumes cached responses after checking their SHA-256
and byte length. `responses/` preserves exact provider JSON and source metadata;
`blocks/{height}.json` is atomically published only after validation, and
`progress.json` records the validated contiguous prefix. An exception retains
partial files and does not emit a completed fixture. A process-exclusive
`.capture.lock` prevents two writers in one directory; after an abrupt kill,
verify its recorded process is gone before manually removing a stale lock.
Resume parameters must match `capture.json`. The assembled `fixture.json` and
scale-compatible `oracle.json.gz` appear only after the full range validates.

Header reconstruction checks double-SHA256 against the captured listing hash,
header links, transaction count, transaction ordering, block membership and
agreement between the verbose endpoint's hex and decoded hex. Provider listing
sizes that differ from reconstructed raw byte length are recorded as observations.
The oracle derives size from actual transaction hex and transparent counts from
captured decoder arrays. The raw payload and decoder share one provider. These
checks do not independently compute v5 transaction IDs, validate consensus, prove
a live full-node connection, or establish modern-tip follow behavior.

To expose a completed capture as a local historical replay, create an
operator-owned control JSON such as `{"height":1687106,"online":true}` and run:

```powershell
python benchmarks/prep/full/modern_dataset.py serve --directory .deploy-local/modern256 --control .deploy-local/modern256-control.json --port 18232
```

The replay server binds loopback, whitelists `getblockchaininfo`, `getblockhash`
and `getblock` (verbosity 0, 1 or 2), and reads the control file on every request.
Changing `height` publishes a bounded captured prefix; requests above it fail.
Only the immediate predecessor hash is available before the first captured block.
Setting `online` to false returns HTTP 503 for an outage experiment. A hash index
is built once at startup; block retrieval reads only the requested block, avoiding
a full-dataset scan per RPC. Restart the server if additional captured block files
are added after startup. This is a synthetic historical replay source whose head
is controlled by the experiment operator.
