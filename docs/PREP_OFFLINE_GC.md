# Offline reclamation of redundant archive segments

Consolidation reduces catalog entries but retains replaced directories because
admitted readers can open those paths lazily. All retained bytes still count
toward `--max-disk-gib`. This procedure reclaims only unreferenced copies whose
**entire decoded BlockRecord values** match the active archive, including payload
bytes. A matching block hash alone is insufficient.

This is operator-coordinated offline maintenance, not online GC or a reader-lease
implementation. Every archive reader needs a maintenance window. Keep source URLs,
history, start height, consumer project/generation, anchor, schema and keys intact.

## Inventory and pin

Stop the writer. Record actual executable paths, SHA-256/build information,
catalog file SHA-256, height/hash/epoch/revision, physical space and archive budget.
Count regular-file lengths recursively, including retired, unpublished, temporary
and legacy files. Append requires **268,435,456 bytes** of reserve inside the
archive budget; free space on the VPS is a separate constraint.

| Classification | Action |
| --- | --- |
| Referenced by current catalog | Keep; never a GC candidate. |
| Known retired segment covered by current history | Candidate for full-record comparison. |
| Noncanonical branch or different capture payload | Keep and report. |
| Complete unpublished segment above the head | Keep; investigate failed append separately. |
| Incomplete output, extra files, symlink or unknown provenance | Keep and investigate. |

Save a plan outside the archive. `catalog_file_sha256` hashes the **file bytes**,
not the logical `catalog_sha256` field. List every candidate file with exact pins:

```json
{
  "catalog_file_sha256": "CATALOG_FILE_SHA256",
  "candidates": [{
    "directory": "segments/RETIRED_NAME",
    "files": [
      {"name": "manifest.json", "bytes": 123, "sha256": "MANIFEST_SHA256"},
      {"name": "segment.bin", "bytes": 456, "sha256": "SEGMENT_SHA256"}
    ]
  }]
}
```

Include `source.json` when present. Only these three flat filenames are supported.
Pin the plan's file SHA-256. Age alone does not establish retirement.

## Prove equivalence

Build and run the read-only Rust example on Linux under bounded CPU/memory:

```sh
cargo build --locked --release -p prep-store --example verify_catalog_prefix
target/release/examples/verify_catalog_prefix --retired \
  /absolute/archive /absolute/audit/plan.json PLAN_FILE_SHA256 \
  > /absolute/audit/retired-proof.json
```

The verifier holds the real writer lock, checks catalog/plan/file pins, rejects
active paths, and compares candidate records with integrity-checked active ranges.
Different or uncovered records enter `retained`; exact matches enter `eligible`.
It deletes nothing and makes no source-freshness or reader-quiescence claim.
API readers may remain online for this read-only proof. Record the verifier
source revision/SHA, proof file SHA, comparison count and eligible byte count.

## Quiesce and apply

Inventory all native processes, service units and container mounts that can read
the archive. Stop **all** those readers and keep the writer stopped. Old snapshots
may retain paths without open file descriptors: an open-file check is insufficient.
Confirm old reader PIDs exited. Stop the verifier too before applying its proof.

Create a fresh audit directory outside the archive, then run:

```sh
python3 tools/prep_offline_gc.py \
  --archive /absolute/archive \
  --proof /absolute/audit/retired-proof.json \
  --proof-sha256 PROOF_FILE_SHA256 \
  --audit /absolute/audit/gc-run \
  --quiesced-reader-pid OLD_READER_PID \
  --all-readers-quiesced
```

Repeat the PID option for each old reader. The acknowledgement is an operator
attestation, not automatic discovery of custom readers. The tool also rejects
visible archive processes and live old PIDs, takes the writer lock, rechecks all
pins, reads back a metadata backup and fsyncs a journal before deletion. It removes
only allowlisted flat files in proven redundant directories, never active or
proof-retained paths. The byte delta must equal the proof's eligible total.

`retired-metadata.tar.gz` retains manifests, provenance, proof and pre-GC catalog;
redundant payload copies are reclaimed. Old catalogs referencing those deleted
copies are no longer independently restorable snapshots. Current full logical
history remains intact. Exclude payloads required by a separate historical-snapshot
retention policy. After interruption, inspect the journal and make a new inventory;
do not blindly replay the original apply operation.

## Resume and verify

Restart the intended writer/readers with existing identities and configuration.
Verify several newly archived heights against source hashes, genuine fresh
`/height` observations, successful API reads and downstream readiness without
consumer reset/restart. Never edit `status.json` to manufacture readiness.

Report archive bytes, remaining budget **after append reserve**, physical disk,
restart/admission times and resource limits. Track this archive margin separately
from aggregate VPS usage and schedule maintenance before it reaches zero.
Reclamation supplies finite headroom; automated online GC would need an explicit
reader lifetime protocol and is not implemented by this tool.
