# Public-data operator guide

This guide covers a single operator's Prep archive and Chef PostgreSQL project.
It does not certify a public multitenant service, manage wallets, or decrypt notes.
Start with the [isolated quickstart](../examples/quickstart/README.md) and the
[Prep contract](PREP_ENGINE.md) before connecting your own source.

## Identity and checkpoints

Keep the node network, Prep archive network/range and Chef configuration aligned.
Chef requires history from its configured start height; Prep currently starts at
height one or later. Record the source head/hash and use the durable PostgreSQL
checkpoint to determine progress. A process log or count from a partial invocation
is not a replacement for that checkpoint.

Prep and Chef have independent reorg windows. Recovery is constrained by both
the admitted source/archive history and Chef's retained undo journal. A deeper
Prep window cannot restore application undo data Chef has already discarded.
Keep at least the common ancestor needed by both layers when choosing ranges.

## Source interruption and restart

Run the Prep follower and Chef follower for ongoing source monitoring. Prep
classifies transport interruptions and temporary HTTP failures for bounded retry;
authorization, integrity, storage and exhausted step deadlines fail visibly.
The default Prep step deadline is 120 seconds and an individual RPC request is
bounded to 15 seconds. Setting a step deadline below the request timeout can
produce `sync_deadline_exceeded` before a transport failure can enter the retry
path. Do not turn every error into an unlimited retry or a ready state.

Once a running Chef writer observes an unavailable Prep source, it marks the
project reconciling and new GraphQL reads fail with 503. Detection occurs on a
source observation, not at the exact instant of a remote failure. A standalone
status read is diagnostic and must not mutate the writer's persisted state.
If the writer is stopped, its checkpoint and read gate may remain unchanged;
monitor writer/process health separately. A ready historical archive does not
establish current upstream freshness.

Restart with the same configuration, archive and database identity. Re-read the
actual source head/hash: a source restart can restore a different or shorter
canonical tip. Do not force the application to preserve a former tip that the
source no longer considers canonical. Within the supported window, reconciliation
undoes orphaned entity effects and replays canonical blocks before ready reads
resume. An in-flight GraphQL request may finish with its coherent earlier
repeatable-read snapshot; this is not a claim of instantaneous canonical finality.

## Interrupted application writes

Chef commits one block's entity writes, undo records, block identity and checkpoint
in one PostgreSQL transaction. After an interrupted invocation, an earlier block
may already be committed even when the invocation never returned its final count.
Restart from the persisted checkpoint. Keep handlers deterministic and confine
effects to entity operations; HTTP calls, payments and files do not participate
in PostgreSQL rollback and can repeat after recovery.

## Beyond the recovery window or changed application identity

When Chef reports `REBUILD_REQUIRED`, retain the blocked project for diagnosis.
Do not change its checkpoint manually, delete its undo records or mark it ready.

1. Stop the affected Chef writer and confirm the source and Prep cover the intended
   canonical range. Preserve the old configuration and database namespace.
2. If Prep itself cannot recover, stop that follower, preserve the old archive and
   ingest into a new archive directory from an appropriate supported start height.
   Verify raw data, head and readiness before pointing an application at it.
3. Copy the application configuration and assign a new unique `project` name.
   Preserve the network, schema and intended start height. Explicitly migrate the
   new namespace and replay using the documented Chef commands.
4. Verify the new checkpoint and all required application entities independently.
   Start/query the replacement GraphQL service on a separate local port.
5. Switch your application's read configuration only after verification. Keep the
   blocked namespace until its evidence is no longer needed; Zeer has no automatic
   destructive reset or versioned cutover in this release.

Schema/config identity changes use this same new-project workflow. Changes to
imported handler helpers require a `handlerVersion` bump. Neither a new namespace
nor a successful local replay is proof of backup/restore readiness for a hosted
service.

## Connected Regtest acceptance

`benchmarks/chef/recovery.py` creates its own empty, peerless Zebra Regtest node,
PostgreSQL and Prep/Chef processes. It requires a built checkout, a release Prep
binary, Docker and explicit `--allow-disposable-regtest-mutation`. It uses
`generate` and `invalidateblock` only after checking the private endpoint, known
Regtest genesis, zero peers and bounded expected height. Never point this proof
at an application node. The script does not accept an external node endpoint.

It verifies source and Prep interruptions, process death during an uncommitted
block, exact-window undo/replay, rejection beyond the window, consistent GraphQL
snapshots and explicit rebuild into a new namespace. Its SQL pause/lock controls
exist only in its newly created test database; they are not application hooks.
These are controlled administrative forks, not naturally occurring P2P reorgs.

Run only one proof within the resource budget, with a new output directory and
unique `zeer-...` Docker name prefix. All output paths must be local/ignored; keep
failures as well as passing records. The controller needs its own bounded cgroup
in addition to the container limits. The harness stops its owned containers on
exit and retains state for diagnosis. It never globally prunes Docker resources.
