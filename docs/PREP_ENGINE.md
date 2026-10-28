# Zeer Prep engine

Updated 2026-10-27. The user requires complete blocks and transactions for the
28 October delivery. [Delivery contract](PREP_DELIVERY.md) owns the active scope;
[query contract](PREP_QUERY.md) owns the HTTP and SDK semantics. Chef's public-data
pipeline is implemented; optional private scanning is a separate
[Chef receipt profile](SHIELDED_RECEIPTS.md), not a public Prep capability.

## Implemented data paths

```text
Zebra-compatible full-node JSON-RPC
    -> Rust full-block source + follower
    -> immutable segments + atomic archive catalog
    -> HTTP range/filter/field-selection API
    -> typed native-fetch client or another application
```

The earlier compact-block workflow remains separate: lightwalletd-compatible
source -> one compact snapshot -> native gRPC range service. Full archives are
not mislabeled as compact snapshots and cannot be served by that legacy API.

## Full data and source validation

The source reads `getblockchaininfo`, `getblockhash`, and `getblock` verbosity 0
and 2. It stores the complete serialized block and node-decoded JSON, including
all transaction objects and their raw hex. Unknown decoded source fields are
retained. Shielded ciphertext remains ciphertext; no viewing or spending keys,
private memo reading, transaction signing or broadcast are implemented.

Use `--from 0` for complete-history backfill, including genesis. Genesis requires
a zero predecessor and does not issue a negative-height RPC. The optional
`--compress` mode changes disk encoding, not API payloads. Version-3 records
can reference duplicated canonical JSON hex strings from their raw block bytes;
the exact original protobuf payload is restored and checksum-verified on read.
See [storage limits and conversion](PREP_STORAGE.md).

The importer checks SHA256d of the serialized header, parent/time agreement,
canonical CompactSize counts, and exact concatenation of every returned raw
transaction into the full block. It rechecks source network and range anchors
before publication. The full node remains the consensus authority; Prep does
not independently verify proofs, scripts, Merkle roots or modern transaction
IDs. Decoded values such as confirmations describe the time of capture.

Raw and decoded RPC requests for one resolved block hash run concurrently.
Either request failure cancels its unfinished companion. Each retains its own
response-size and timeout limits; the follower still processes one block at a
time. Two responses may now be in memory together, so this is bounded overlap,
not an unbounded block prefetch queue.

Zebra 6.2.3 can label Regtest as `test`; the adapter disambiguates only by the
known Regtest genesis hash. A failed genesis lookup fails closed rather than
choosing a network by difficulty or activation schedule.

## Archive, restart and follow

- Segment payload kinds are `full-v1` and legacy `compact-v1`; one archive never
  mixes them. Full payloads use the original `FullBlock` protobuf envelope.
- A process holds an exclusive archive-writer lock and reuses its verified
  segment metadata plus HTTP connection pool across sync steps.
- A completed segment is admitted through an atomic catalog revision. The
  catalog advances only after complete records, hashes and source anchors pass.
- Restart resumes from the last committed segment. Incomplete/orphan segments
  are ignored by readers but retained and counted against disk capacity.
- Appending preserves the epoch. Removing history or explicitly invalidating
  physical layout through lossless consolidation advances epoch and invalidates
  old cursors. A layout epoch is not proof of a chain fork. Readers retain a
  coherent catalog snapshot.
- Reorg recovery checks the existing head and searches a bounded predecessor
  window. It removes catalog references to whole overlapping segments before
  rebuilding. Excessive reorg depth marks the source not ready and stops sync.
- Validated historical data remains readable during ordinary append. Catalog
  and source-status mismatch temporarily fails closed during publication.
- Follow mode polls the source and exposes observed source height, indexed
  height and lag. A source observation is not proof that the source is at the
  public network tip. Historical mode remains readable after sync exits;
  following-mode status expires after 120 seconds without an update.
- Follow mode retries classified temporary source failures using the same
  session and writer lock. `--max-source-retries` defaults to 8 additional
  attempts (maximum 20); delays are 1, 2, 4, 8, 16, then 30 seconds, capped at
  30 seconds. A successful step resets the consecutive-failure budget. Status
  remains not ready while failures during an admitted session are being retried.
- Only HTTP 429/5xx, request timeouts and recognized interrupted/refused network
  I/O acquire the typed retry marker. Authentication, malformed responses,
  integrity/network mismatch, disk errors, deep reorgs and the overall sync-step
  deadline remain terminal. Historical mode does not retry. Temporary source
  preflight failures also use the bounded follow retry budget; archive admission
  errors and source IP changes are not recovered. Private HTTP DNS answers are
  pinned for the process lifetime. Ctrl-C interrupts polling and backoff.
