# prep-store

Immutable bounded historical segments and an atomically published archive
catalog for Zeer Prep. Payload kinds are `compact-v1` (`CompactBlock`) and
`full-v1` (`prep.FullBlock`, raw block plus decoded JSON). No wallet, viewing key,
network follower, database engine, or consensus validation is implemented here.

## API

```rust,ignore
use prep_store::{BlockRecord, Store, StoreWriter};

// Parent directory already exists; output itself must not exist at all.
let mut writer = StoreWriter::create(
    output, "mainnet", start, end, &predecessor_rpc_hex, &end_rpc_hex,
)?;
writer.push(BlockRecord {
    height: compact.height,
    hash: compact.hash.clone(),       // protocol byte order
    prev_hash: compact.prev_hash.clone(),
    payload: encoded_compact_block,
})?;
// More records, exactly one per height, in order.
let manifest = writer.finish()?;

let store = Store::open(output)?;
for result in store.read_range(start, end)? {
    let record = result?;
    // Forward record.payload; the iterator does not collect the entire range.
}
```

`Store::read_block(height)` returns one `BlockRecord`. `Store` clones share an
immutable manifest, while each range opens an independent file descriptor and
seek cursor. Errors stop a range iterator. Caller cancellation drops its handle.

`Store::read_header(height)` returns `BlockHeader {height, hash, prev_hash, time}`.
New full segments index `BlockIndex.time` alongside existing identity metadata;
opening the store verifies that timestamp against the decoded payload. Header
reads then use that verified immutable cache, avoiding payload disk reads, full
protobuf decoding and JSON validation. Older full segments without indexed time
and compact segments use the checked payload path as a compatible fallback.
Absent times are omitted from JSON; existing compact serialization and existing
segment bytes/checksums are unchanged. New full manifests include the added index
field, so their manifest digest changes, while the dataset ID still binds the
same payload bytes and anchors. Never rewrite an old benchmark archive to add it.
`block_hash(height)` similarly returns the cached RPC-display-order hash without
payload I/O. These metadata fast paths share the admitted local-immutability
trust rule; raw/payload requests still verify the underlying bytes on every read.

`Archive::read_header` and `Archive::block_hash` route through the sorted segment
index with binary search, retaining the caller's pinned catalog revision.

`StoreWriter::create_full` and `create_full_with_limits` select `full-v1`.
`Store::open` selects the default payload bound after reading the bounded
manifest: 4 MiB compact or 64 MiB full. `open_with_limits` instead honors explicit
lower caller limits. Full validation requires matching decoded envelope metadata,
nonempty raw block data, and valid JSON with an object at its root. It validates
JSON without constructing a second complete JSON value tree. Independent block
header/transaction verification belongs to the source importer.

`StoreLimits` can lower the accepted block, segment, manifest, record-count and
range-count ceilings. Defaults are 4 MiB compact / 64 MiB full per payload, 256 MiB per segment
(including four-byte record prefixes), 100,000 stored blocks, 64 MiB manifest,
and 10,000 blocks per requested range. Larger-than-hard-limit settings are
rejected. Stored and requested heights must also fit Zcash's u32 height space;
u64 API parameters do not permit values above `u32::MAX`. These bounds constrain
serialized input and record count; they do not equate
protobuf-decoded memory with encoded byte count. Serving must also bound
concurrent readers and downstream buffering.

## Format and durability

- `segment.bin`: repeated little-endian u32 payload length followed by exact
  encoded protobuf bytes; no payload re-encoding.
- `manifest.json`: version, network, inclusive range, predecessor/end anchors,
  dataset identity, segment length/checksum, ordered offsets and block checksums.
- `manifest.pending`: staging metadata; ignored by readers and removed after
  publication. Its existence alone never indicates a valid snapshot.

Anchors and manifest hashes use lowercase conventional RPC display order.
`BlockRecord` hashes remain raw protocol order. Dataset identity is SHA-256 of a
versioned JSON tuple containing network, bounds, predecessor, end hash and segment
checksum; it therefore distinguishes networks and frozen provenance boundaries.
The importer must independently validate that source/network association and
check its source anchors before and after acquisition.

Compact manifests default an absent `payload_kind` to `compact-v1` and omit
that default on serialization, preserving the original compact dataset identity.
Full manifests explicitly contain `payload_kind="full-v1"` and use a separate
dataset-identity domain marker. The two payload kinds cannot share one archive.

Creation is supported on Unix only in this slice. The writer exclusively creates
the output directory and never resumes an existing one. Any push failure poisons
the writer. Finish requires the exact count and end anchor, fsyncs segment and
staged manifest contents, then publishes metadata with an atomic no-clobber hard
link and fsyncs the containing directory. It uses a local filesystem supporting
these operations; unsupported filesystem behavior returns an error. Neither
existing final metadata nor a prior interrupted directory is overwritten.

