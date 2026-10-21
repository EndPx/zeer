# Querying with GraphQL

Chef serves authenticated, read-only queries for your project's entity schema. **Chef 0.2.0** adds bounded range queries, revision-bound cursors and cached source metadata. Existing 0.1.x projects need the additive migration below before using this API.

```graphql
query {
  BlockSummaryList(
    first: 10
    range: { height: { gte: 4523000, lte: 4523100 } }
    orderBy: [{ height: ASC }, { id: ASC }]
  ) {
    items { id height hash time transactionCount }
    nextCursor
  }
  _meta { height hash status generation revision lastCommitAt }
}
```

This example uses the quickstart's `height: Int! @index` field. For your own schema, use the corresponding entity and field names.

| Argument | Behavior |
| --- | --- |
| `first` | 1–100 items; defaults to 25 |
| `where` | Existing scalar equality filters, such as `{height: 4523000}` |
| `range` | One required, indexed `Int` field, with inclusive `gte`, `lte`, or both |
| `orderBy` | One required, indexed `Int` followed by `id`, or `id` alone |
| `after` | The returned opaque `nextCursor`, passed unchanged |

The default order is `id ASC`. An ordered Int automatically adds `id` as a tie-breaker if omitted. Both keys must use the same direction. A range and ordered Int must name the same field; ID-only ordering is also allowed. Nullable fields, numeric BigInt ordering, text search and arbitrary multi-field sorting are outside this profile. BigInt equality and exact decimal-string responses remain supported.

## Read the next page

Use query variables to pass the cursor. Keep the entity, equality filters, range and order unchanged:

```graphql
query NextPage($after: ID) {
  BlockSummaryList(
    first: 10
    after: $after
    range: { height: { gte: 4523000, lte: 4523100 } }
    orderBy: [{ height: ASC }, { id: ASC }]
  ) {
    items { id height hash }
    nextCursor
  }
}
```

A request reads entities and metadata from one PostgreSQL snapshot. Each cursor is signed and bound to project generation, data revision, checkpoint and normalized query shape. Changing page size or selected output fields is allowed. Restarting a compatible server with the same token preserves a cursor when its data revision has not changed. Rotating the API token invalidates existing cursors.

A new committed batch or rollback changes the revision, even if a later replay returns to the same height and hash. Chef rejects an incompatible cursor with **HTTP 409** and `errors[0].extensions.code: "CURSOR_INVALIDATED"`. The error includes the current project, generation, revision and checkpoint, plus `recovery: "RESTART_WITHOUT_CURSOR"`. It returns no partial entity data.

On that error, discard the cursor and rebuild the collected result for that range from its first page. Publish the replacement only after a complete traversal succeeds. Deduplicating IDs alone cannot remove an entity that a reorg deleted; consumers retaining local state must reconcile deletions as well. Chef does not retain historical snapshots across requests; a busy follower can require another attempt. Legacy raw-ID cursors must also restart. Reconciliation still returns **503** for entity queries until the source has been checked and replay is safe to read.

## Check freshness without calling RPC

The same server provides **`GET /status`**, using the same bearer token:

```sh
curl -sS http://127.0.0.1:39370/status \
  -H "Authorization: Bearer $CHEF_API_TOKEN"
```

| Field | Meaning |
| --- | --- |
| `project`, `generation`, `revision` | Project identity and durable data version; revision is a decimal string |
| `checkpoint.height`, `hash`, `status` | Committed application position and read gate |
| `lastCommitAt` | Database timestamp recorded in the latest checkpoint-changing transaction |
| `source.status` | Last follower observation: `unknown`, `available` or `unavailable` |
| `source.checkedAt` | When Chef stored that observation |
| `source.prepIndexedHeight` | Indexed height reported by Prep |
| `source.sourceObservedHeight`, `sourceObservedAt` | Source height and Unix-seconds observation time reported by Prep |

Status remains readable while entity reads are reconciling or blocked. It uses cached PostgreSQL state and makes **no RPC or Prep request**. The follower updates observations using its existing metadata reads. On transport/source failure, source heights become null and status becomes `unavailable`; before any observation, it is `unknown`. A stopped follower leaves its last observation and timestamp in place: consumers must check its age. `available` describes that observation, not a live health guarantee. Unknown timestamps remain null, including a legacy project's unrecorded commit time after migration.

`lastCommitAt` is not a storage-flush measurement. Neither this endpoint nor a receipt authorizes payment. Consumers choose their own freshness, confirmation and canonicality policy and recheck before acting.

## Upgrade an existing project

Stop its follower and API processes, keep the existing config and schema, install Chef 0.2.0, then run the project's `migrate` command before restarting both processes. The migration adds metadata and a revision trigger to the existing marked namespace; it preserves entities, checkpoints and undo history. It does not replay the chain. Back up the database before an operational upgrade.

Do not change schema/handler identity merely to run this migration. Adding `@index` to a previously unindexed field changes model identity and requires a [new project namespace](/docs/chef/evolution/). A process using the new store refuses an unmigrated project. Custom stores must provide snapshot-consistent `ReadView.consumption` and implement ordered keysets before serving list queries; an absent context fails closed.

**Notes:** Send the project's bearer token with every request. Mutations, relations, subscriptions, introspection, fragments and executable directives are outside this API profile. Settlement decisions and external side effects stay in the consuming application; a durable change feed is not included.