- Post-publication filesystem errors can have an ambiguous outcome. Inspect
  the existing catalog/snapshot before retrying; never assume it is absent.

### Source preflight and process progress

Run `prep build-info` to inspect the running executable's embedded
`schemaVersion`, `packageName`, `packageVersion`, `buildCommit`, and `sourceState`.
The same `artifact` object is included in authenticated `/capabilities` responses.
No archive, source, token or viewing key is needed for the local command, and it
does not inspect Git at runtime. The commit/state are captured at build time
from verified tracked sources after discarding inherited `GIT_*` redirection.
Source copies without verifiable tracked package/Rust sources report `unknown`;
modified native build inputs report `modified` (Prep, its local Rust dependencies,
and workspace Cargo configuration). Unrelated website/media changes are outside
this dirty-state scope. Paths and build timestamps are omitted.
This metadata identifies an artifact's declared build source, not an attestation
of its publisher or deployment correctness; retain the binary checksum too.

`prep sync` checks authenticated `getblockchaininfo` and the requested network
before opening, validating or creating an archive. The complete preflight,
including client/DNS initialization, is bounded to the smaller of
`--deadline-seconds` and 30 seconds. HTTP 401/403 reports
`rpc_authentication_failed` and is terminal. A timeout reports
`source_preflight_timeout`; recognized temporary source failures retry only in
follow mode within `--max-source-retries`.

An unsuccessful preflight creates no archive directory, lock, catalog or status
file. It does not rewrite a previous status file. Monitor process health and
status age together: a previous status is not a new observation. Credentials
are read from the existing environment when constructing the client; Prep does
not reload a rotated cookie. Refresh the protected environment and restart the
follower after verifying the replacement credentials.

After preflight, the existing exclusive writer lock and complete integrity
admission still apply. The source height observed before admission is diagnostic;
the first sync step re-observes the source before reconciliation or publication.

The CLI retains completed `SyncProgress` JSON on stdout and emits structured
`prep_operation` JSON diagnostics on stderr. Phases are `checking_source`,
`opening_and_validating_archive`, `catching_up`, `waiting_source`,
`waiting_for_blocks`, and `ready`. The source and committed heights in these
events are the last known observations, not new RPC checks. No credentials,
endpoint, archive path, viewing key, memo or upstream error body enters them.

Every five seconds an independent diagnostic worker repeats the current phase
with `heartbeat: true`. This means the process is alive; it does not establish
that disk validation or indexing has advanced. `last_progress_at_unix` changes
on completed phase milestones or a new committed catalog revision, not on a
heartbeat or an unchanged poll. `committed_height` remains unknown until archive
admission succeeds and thereafter changes only from admitted/committed data.
An explicit empty catalog after rollback clears the previously observed head,
including when fetching its replacement later fails.

Diagnostics use a bounded eight-record queue and best-effort `try_send`. If
stderr is blocked or the queue is full, records can be dropped; a diagnostic sink
cannot delay archive work or shutdown. A single process-wide sink worker owns
only diagnostic records and is not joined during sync shutdown. This is a
progress aid, not an external watchdog or a durable event feed. Completed
`SyncProgress` stdout retains its existing output/backpressure behavior.

Archive admission remains synchronous and cannot be interrupted midway by the
async shutdown signal. Its heartbeat remains observable, and shutdown is handled
after the integrity pass returns; there is no detached admission worker that can
later acquire a writer lock after the caller has exited. These diagnostics do
not remove the cost of a cold archive restart or make the archive ready early.

## Query and client

`GET /height`, `/health`, `/ready`, `/capabilities`, `POST /query` and
`POST /transactions` describe or query the full archive. Optional `GET /mempool`
and `POST /transaction` use the configured live node observation path.
Queries support a bounded scanned-block limit, field selection, transaction IDs,
versions, public Sapling/Orchard/Ironwood activity flags, pool unions, coinbase
classification, and transparent output addresses.
They do not resolve transparent input ownership or search shielded recipients.

A cursor binds network, archive start, query, epoch and the captured terminal
hash. It survives ordinary append but rejects incompatible replacement history.
Nested numbers in decoded block/transaction fields and vin/vout are exact
strings; raw consensus bytes are available for independent decoding.

Header-only requests use verified cached height/hash/parent/time metadata.
Full/raw transaction requests still read payloads. The optional legacy full
manifest without indexed time falls back to checked payload reading.

