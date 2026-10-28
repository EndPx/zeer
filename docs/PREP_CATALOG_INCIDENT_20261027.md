# Prep catalog-capacity recovery — 27 October 2026

The writer stopped at **01:00:39 WIB on 27 October / 18:00:39 UTC on 26 October** with
`snapshot bound exceeded: catalog segment count`. The catalog held 30,000
references and 15,532,924 bytes, ending at block 4,544,783. Revision was 30,152
and epoch 75. Of its segments, 24,603 contained one block. The downstream Chef
projection correctly closed its read gate and waited for a ready source.

## Cause and implementation

Follow publishes promptly near the head, so a live block can become its own
immutable segment. The previous writer did not consolidate references. Compression
through the existing one-input/one-output repack operation could not reduce that
catalog count.

The deployed fix is ordinary Prep **0.1.0, commit
`63331816537545f0d059d61a2f453fcabeb6a1b8`**, SHA-256
`81f34e6c34f7e62f52671fb506c8bbe3c229e96fad0ce5c8ca7d6ffe97550a1d`.
Embedded build-info reports a clean native source state; the running executable
was hashed independently. The old binary matched its archived release checksum;
40 native source files matched commit `96b1dc0`. That legacy binary has no embedded
commit attestation, so its version string alone was not used as provenance.

**The hard 30,000-reference and 16 MiB catalog limits were not raised.** The new
writer checks capacity before finalizing another segment and performs bounded
historical consolidation. It publishes a newly available block before optional
maintenance. A group is limited to 256 references, 1,000 blocks, 64 MiB encoded
output and an 8 MiB manifest; the recent 100-block recovery tail is protected.
The soft triggers are 16,384 references or 8 MiB of catalog JSON.

Every replacement is durably written, reopened through ordinary integrity checks,
and compared against its inputs as complete `BlockRecord` values before atomic
catalog publication. Epoch/revision advances invalidate physical-layout cursors;
they do not rewind canonical history. Ready status after maintenance requires a
new actual RPC observation and canonical head-hash check.

## Integrity and recovery evidence

The independent read-only verifier authenticated every original manifest and
encoded segment against the pinned initial catalog. Its final epoch-178 snapshot
contained **4,519,816 unchanged blocks plus 24,968 decoded, byte-compared
replacement blocks, covering all 4,544,784 original blocks**. The initial head
hash was preserved. Explicit digest passes covered 23,250,827,813 bytes; this is
not a total-I/O counter. The final check took 348.610 seconds under 50% CPU and
a 768 MiB cgroup limit. The earlier epoch-90 check is retained separately.

A held old snapshot and its refreshed view returned identical data for six core
queries, including headers, modern metadata, a selected raw transaction and sparse
TX ID filtering. Its old cursor was explicitly rejected with 409 after the epoch
change. No source directory was removed, so lazy reads through old paths survived.

The final soft-threshold acceptance snapshot at **03:13:27 WIB on 27 October /
20:13:27 UTC on 26 October** recorded:

| Check | Result |
| --- | --- |
| Prep | Ready, indexed height 4,545,101, genuine recent source observation |
| ZeeSwap Chef | Ready at 4,545,101; authenticated `_meta` query succeeded |
| Consumer lifecycle | Same API/follower container IDs, start times and restart counts; same anchor |
| Catalog | 16,026 references; 8,279,446 bytes; below both soft thresholds |
| Independent source checks | Five distinct heights matched the configured Zebra, including the old head and first resumed block |
| Original unreferenced files | All 79 directories and manifest hashes retained unchanged |
| Guard | 3 CPU / 8 GiB / 60 GiB passed; no observed OOM event |

The earlier recovery acceptance recorded 26,268 references; the lower-probe phase
ended at 24,665. The later soft-threshold snapshot records 16,026. These are
separate timestamped observations, not conflicting claims about one snapshot.
Routine maintenance will reactivate when future growth reaches a soft threshold.

