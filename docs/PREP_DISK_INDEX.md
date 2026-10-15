# Optional disk metadata index

Prep can store the public transaction projection beside each immutable `full-v1`
segment. This reduces retained transaction-row memory when a dataset exceeds the
optional RAM index budget. It does not decrypt shielded data or bypass archive
integrity verification.

On a Unix host, stop the archive writer, then run:

```sh
prep archive-index-build --archive /path/to/archive --max-disk-gib 4
```

The command acquires the archive writer lock and never overwrites a published
sidecar. Restart readers after successful completion. An unchanged catalog refresh
keeps its already admitted snapshot; it does not discover newly built sidecars.
New appended segments continue to work without sidecars through the existing RAM
index or checked payload path. Building their sidecars is another explicit offline
operation.

## Integrity and publication

Each `segments/<segment>/transactions-v1.bin` contains a 40-byte version/manifest
header and 66-byte public metadata rows. During fresh admission Prep still reads
and checks the full source segment, then compares every indexed row with metadata
derived from that source. It retains a source-verified digest and location for each
block. Each later index read checks the regular file, length, header and actual
block bytes against that trusted digest. A checksum supplied by the file itself
is not the trust anchor.

Missing or rejected sidecars fall back to the existing data path. Corruption after
admission disables that shared disk index; future reads use checked source payloads.
Repairing the file does not re-enable a disabled snapshot: reopen the archive.
Source corruption continues to fail the ordinary integrity checks.

The builder writes an exclusive `transactions-v1.pending`, syncs it, publishes
with a no-clobber hard link and syncs the directory. Atomicity is per segment.
Earlier completed segments remain valid if a later build fails. Pending files are
retained for operator inspection and block another build; there is no automatic
cleanup or repair. After a crash, stop the writer, inspect the pending/published
files and preserve any needed evidence before removing only the identified pending
artifact and retrying. A corrupt published sidecar requires explicit operator
replacement; the builder refuses to overwrite it.

## Resource limits and tradeoffs

- The CLI accepts 1–8 GiB, default 4 GiB, for aggregate sidecar bytes. The library
  accepts byte-granular positive limits up to 8 GiB.
- Inventory includes published sidecars in retained/orphan segment directories,
  including those left by rollback. Any pending file aborts before new writes.
  This cap covers sidecars, not the original archive, filesystem allocation
  overhead or unrelated files. Inventory is bounded to 100,000 directories.
- Each segment sidecar is capped at 512 MiB. On a partial failure, written pending
  bytes stay within the remaining budget.
- Per-block descriptors and paths still count against 16 MiB per segment and
  64 MiB per archive of optional index memory. These limits are unchanged and do
  not bound total process RSS, manifests or transient query allocations.
- Admitted disk indexes retain no file handles. A process-wide maximum of 128
  transient index handles covers admission and reads. Temporary exhaustion falls
  back without permanently disabling a good index.
- Reads allocate metadata for one requested block. Exact-ID disk filtering scans
  block metadata with the caller's cancellation checks between blocks; this format
  has no sorted secondary disk index. A small archive's RAM index may be faster.
- Startup still verifies payloads and source metadata. Persisting metadata is not
  a shortcut around startup verification, nor a promise of faster admission.

Opt-in admission profiles report each segment's `index_kind` as `memory`, `disk`
or `payload`, retained index bytes, and the `optional_disk_verify` phase. Use the
same dataset, resource limits and exact output checks when comparing variants.
Benchmark reports remain local under `benchmarks/results/`.