Payload queries keep a sequential archive range reader for the page, reusing
the open segment file across adjacent blocks. Projection sizing uses a bounded
counting writer rather than allocating JSON buffers just to measure them.
Large decoded fields and raw hex are budgeted before their output copies are
created; a block that cannot fit is deferred to the next page or rejected with
HTTP 413 when it cannot fit in an empty page. The stored envelope and node JSON
are still decoded first; this does not establish a peak-memory cap equal to the
serialized response limit.

The published `@zeer-dev/prep-client@0.1.0` exposes `getHeight()`,
`getCapabilities()`, `get()`, finite `stream()`, bounded `getTransactions()`,
and optional live `getMempool()` / `getTransaction()` observations. Reads support
cancellation, deadlines, bounds and explicit source errors. The client uses
native fetch rather than a Rust native addon. Full-data binary, Arrow, Parquet,
SSE and automatic client rollback are not implemented. The separate compact
gRPC retrieval profile is described below.

## Limits and deployment

- Linux/Unix writes; tested Linux x86_64 with Rust 1.99.0 and Cargo.lock.
- Consensus raw block <=2,000,000 bytes; RPC JSON <=32 MiB; full envelope <=64 MiB;
  compact payload <=4 MiB. Oversized data is rejected rather than omitted.
- Segment <=256 MiB; follower buffers at most 64 MiB plus framing of encoded records with metadata
  reserve; configurable disk allowance counts old/incomplete files too.
- At most 30,000 referenced segments; configured segment range 1..1000 blocks;
  archive may begin at height 0, including genesis. No entire-mainnet archive was deployed.
- Fixed query pages scan at most 1,000 blocks, with a native serialized response
  ceiling of 32 MiB. Adaptive scans permit up to 1,000,000 blocks, a 500 ms soft
  work slice, a 512 KiB target and a 4 MiB hard response cap. The HTTP reader
  admits two active requests. These are response/concurrency bounds, not
  peak-memory guarantees. The [hosted ingress](PUBLIC_API.md) is stricter.
- Source HTTPS verifies certificates. Source Basic credentials come only from
  PREP_SOURCE_USER/PREP_SOURCE_PASSWORD. Plaintext non-loopback sources require
  explicit opt-in and private/local addresses.
- HTTP defaults to loopback. Non-loopback serving requires explicit opt-in plus
  PREP_API_TOKEN with at least 16 bytes. Use a TLS proxy for network deployments;
  the private prototype is not an audited public service.
- The shared-VPS deployment envelope is 3 aggregate CPU / 8 GiB / 64 GiB.
  The operator-approved archive allocation is 26 GiB, with at least 25 GiB of
  physical free disk retained. These deployment caps are not capacity guarantees.

## Commands

```sh
cargo test --workspace --locked
cargo build --release -p prep --locked

# Parent directory must exist; the archive is created or safely resumed.
target/release/prep sync --source http://127.0.0.1:18232 --network testnet \
  --archive ./data/testnet --from 0 --to 1023 --segment-blocks 128 --compress --allow-insecure

target/release/prep archive-inspect --archive ./data/testnet
target/release/prep serve-http --archive ./data/testnet

# Follow mode has no fixed --to. Use the archive's original --from when resuming.
target/release/prep sync --source http://127.0.0.1:18232 --network testnet \
  --archive ./data/testnet --from 0 --follow --confirmations 10 --compress --allow-insecure

node examples/prep-client/query.mjs
```

The internal CLI also retains `import`, `inspect`, and `serve` for compact
snapshots. Existing public compact APIs and full-node APIs are distinct sources.
The legacy `serve --dataset` gRPC listener explicitly enables `TCP_NODELAY` on each accepted
socket: Tonic's builder socket settings do not apply to its custom incoming
stream. Admission remains capped at four active streams with no waiting queue;
excess requests receive `RESOURCE_EXHAUSTED`. This transport setting does not
change the full-data HTTP API, snapshot limits, or integrity checks.

### Immutable compact archive retrieval

`compact-archive-append` registers checked compact segments in height order.
`serve-compact --archive PATH` serves that frozen archive using the lightwallet
protocol's `GetBlock`, `GetBlockRange`, `GetLatestBlock`, and `GetLightdInfo`
methods. The default projection is shielded-only; original transaction indices
and encrypted note fields are retained. `import --shielded-only` can apply the
same projection when capturing a segment.

This is a separate retrieval profile with a 100,000-block range limit, eight
active readers, 128 queued readers, and a 30-second queue timeout. It accepts at
most 128 connections, each with one concurrent HTTP/2 stream. Its bounded
internal batches still produce one compact block per wire message. Cancellation
releases read leases; interruption cannot turn a partial range into a successful
end of stream.

