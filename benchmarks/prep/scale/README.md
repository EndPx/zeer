# Immutable full-data Prep scale rehearsal

Measure the admitted 2,048-block baseline, then independent 8,192- and 32,768-block
archives only after a compatible full-node source and disk budget cover each tier.
Use real complete blocks, fixed inclusive bounds, the same segment-block setting,
and an independent node-derived oracle for each tier. Do not pad the archive with
copies of a block or treat compact data as complete blocks. The source operator
owns preparation, source health and coverage; this harness never contacts a node,
ingests data or changes a branch. A tier's files must remain immutable throughout.

The first tier can use the committed
`benchmarks/fixtures/mainnet-public-2048/oracle.json.gz`. Larger oracles use that
same format: `range: {from, to}`, `source` with recorded head identity, `blocks`
with `id`, `hash`, `time`, `transactionCount`, and `transactions` with `id` (txid),
`minedHeight`, `version`, `locktime`, `sizeBytes`, `transparentInputCount`,
`transparentOutputCount`. Preserve canonical block transaction insertion order;
the harness reconstructs positions and verifies each block's transaction count.
Capture these facts through the full-node RPC separately from Prep output.
An oracle is chain input, not a benchmark result. Generated oracles/results stay
in the experiment's local result area unless deliberately curated as fixtures.

`capture.py` provides that independent read-only capture from a private frozen
mainnet node. It uses the shared private-endpoint guard: only private/loopback
addresses, no URL credentials or redirects, at most 32 MiB per RPC response and
20 seconds per request. Supply the externally recorded source height/hash:

```sh
python -m unittest benchmarks.prep.scale.test_capture
python -m benchmarks.prep.scale.capture \
  --source http://PRIVATE_NODE_IP:18232 \
  --expected-head 32768 \
  --expected-hash 0000000070440137775babd0255c51c9a41a247721643a225b41c394ea193741 \
  --end 2048 --out "$PWD/benchmarks/results/capture-2048/oracle.json.gz"
```

Repeat with a new output and `--end 8192` or `--end 32768` only within admitted
source coverage and the resource envelope. The capture checks mainnet/genesis and
the pinned source head before/after collecting every block; verifies reported
height/hash/parent links, unsigned integer metadata, raw transaction hex/size,
and input/output array counts; and preserves node transaction order. It caps the
capture at 32,768 blocks and 500,000 transactions. Requests are sequential. These
are upstream-reported public facts and linkage checks, not SPV/consensus validation.

Rows spool incrementally to a new sibling staging directory. Gzip is assembled
from those rows without a complete result JSON allocation and published with a
same-filesystem no-clobber link only after successful capture/pin validation.
An existing output is never overwritten. Successful and failed staging directories
retain counts, input identity, source-code hash and completion/failure evidence
under ignored results. Gzip uses a fixed timestamp; compare normalized projection
content when checking another producer rather than assuming identical gzip bytes.

## What startup and memory mean

Fresh `Archive::open` validates every referenced manifest and every block payload,
hashes the complete segment bytes, decodes integrity metadata, and builds optional
transaction metadata indexes. No persistent transaction index is loaded from disk.
An unchanged `refresh()` reuses the admitted immutable stores, which differs from
fresh-process startup. The server binds only after fresh admission succeeds.

The harness's `start_to_ready_ns` begins immediately before `docker start` and ends
at the first verified authenticated ready metadata response. It includes container
launch, Docker inspection, polling and the metadata response. `docker_start_ns`
records the launch-call boundary separately. Neither value is pure index-building
time. The Rust diagnostic below measures `Archive::open` directly in another
process and counts metadata after stopping that admission timer.

Index allocation has a 16 MiB per-segment ceiling and a 64 MiB archive ceiling.
An unsupported or over-budget segment discards its optional partial transaction
index and retains the verified payload read path. An unindexed segment overlapping
a transaction-ID range forces fallback for that range. These ceilings describe
the retained optional index's allocations, not total process RSS: manifests,
per-block vectors, decoded temporaries, request output and allocator overhead also
consume memory. The cgroup additionally accounts file cache.

Build the read-only diagnostic alongside the measured server binary:

```sh
cargo build --release --locked -p prep-store --example archive_profile -j 2
cargo build --release --locked -p prep -j 2
```

`target/release/examples/archive_profile ARCHIVE` reports admission elapsed,
Linux RSS/peak RSS after admission, allocated index bytes, indexed/fallback block
counts, and indexed transaction count. It does not decode fallback payloads a
second time, bypass integrity checks, or modify the archive. Zero fallback at a
small tier does not prove the 64 MiB behavior under higher transaction density.
Fallback may also arise from unsupported metadata or the per-segment limit;
its occurrence alone does not identify which cause applies.

## Run within the experiment envelope

Use Linux x86_64 with Docker and cgroup v2. Run one tier at a time with no other
experiment backend running. Verify existing application health before and after
the session using the operator's service list. Stop the source follower before
measurement; retained application services remain untouched.

The harness requires its controller/client cgroup to have at most 1 CPU / 1 GiB
and zero swap, and verifies the queried container's actual 1 CPU / 2 GiB quotas.
It checks at least 3 GiB host memory available and 2 GiB disk free. These thresholds
are run admission checks, not reserved resources or full host-health certification.
The operator must enforce the overall existing 3 CPU / 8 GiB / 40 GiB experiment
ceiling, including prepared node state, build resources and retained archives.
Build and ingestion occur separately from measured reads.

From the source root, with absolute paths set to the frozen archive, independently
captured oracle and built binaries:

