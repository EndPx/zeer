# Public-data operator guide

This guide covers a single operator's Prep archive and Chef PostgreSQL project.
It does not certify a public multitenant service, manage wallets, or decrypt notes.
Start with the [isolated quickstart](../examples/quickstart/README.md) and the
[Prep contract](PREP_ENGINE.md) before connecting your own source.

## Identity and checkpoints

Keep the node network, Prep archive network/range and Chef configuration aligned.
Chef requires history from its configured start height; Prep supports genesis
height zero when its archive covers genesis. Record the source head/hash and use the durable PostgreSQL
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
The recovery projection declares indexes on its transaction block height and
block transaction count, so the same proof exercises index maintenance during
failure, rollback and replay. It does not change the default public example schema.

Run only one proof within the resource budget, with a new output directory and
unique `zeer-...` Docker name prefix. All output paths must be local/ignored; keep
failures as well as passing records. The controller needs its own bounded cgroup
in addition to the container limits. The harness stops its owned containers on
exit and retains state for diagnosis. It never globally prunes Docker resources.
If Docker's default subnet pool is exhausted, an operator can supply `--subnet`
with an unused RFC1918 IPv4 /24–/28 after checking host/VPN routes and existing
Docker networks. Docker also checks its own overlap; do not change global network
configuration or delete another application's network to run the proof.

## Hosted demo reader updates

The public web adapter can switch to a separately admitted Prep HTTP reader
while the original reader continues serving the existing Chef installation.
Both readers use the same immutable archive segments; this does not reset Chef
state or require a new blockchain backfill. Keep the old web runtime and protected
upstream configuration available until the new public query path is verified.

An active process may still be opening and verifying a large archive. Check
readiness and a real bounded query before switching readers. Restarting a reader
repeats admission work. Include every reader in the operator resource guard and
keep all temporary startup allocations within the existing aggregate envelope.
Serialize guard-policy changes against in-flight guard checks: an already-running
Python guard keeps its loaded policy even after the source file changes. Restore
normal service limits before completing the cutover, then verify the guard again.

## Fixed Chef hackathon namespace

The hosted Chef demo uses `hackathon_testnet_20261020`, with the inclusive target
4,510,000–4,519,999. See [the manifest and handlers](../examples/chef-hackathon/README.md).
Its API serves committed entities during a finite sync, then remains available
after the writer reaches the target. It does not follow the chain tip. Keep the
previous genesis namespace and its configuration intact for rollback.

Set the web adapter's `ZEER_CHEF_URL` and server-side token to the matching demo
reader. Set `ZEER_CHEF_DEMO` to a single-line JSON object from that example's
`demo.json` (project, fromBlock and toBlock). The network field is not used by the
UI descriptor; all hosted adapters still enforce testnet. The descriptor declares
the intended range; only GraphQL's observed checkpoint supplies progress. Remove
the descriptor when connecting an ordinary full-history/following Chef project.
Never switch a URL without switching or removing its descriptor too.

Before changing the public web endpoint, migrate the new namespace, start its
API and verify its actual schema/checkpoint. Retain the previous protected env
and web release. Use distinct loopback ports and register all added units in the
same resource guard; do not loosen shared caps. Build and install under bounded
units. Restart only the web adapter for the cutover, preserving warm Prep readers.

For a restart proof, stop the finite demo writer after a committed prefix, keep
the API running, record the checkpoint and verify that prefix against Prep.
Restart the identical writer/config to the same end. Check every final entity's
hash, timestamp and transaction count against an independent Prep projection,
and check that the committed prefix is unchanged. A repeat sync to the completed
target must leave both checkpoint and entity digest unchanged. Save operational
proofs locally; never publish deployment credentials or benchmark result files.

## Optional read-only testnet node observations

`PREP_LIVE_SOURCE_FILE` names an absolute file containing the private node RPC URL;
`PREP_LIVE_COOKIE_FILE` names an absolute file containing its `user:password` cookie.
Keep both outside the checkout, readable only by the service user. Private HTTP
requires explicit `PREP_LIVE_ALLOW_INSECURE=true`; remote transport should use TLS.
The process reads these bounded files for each observation, allowing an operator
to refresh a rotated cookie atomically without reopening an admitted archive.
Do not put either value in frontend bundles, public examples, or logs.

The source identity must be Zcash testnet with the expected genesis. The source
allowlist contains only blockchain info, block hash/block reads, raw transaction
lookup and raw mempool lookup. `/transaction` and `/mempool` share the Prep HTTP
authentication, two active request permits, bounded queue and work deadline.
They return a visible unavailable response when the optional source cannot be
verified; archive `/query` remains separate. See [live observation semantics](PUBLIC_SHIELDED.md).