The 79 initial directories comprised **75 noncanonical branches, three canonical
historical duplicates, and one complete canonical segment above the old head**.
The last was the failed append for block 4,544,784. It was preserved, not silently
adopted or deleted. Historical catalogs are audit snapshots, not instructions to
overwrite a newer published head during rollback.

## Startup, queries and resources

The old-layout ordinary snapshot probe admitted the full archive in **672.953
seconds** at 75% CPU; its process peak RSS was 786,563,072 bytes. The deployed
writer's archive phase took **573 seconds**, measured by one-second phase events,
at a temporary 100% CPU ceiling. Start to first observed ready took **585.559
seconds**. The writer returned to 50% CPU. These are different processes and
budgets, with shared warm caches and concurrent work; they are not a paired
speedup or a guaranteed cold-start time.

Two sequential observation phases used real ingestion and the existing consumer:

| Query probe phase | Data requests | 200 | Capacity 429 | Layout 409 |
| --- | ---: | ---: | ---: | ---: |
| Nominal three-second interval | 104 | 96 | 7 | 1 |
| Nominal fifteen-second interval | 86 | 82 | 2 | 2 |

A separate post-maintenance check made 16 attempts: 15 successful responses
across five cases and one retained capacity 429, followed by bounded retry. Each
case had three matching successful data digests. Its successful-case medians were
0.221–0.392 seconds while the final prefix verifier ran. This later, different
background state is not pooled with the two recovery phases or sold as a speedup.

Successful data hashes remained identical for each fixed query. The separate
755 metadata samples included 53 capacity responses. Successful query medians
range from 0.597 to 1.190 seconds across these phase/case groups; complete samples
and tail statistics remain in the artifact. The second phase reduced operator
probe pressure while catch-up continued. Its workload and background state differ,
so the phases are not a controlled throughput comparison.

Peak sampled process RSS was **879,374,336 bytes for the writer** and
**1,047,490,560 bytes for the existing reader**. Both cgroups stayed capped at
1 GiB; cgroup memory includes file cache and is not the same as process RSS.
The reader was not restarted, and its lifetime peak is not attributed solely to
this incident. Both cgroups reached their 1 GiB memory peak and recorded nonzero
`memory.events.max`; this is observed memory pressure, not comfortable cgroup
headroom. Those counters are cumulative for the cgroup lifetime and cannot
attribute every limit event to this cohort. No OOM event was observed.
Capacity responses and layout read gates were preserved rather
than bypassed. This observation is not an uptime or multi-application SLA.

Retired duplicates remain within the existing 24 GiB archive budget. At final
acceptance the archive occupied 24,797,555,940 bytes, leaving 703,812,380 bytes
above its 256 MiB append reserve. This is finite headroom, not unlimited retention.
Future garbage collection needs explicit classification and reader quiescence;
unknown files must not be deleted as routine cleanup.

## Reproduce and inspect

The [engine contract](PREP_ENGINE.md#bounded-catalog-consolidation) documents
`archive-consolidate`. This incident used the new follower's automatic path,
not a manual repack. Manual bounded jobs can return a partial result: inspect
`target_reached` and `stop_reason` rather than interpreting exit code zero alone.

Source contains the [held-snapshot/core-query probe](../crates/prep/examples/catalog_recovery_probe.rs)
and [independent prefix verifier](../crates/prep-store/examples/verify_catalog_prefix.rs).
**69 store tests, 96 Prep tests and two verifier fixture tests passed**, with
Clippy warnings denied. No key/account, birthday, project or schema was reset,
and no new transaction or settlement was executed by this work.

The [curated artifact](../apps/docs/static/benchmarks/2026-10-27-prep-catalog-recovery-testnet.json)
contains the source pins, exact sample outcomes and limitations. Reconstruct its
statistics with `node apps/docs/scripts/verify-catalog-recovery.mjs`. Private
operational logs and credentials remain outside the repository.

Follow-up: the [28 October archive-budget incident](PREP_ARCHIVE_BUDGET_INCIDENT_20261028.md)
classified and reclaimed proven redundant copies after quiescing all archive
readers. This report describes the earlier state when those source files were
retained; physical snapshot retention and the later GC are separate operations.
