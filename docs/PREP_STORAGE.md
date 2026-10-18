# Full-archive storage and recovery

Public responses continue to use the `full-v1` payload contract. Disk snapshot
versions are a separate concern: readers accept original version-1 records,
version-2 zstd records, and version-3 zstd records with optional raw-byte references.
Older server binaries must not be used to read newer disk formats.

## Lossless compressed records

Start a full-node import with `--from 0 --compress` to include genesis and use
the new encoding. Completed segments remain immutable and atomically published.
Complete serialized blocks and decoded transaction objects remain available.

Where canonical decoded JSON contains lowercase hex strings already present in
the raw block, the encoder may store a bounded JSON-pointer/offset reference.
Reconstruction restores the original string, then verifies the original payload
length and SHA-256. The encoder checks protobuf and JSON round-trip identity
before applying this optimization. Noncanonical representations, unknown
protobuf fields, unmatched strings and oversized candidates retain their exact
bytes through ordinary compression instead.

References do not interpret transactions, decrypt ciphertext or change values.
Metadata size, reference count, pointer length, source offsets and total restored
size are bounded. Malformed or duplicate references fail instead of returning
partial data. Public numeric conversion rules remain unchanged.

Archive readers retain binary hashes rather than three allocated hex strings
per block. Admission bounds this header index to 640 MiB before loading segments;
this is not a bound on total process RSS. Optional transaction-index memory,
payload buffers and request concurrency have their own limits. Follower segment
buffering is bounded to one full-record ceiling plus framing overhead.

## Convert an existing archive

Stop its writer first; readers may keep serving its immutable prefix. Use a new
output directory outside the source and reserve enough disk for both copies:

```sh
prep archive-repack --archive /data/original --out /data/compressed --max-disk-gib 5
```

The command locks the original writer, preserves source catalog/provenance and
compressed copies of original manifests, and compares every logical record
after reopening the destination. A successful run writes `repack-proof.json`.
It does not replace or remove the original archive or switch a running API.

After interruption, resume the same unpublished output explicitly:

```sh
prep archive-repack --archive /data/original --out /data/compressed --max-disk-gib 5 --resume
```

Resume verifies the frozen source identity and existing destination prefix.
It preserves published segments, replaces only its own unpublished generated
segment, and recomputes the complete logical comparison. A changed source,
unsafe orphan path, exhausted budget or completed output is rejected.

Before cutover, require successful completion, inspect the destination and
verify application reads against the original/source. Stop dependent followers
before changing the Prep endpoint's archive to avoid a snapshot-transition race.
The new archive epoch invalidates old pagination cursors; clients restart their
query when they receive `REORG`. Restart ingestion with the intended network,
start height, confirmation policy, disk cap and `--compress`.

Reclaim the original only after verification and an explicit recovery decision.
An incomplete conversion is never evidence of a complete or live archive.
