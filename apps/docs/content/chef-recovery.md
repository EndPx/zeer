# Checkpoints, restart & reorgs

A checkpoint is the last block Chef fully saved. A reorg happens when the source replaces part of the chain with a different branch; Chef must undo the affected records before processing the replacement blocks.

| Event | Behavior |
| --- | --- |
| Normal restart | Compatible sync resumes the persisted checkpoint |
| Failed commit group | No partial group checkpoint is committed |
| Supported reorg | Orphaned entities roll back before replacement replay |
| Reorg outside retained history | An explicit rebuild may be required |
| Changed project identity | Use [schema/handler evolution](/docs/chef/evolution/) |

## Inspect status

```sh
npm run status -- --human
```

Run this from your generated project directory. It loads the project's `.env` and reports source/project state without starting the indexer. To resume indexing, run `npm run follow` with the same configuration and database.

**Notes:** Restart with the same config, source and database. Do not move checkpoints manually or delete data as a routine restart. Reads can be unavailable during reconciliation/source validation. External effects are outside database rollback.

## Recover from a source interruption

Use a disposable project for this exercise. It uses the existing CLI recovery path available in published Chef 0.6.1; the additional heartbeat and diagnostic fields described below belong to the **0.7.0 source-build candidate**, which is not yet published.

1. Prepare the project, migrate its intended namespace, then record `pnpm run status --json`. Keep the checkpoint height/hash and a small query result with stable entity IDs. Run only one writer for this project.
2. In one terminal, run `pnpm run follow --json`. In another, run `pnpm run serve`. The API and follower must use the same config, source URL and database.
3. Ask the operator of your **own isolated test source** to make its Prep endpoint temporarily unavailable. The operator chooses and reverses the interruption. Do not stop the shared public preview, someone else's node, PostgreSQL or unrelated services. If you do not control a test endpoint, skip the interruption rather than modifying a production source.
4. Leave follow running for a transient source outage. Once its requests observe the failure, expect `source_unavailable` and reconciliation/read gating as applicable. Detection follows requests and polling, not the instant the endpoint is stopped. Check `pnpm run status --json` from a third terminal; an unavailable source is a nonzero result, not an empty dataset.
5. Have the source operator restore the **same compatible endpoint**, with correct authentication and network, history covering the project's start and retained recovery range, and readiness restored. Do not change identity or manually advance a checkpoint to bypass this step.
6. Follow validates the retained checkpoint and resumes. Wait for `caught_up`, then inspect status: `checkpoint.status` should be `ready` and `source.chefPrepLagBlocks` should be zero. Also inspect source observation time and the Prep–source gap; being caught up with Prep does not prove the node has the latest network block.
7. Stop the follower gracefully, start `pnpm run follow --json` again, and compare the saved entity IDs, values and checkpoint hash. Verify that the projection contains one record per expected identity, including any new blocks indexed during recovery. If a consumer's cursor was invalidated, rebuild its affected range and reconcile removed entities as described in [GraphQL consumption](/docs/chef/graphql/).

If a command exited, correct its reported cause before restarting the same command. Authentication, incompatible network/source identity and rebuild-required errors are not reasons to retry indefinitely. The exercise checks projection recovery; it does not prove exactly-once notifications or payments.

## Read long-running work in the 0.7.0 candidate

Candidate sync/follow emits a best-effort `state: "heartbeat"` every five seconds from cached process state. It makes no additional Prep or database request. `progress.processingRange` is an inclusive pending range; `progress.committedHeight` is the last checkpoint observed or commit/rollback acknowledged by this process. A supported rollback can decrease it.

| Field | Meaning |
| --- | --- |
| `phase`, `phaseSince` | Current local stage and when that stage began |
| `lastProgressAt` | Last completed local stage, such as a source read, scan, handler or acknowledged commit; it does not necessarily mean a block was committed |
| `heartbeatAt` | Time the cached heartbeat snapshot was produced; it does not advance `lastProgressAt` |
| `prepReady`, `prepArchiveHeight`, `prepIndexedHeight` | Last known Prep readiness and coverage; unknown remains null |
| `sourceObservedHeight`, `sourceObservedAt` | Valid observation supplied by a compatible, ready Prep follower; the timestamp is Unix seconds |

The phases are `checking_checkpoint`, `fetching`, `scanning`, `handlers`, `committing`, `recovering`, `source_wait` and `caught_up`. `committing` includes application-transaction work outside handlers and waits for its acknowledgement; it is not a pure SQL-write timer. Heartbeats contain no viewing key, account identifier, transaction ID, receiver, amount or memo. They can be delayed by event-loop work and are skipped when stdout is backpressured or closed. They are process diagnostics, not a health guarantee or a stored recovery journal.

## Choose the next action

The 0.7.0 candidate adds `action.category` and `action.retryPolicy` to fixed error guidance. Status and doctor expose a `diagnostic` with build-produced artifact identity, coverage, checkpoint and timestamped source information. Missing build provenance is `unknown`; a source folder's current Git revision is not substituted for the running artifact.

| Observation or code | Operator action |
| --- | --- |
| `SOURCE_UNAVAILABLE` | `wait_for_source`; inspect source readiness and retry under a bounded operator policy |
| Transport failure, timeout or rate limit reported as `SOURCE_UNAVAILABLE` | `retry_transient`; use a bounded operator policy rather than a tight retry loop |
| `PREP_UNAUTHORIZED`, `DATABASE_UNAUTHORIZED` | `fix_authentication`; correct credentials before retrying |
| `SOURCE_NETWORK_OR_KIND_MISMATCH` | `restore_source_identity`; restore the expected source before restarting |
| `SOURCE_CHANGED_DURING_REPLAY` | `reconcile`; retry against a stable compatible source under a bounded operator policy |
| `RECONCILIATION_REQUIRED` | `reconcile`; run the writer's supported recovery path |
| `REBUILD_REQUIRED` | `rebuild`; preserve the old namespace and verify a fresh replay before switching readers |

These action labels describe diagnosis. They do not introduce automatic retries, alter follow's existing policy or open a read gate. Config, schema and handler identity changes still require the [project evolution procedure](/docs/chef/evolution/).
