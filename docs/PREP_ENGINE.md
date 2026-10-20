# Zeer Prep engine

Updated 2026-10-19. The user requires complete blocks and transactions for the
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
- Appending preserves the epoch. Removing history increments the epoch and
  invalidates old cursors. Readers retain a coherent catalog snapshot.
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
  remains not ready while failures are being retried.
- Only HTTP 429/5xx, request timeouts and recognized interrupted/refused network
  I/O acquire the typed retry marker. Authentication, malformed responses,
  integrity/network mismatch, disk errors, deep reorgs and the overall sync-step
  deadline remain terminal. Historical mode does not retry. Initialization
  errors and source IP changes are not recovered; private HTTP DNS answers are
  pinned for the process lifetime. Ctrl-C interrupts polling and backoff.
- Post-publication filesystem errors can have an ambiguous outcome. Inspect
  the existing catalog/snapshot before retrying; never assume it is absent.

## Query and client

`GET /height`, `/health`, `/ready`, and `POST /query` serve the full archive.
Queries support a bounded scanned-block limit, field selection, transaction IDs,
versions, public Sapling/Orchard activity flags, and transparent output addresses.
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

The published `@zeer-dev/prep-client` exposes `getHeight()`, `get()`, and finite
`stream()` with cancellation, deadlines, bounds and explicit reorg errors. It
uses native fetch rather than a Rust native addon. HTTP/binary, Arrow, Parquet,
SSE, automatic client rollback and npm publication are not implemented.

## Limits and deployment

- Linux/Unix writes; tested Linux x86_64 with Rust 1.99.0 and Cargo.lock.
- Consensus raw block <=2,000,000 bytes; RPC JSON <=32 MiB; full envelope <=64 MiB;
  compact payload <=4 MiB. Oversized data is rejected rather than omitted.
- Segment <=256 MiB; follower buffers at most 64 MiB plus framing of encoded records with metadata
  reserve; configurable disk allowance counts old/incomplete files too.
- At most 10,000 referenced segments; configured segment range 1..1000 blocks;
  archive may begin at height 0, including genesis. No entire-mainnet archive was deployed.
- Query <=1000 scanned blocks and 32 MiB serialized response; 2 active queries.
  These are serialization/concurrency bounds, not a 32 MiB peak-memory claim.
- Source HTTPS verifies certificates. Source Basic credentials come only from
  PREP_SOURCE_USER/PREP_SOURCE_PASSWORD. Plaintext non-loopback sources require
  explicit opt-in and private/local addresses.
- HTTP defaults to loopback. Non-loopback serving requires explicit opt-in plus
  PREP_API_TOKEN with at least 16 bytes. Use a TLS proxy for network deployments;
  the private prototype is not an audited public service.
- Current shared-VPS operations stay within 3 aggregate CPU / 8 GiB / 60 GiB, without paid
  upgrades or changes to existing applications.

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

## Evidence and remaining limits

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

Execution records and benchmark comparisons are local-only under
`benchmarks/results/`. See the [harness](../benchmarks/README.md) for reproduction
and the committed public fixtures for deterministic regression inputs.

Large-scale public operation, millions-of-block latency, complete network
upgrade interoperability and modern full shielded-payload production workloads
remain unproven. No universal HyperSync parity or speedup is claimed.