The reported tip is the archive tip. This profile does not follow a live node
or implement the rest of the wallet protocol, including tree state, transparent
address history, mempool, hash-only lookups, or explicit pool selection. Keep it
on loopback or a trusted private network. See the
[compact serving methodology](../benchmarks/prep/compact-serving/README.md) for
the fixed historical workload and comparison boundaries.

On Unix, full-archive refresh reuses a previously verified catalog while the
opened file's device, inode, length, modification time, and change time match.
Atomic replacement or an in-place change causes full catalog verification.
Other platforms retain full parsing. Directory/file checks, changed-catalog
validation, epoch checks, and writer validation still apply; a cache hit is not
permission to skip canonicality checks.

## Evidence and remaining limits

### Bounded catalog consolidation

Near the chain head, follow publishes a new block immediately rather than waiting
for `--segment-blocks` to fill. This can produce one immutable segment per block.
The hard limits remain **30,000 catalog references and 16 MiB of catalog JSON**.
Follow now consolidates one bounded historical group after publication when the
catalog reaches 16,384 references or 8 MiB. A full/near-byte-limit catalog is
checked before downloading and finalizing another segment.

A group contains at most 256 references and 1,000 blocks, outside the retained
reorg tail. Selection limits stored input to half the output budget. Output is
bounded to 64 MiB of segment data plus 8 MiB of manifest. Both disk reservations
and retained old files count against the configured archive budget. Full
record/header/hash/payload comparison and ordinary output admission precede an
atomic catalog replacement. Epoch/revision advances invalidate layout cursors;
they do not remove or rewind canonical blocks. New source status requires an
actual RPC observation and head-hash check after maintenance.

For an already exhausted catalog, stop its writer and run one bounded operator
job, using the **logical `catalog_sha256` field**, not the JSON file's byte hash:

```sh
prep archive-consolidate --archive /path/to/archive \
  --target-segments 10000 --max-groups 128 \
  --protected-tail-blocks 100 --max-disk-gib 24 \
  --max-segment-bytes 67108864 \
  --expected-catalog-sha256 CATALOG_FIELD_SHA256
```

This command locks and fully admits the existing archive once, verifies each
group, and reports all retired directories, exact logical digests and output
bytes. It does not create a new archive, change source readiness, access RPC or
delete any segment. Resume follow for a genuine fresh observation. Keep the old
catalog and all source/orphan files until their classification is complete.
Check `target_reached` and `stop_reason`: a bounded command can exit successfully
with partial progress when its group/disk budget or eligible input is exhausted.
Retired directories must remain while any admitted reader can lazily open them;
garbage collection requires a separate reader-quiescence procedure. This solves
catalog-entry growth within finite storage budgets, not unlimited retention.
The [27 October recovery report](PREP_CATALOG_INCIDENT_20261027.md) records the
actual 30,000-reference incident, unchanged payload proof and concurrent-read limits.

Retaining replaced files consumes real archive budget even after catalog reduction.
`archive_disk_budget_exhausted` can occur while the VPS still has free disk:
append requires another 268,435,456 bytes inside the configured archive budget.
Inventory active, retired, unpublished and temporary files before changing limits.
The [offline reclamation procedure](PREP_OFFLINE_GC.md) proves full-record equivalence
and requires all archive readers to stop before deleting redundant copies. It
does not change source status or consumer identity.

The optional `prep-store/admission-profile` feature provides diagnostic phase
timers and reduced-budget counterfactuals through dedicated examples. Ordinary
builds retain the original integrity checks and 64 MiB archive / 16 MiB segment
transaction-index caps, with no timers or budget override. Instrumentation itself
does not change storage; optional persisted metadata indexes are described in
[the disk-index contract](PREP_DISK_INDEX.md).
The [admission and cap-boundary harness](../benchmarks/prep/profile/README.md)
separates real archives from synthetic capacity fixtures and independently checks
stored-data projections across budgets. Build serving binaries without the
diagnostic feature; instrumented times are not uninstrumented service latency.

Raw execution records remain local under `benchmarks/results/`. Curated
measurements, provenance and comparison limits are public in the
[Prep benchmark chapter](https://zeer.endpx.cloud/docs/prep/benchmarks/) and its
downloadable artifacts. See the [harness](../benchmarks/README.md) for reproduction
and the committed public fixtures for deterministic regression inputs.

Large-scale public operation, live full-data performance across millions of
blocks, complete network-upgrade interoperability, and modern full
shielded-payload production workloads remain unproven. A frozen compact
retrieval measurement does not establish those properties. No universal
HyperSync parity or speedup is claimed.
