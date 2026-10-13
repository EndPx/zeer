# prep-store

Immutable bounded historical `CompactBlock` snapshots for the first Zeer Prep
slice. No wallet, viewing key, live follower, database engine, or consensus
validation is implemented here.

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

`StoreLimits` can lower the accepted block, segment, manifest, record-count and
range-count ceilings. Defaults are 4 MiB per payload, 256 MiB per segment
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

## Verification

On the supported Unix target:

```text
cargo test -p prep-store
```

Tests use synthetic protobuf blocks and cover publication/reopen, independent
range cursors, containment/limits, incomplete writers, non-overwrite, gaps,
duplicates, parent/tip mismatch, malformed metadata, corruption, truncation and
post-open tampering. A passing test does not constitute a live upstream import
or power-loss durability experiment.