```sh
python -m unittest benchmarks.prep.scale.test_run
systemd-run --wait --pipe --collect \
  --property=CPUQuota=100% --property=MemoryMax=1G --property=MemorySwapMax=0 \
  --working-directory="$PWD" \
  python -m benchmarks.prep.scale.run \
  --archive "$archive" --oracle "$oracle" --binary "$prep_binary" \
  --profile-binary "$profile_binary" \
  --runtime-image 'rust@sha256:2c3a22f0a5533ea2dd5a16627bc841228151faa2d4de2644ac9987e4a2f1f2fa' \
  --name zeer-scale-tier2048-run1 \
  --out "$PWD/benchmarks/results/scale-tier2048-run1" --rounds 3
```

The runtime image must already be available and pinned by digest. The new output
directory and Docker name prefix must not already exist. Only newly created
containers are stopped; containers/network remain retained for diagnosis. Failures
and cleanup errors yield a failed record and nonzero exit. Do not globally prune
Docker or reset the host's filesystem cache.

If Docker's default address pool is exhausted by retained experiment networks,
inspect `ip -4 route` and `docker network inspect` before choosing an unused private
subnet. Pass, for example, `--subnet 10.250.64.0/24`. The option accepts canonical
RFC1918 IPv4 networks with /24 through /28 prefixes; it leaves Docker's defaults
unchanged when omitted. Docker checks overlap with its existing networks and must
reject conflicting requests. The operator must also check host/VPN routes: this
option does not certify route safety or change Docker's global address pools.
Use distinct inspected subnets for concurrently retained tier/source networks.

Every round starts a new process, observes admission resources, then executes
ordered full-tier header and eight-field transaction metadata queries. Three
1,000-block windows cover the beginning, middle and end; each uses up to 128 fixed
existing transaction IDs through both sparse `/query` and `/transactions` routes.
Window queries respect API range limits; the full-tier query uses bounded windows
and page cursors. Workload order rotates between rounds. Each workload has a
verified warmup followed by one timed read. Equality with the independent oracle
and result hashing happen outside query timing; HTTP setup, transfer and JSON decode
remain inside it. Body-byte counts exclude HTTP headers.

Filesystem cache is uncontrolled. Admission itself reads the entire archive, so
post-admission query tests run against recently accessed payloads. No cold-cache
claim is permitted. The optional Rust diagnostic runs in a separate process after
the measured visits; its file cache has been warmed by those visits. The final
out-of-timer archive check verifies full segment checksums and unchanged catalog,
manifests and file sizes. The initial manifest/size inventory avoids a separate
payload pre-read before the first startup.

Outputs retain binary/oracle/harness hashes, catalog and segment identities,
logical/allocated disk size, per-round startup boundaries, actual cgroup limits,
RSS, file/anonymous memory, CPU/throttle/IO counters, query timing/bytes/digests,
optional index diagnostics, and failures. Source preparation and ingestion time
are outside this harness; record them separately if evaluating those phases.

## Decide from evidence

Compare startup and query workloads separately across tiers, including transaction
count, bytes and segment count rather than block count alone. Do not extrapolate
these early-mainnet tiers to modern shielded traffic or an unrun whole-chain archive.
If admission grows with payload bytes while index allocation remains small, a
persisted index alone will not eliminate mandatory integrity checks. If fallback
causes a reproducible sparse-read discontinuity, quantify the indexed/fallback
regions and input density before designing a disk-backed index. Keep archive
identity binding, atomic publication and reorg invalidation in that later design.
No persistent-index implementation is selected by this rehearsal.

## Paired optional-index construction diagnostic

`index_cost.py` compares the ordinary `archive_profile` executable with a
counterfactual executable built in a disposable measurement source clone. The
operator records the clone's exact diff: only its private `ARCHIVE_INDEX_BYTES`
constant changes to zero. Retain the source identity, one-line diff, build output
and binary hashes locally. Do not modify the release engine or remove integrity
checks. The harness itself neither edits nor builds the engine.

Run against the same frozen 32,768-block archive in the bounded controller cgroup:

```sh
python -m unittest benchmarks.prep.scale.test_index_cost
python -m benchmarks.prep.scale.index_cost \
  --archive "$archive" --baseline-binary "$profile_binary" \
  --zero-index-binary "$zero_index_profile_binary" \
  --runtime-image 'rust@sha256:2c3a22f0a5533ea2dd5a16627bc841228151faa2d4de2644ac9987e4a2f1f2fa' \
  --name zeer-index-cost-run1 \
  --out "$PWD/benchmarks/results/index-cost-run1"
```

Three fresh-container pairs alternate normal/zero, zero/normal, normal/zero.
Containers have no network, use 1 CPU / 2 GiB / zero swap, and mount only the
supplied executable and immutable archive read-only. Each must identify the same
catalog range/head/epoch/revision. The normal build must index all blocks, while
the zero-budget build must report no allocated index bytes and fallback for every
block. The diagnostic's literal 64 MiB reference-cap field remains present even
in the measurement clone; the report separately records the expected build budgets
and verifies their allocation/fallback outcomes.

Output retains raw per-process admission time and RSS, paired deltas, lifecycle
timestamps/exit/OOM state, and the last live cgroup CPU/memory/IO sample when the
process lived long enough to sample. That sample may precede exit and must not be
presented as complete CPU/IO accounting. Metadata counting occurs after the
admission timer; Docker lifecycle time additionally includes launch/polling/exit.
Final segment checksums and unchanged catalog/manifests are verified outside timing.
Failures and owned cleanup errors are retained and return nonzero; evidence stays
under ignored results. No network, global Docker setting or existing service is
changed.

Both processes still validate every payload. A positive paired delta estimates
optional construction cost in this measured setup; cache pressure and three-pair
variation prevent treating it as an unconditional persisted-index speed bound.
