# Chef: bounded block cache and batched entity persistence

Executed 14 October 2026, Asia/Jakarta. Five fresh runs of the previous Chef and
five of the optimized writer used identical handlers, schema, Prep archive,
PostgreSQL durability, page size and resource ceilings. The order alternated
before/after by round. All ten runs independently verified every persisted row.

## Measured result

Heights **1–2048**, **16,962 transactions**, **19,010 persisted entities** per run.
Timing begins with the first source request and ends after the final durable
entity/checkpoint commit. Namespace setup, oracle collection, verification and
GraphQL validation are separate. No old session's measurements enter this table.

| Chef + Prep | Median seconds | Min–max seconds | Committed transactions/s | Timed client query calls |
| --- | ---: | ---: | ---: | ---: |
| Previous writer, runtime from `3ed7db7` | **40.311** | 32.844–48.876 | 420.777 | 103,370 in every run |
| Bounded cache and batched writer | **13.295** | 10.789–16.456 | 1,275.817 | 18,564 in every run |

The observed median elapsed reduction is **67.02%**, or **3.032×** the throughput
on this workload. Timed `pg.Client.query` calls fell **82.04%**. This counter
includes per-page checkpoint inspection as well as block transaction work;
it is not a server SQL execution profile or isolated COMMIT timing.

Only `store.ts` differs among the checked runtime/source files. Both builds use
the same instrumented benchmark runner. The TypeScript example is unchanged,
including its per-transaction block-counter updates. Database schema and handler
configuration remain compatible with the previous implementation.

## Change and guarantees

The writer queues entity operations in invocation order, snapshots `set` inputs
immediately, caches block-local reads and returns independent decoded copies.
Repeated writes coalesce by key. Each dirty key's original database before-image
and final value/deletion are flushed in bounded SQL batches inside the same
existing transaction as the block journal and checkpoint. No multi-block commit,
weakened durability or omitted undo work is used to obtain these results.

Limits are 10,000 mutation calls, 10,000 cached keys, 10,000 queued operations and
16 MiB of accounted serialized cache/queued payload. Flush chunks contain at most
500 keys and 4 MiB of serialized input. These are accounting bounds, not a
16 MiB process-memory guarantee. Memory and CPU observations are retained per run;
the Node harness also holds the independent oracle and verification structures.
No isolated engine RSS reduction is claimed.

Batch persistence now happens after handlers complete, so its cost moves from
the handler phase into transaction overhead. The total durable time above is the
performance criterion; a lower handler timer alone would not prove improvement.
The read-side GraphQL implementation is unchanged, so these results do not claim
a corresponding improvement to the previous 128-ID GraphQL lookup benchmark.

## Correctness and environment

**38 Chef tests passed against actual PostgreSQL, zero skipped.** Added cases cover
ordered concurrent calls, input snapshots, copy isolation, caught/discarded
operation errors, arbitrary rejection values including undefined/null, database
flush failure, memory/entry/queue/mutation bounds, and multi-chunk rollback.
Existing restart, handler failure, snapshot read, GraphQL gating and application
reorg tests also passed. These reorg tests use deterministic source branches with
real PostgreSQL; they are not a new actual-node reorg demonstration.

Every benchmark run reopened the store and checked all 2,048 blocks and 16,962
transactions against the independent full-node oracle, verified its final
checkpoint, and checked a real GraphQL response. The canonical source remained
at height 6764 with hash
`0000000160e11c9403141d7c2a16b07a2459919fc774795da3f687628c5ece54`.

The source had 0.75 CPU / 2 GiB; Prep 0.5 CPU / 1 GiB; PostgreSQL 0.75 CPU / 1 GiB;
Node and the controller shared a 1 CPU / 3 GiB parent cap. Aggregate: 3 CPU / 7 GiB.
Recorded active limits matched the intended profile. Both builds were prepared
separately with locked dependencies. Unchanged runtime, schema, types, GraphQL,
Prep client, handler and lockfile hashes were independently checked after the run.

This is an early-mainnet v1/v2 workload on a shared VPS with warm sources. It is
not a whole-chain or universal performance claim. The earlier native CipherScan
measurement has different output work, process timing and resource allocation;
its 21.821-second median must not be treated as a controlled same-session ranking
against the optimized Chef result.

All experiment containers were stopped, the source CPU limit was restored, and
the five existing application services remained active.

## Evidence

- [Comparison and resource profile](../raw/2026-10-14-chef-optimized/comparison.json).
- [Source/build parity and cleanup proof](../raw/2026-10-14-chef-optimized/execution.json).
- [Actual PostgreSQL tests](../raw/2026-10-14-chef-optimized/tests-ready.txt).
  The initial `--pipe` execution exposed test output to the caller but left only
  lifecycle lines in `tests.txt`. The unchanged suite was rerun after performance
  measurements with stdout captured to the linked file; both captures remain.
- [Shared independent oracle](../raw/2026-10-14-chef-optimized/oracle.json.gz).
- All ten per-run reports and console captures are in the same raw directory.
  Their original absolute oracle paths refer to byte-identical host copies; the
  published gzip contains one copy with the recorded uncompressed SHA-256.
- [Alternating host recipe](../../chef/compare_versions.py) and
  [instrumented runner](../../chef/indexing.mjs).