A `finish()` error after the hard link was created can leave a published,
fully written manifest: directory fsync or pending-file cleanup may have failed.
Treat that outcome as ambiguous, inspect the existing output, and do not blindly
retry or delete it. `Store::open` can verify the existing bytes and chain but does
not retroactively prove that a failed directory fsync was durable across power
loss. Only a successful `finish()` confirms completion of the publication steps.

An interrupted store may leave `segment.bin` and/or `manifest.pending`; without
the published manifest it cannot be opened. Operator cleanup or a fresh output
path is required. Parent directories are not created implicitly. A successful
open checks bounded metadata, every segment offset/length, both checksum layers,
decoded block metadata, height continuity, parent links and frozen end anchor.
Later reads recheck their payload checksums and decoded metadata.

These integrity checks are not a proof that source compact blocks are complete,
consensus-valid, or on the independently observed canonical network. They also
do not replace filesystem ownership and access controls against hostile local
writers.

## Multi-segment archive

```rust,ignore
use prep_store::{Archive, ArchiveWriter, FULL_KIND};

let mut writer = ArchiveWriter::create_or_open_with_kind(
    archive_root, "mainnet", 1, FULL_KIND,
)?;
// Build a complete immutable StoreWriter segment first at the following path.
// Each segment name is unique; an aborted segment remains an unreferenced orphan.
writer.append_segment("segments/part_0001")?;
let pinned = writer.snapshot();
let actual_remaining_head = writer.rollback_to(common_ancestor_height)?;
let refreshed = pinned.refresh()?;
```

`create_or_open` defaults to compact payloads. The archive start is explicitly
in `1..=u32::MAX`; it can be empty, with `head()` and `head_hash()` returning
`None`. Existing archive identity must match network, start and payload kind.
The root parent must exist; the writer creates the root and `segments/` itself.
It holds an exclusive `File::try_lock()` on the persistent `archive.lock` file
for its lifetime. Other cooperating writers cannot publish concurrently.

Catalog references name only `segments/<name>`, with ASCII letters, digits,
dashes or underscores and at most 128 characters in the name. Traversal,
absolute paths, nested paths, symlink roots and symlink segment directories are
rejected. Each reference binds the segment's dataset ID, exact manifest-byte
checksum, range and anchors. A catalog is limited to 10,000 segments / 16 MiB.
Segments must have one network and payload kind, contiguous heights, and matching
boundary links. Append independently opens/verifies the new segment before
publishing its reference.

`catalog.json` is serialized to `catalog.pending`, file-synced, atomically
renamed over the old catalog, and followed by directory fsync. The exclusive
writer lock serializes replacement. After a publication I/O failure the writer
is poisoned because rename may already have happened; reopen and inspect the
catalog. A subsequent authorized writer may discard only the regular stale
`catalog.pending` staging file. Immutable segment files are never automatically
deleted, including failed imports and segments removed from the active catalog.
The caller must account for all retained data when enforcing disk capacity.

Catalog `revision` increases on append and rollback. `epoch` stays stable during
append and increases when rollback removes references; consumers must invalidate
epoch-bound cursors. `rollback_to(height)` removes any segment ending above the
target, including the whole overlapping segment, and returns the actual new
head. Rolling back to `start_height - 1` makes the archive empty. A no-op rollback
does not alter counters. `invalidate_epoch()` explicitly invalidates cursors
after an external reorg decision without changing references; source-health and
deep-reorg policy remain outside the store.

Readers hold consistent cloned catalog snapshots. `Archive::read_range` yields
lazily across segment boundaries with independently opened file descriptors and
a maximum of 10,000 requested blocks. Old snapshots remain readable after append
or rollback because segment files are retained. `refresh()` checks the catalog
checksum/counters and independently verifies newly referenced segments; unchanged
references reuse already verified `Store` objects keyed by the complete reference,
including manifest checksum. An unchanged catalog returns a cheap clone.
Within the same epoch, a newer catalog must preserve the prior segment references
as an exact prefix; a checksum-valid truncation or replacement without an epoch
change is rejected. This protects pinned readers from inconsistent external
catalog replacement or restore during a running process.

Cache reuse relies on the archive ownership rule that admitted segment metadata
is immutable; it does not rehash every old payload on every poll. Individual
payload reads still verify checksums and envelope metadata. A fresh `Archive::open`
forces full segment verification. No claim is made that these checks defeat a
hostile local filesystem owner who rewrites both data and all integrity metadata.

## Verification

On the supported Unix target:

```text
cargo test -p prep-store
```

Tests use synthetic protobuf blocks and cover publication/reopen, independent
range cursors, containment/limits, incomplete writers, non-overwrite, gaps,
duplicates, parent/tip mismatch, malformed metadata, corruption, truncation and
post-open tampering, full-payload admission, legacy compact identities, catalog
publication, writer exclusion, restart, cross-segment reads, rollback epochs,
retained reader snapshots, corrupt catalogs and unsafe paths. A passing test does
not constitute a live upstream import or power-loss durability experiment.
