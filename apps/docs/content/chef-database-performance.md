# Database performance

Start with the query that is slow and the entity it reads. Chef stores entities in your PostgreSQL namespace; handler work, database writes and GraphQL reads can each have a different bottleneck.

## Index the fields you actually filter

The starter already indexes `BlockSummary.height`:

```graphql
type BlockSummary {
  id: ID!
  height: Int! @index
  hash: String!
  time: BigInt!
  transactionCount: Int!
}
```

That declaration supports a query such as:

```graphql
query {
  BlockSummaryList(first: 10, where: {height: 4525000}) {
    items { id height transactionCount }
    nextCursor
  }
}
```

Replace the example height with a block your project has committed. An index helps locate matching rows; it does not create missing history.

Chef supports argument-free `@index` on `Int`, `Boolean`, `BigInt` and non-primary `ID` fields, with at most eight field indexes per project. Primary `id` already has an index. String indexes, composite declarations, range filters and custom sort orders are outside this profile. See [Equality query indexes](/docs/chef/indexes/) for the complete contract.

Declared indexes are created by explicit `migrate`, before indexing. Adding or removing an annotation changes project identity: use [a new namespace and replay](/docs/chef/evolution/) before switching readers. Chef does not defer index creation until backfill finishes or create indexes on the first query.

## Check the actual query plan

On your own database, use the matching namespace and an observed height:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT data
FROM chef_my_indexer.entities
WHERE entity = 'BlockSummary'
  AND data -> 'height' = '4525000'::jsonb
ORDER BY id ASC
LIMIT 10;
```

Compare rows examined, buffer reads and execution time before and after a change on equivalent data. PostgreSQL may choose a sequential scan for a small table or a filter matching much of the table. The presence of an index alone is not evidence that a query became faster. Report measured durations in seconds.

PostgreSQL's [EXPLAIN guide](https://www.postgresql.org/docs/current/using-explain.html) explains plan nodes and the difference between estimated costs and measured execution time.

## Keep reads bounded

Use `first` and the returned `nextCursor`; Chef permits at most 100 items per page. Select only the fields the caller needs. List order is ID order, so a string ID containing a block height does not imply numeric height order.

GraphQL reads use a committed snapshot and its checkpoint. Run `serve` separately from `sync --follow` when the application needs queries during ingestion. Long reads and a busy writer still share your database's CPU, memory and storage budget.

## Reduce work on the write path

| Observation | Change to test |
| --- | --- |
| Handlers need only transaction identity and metadata | Use `transactionMetadata` instead of decoded `transaction` input |
| The application needs a subset of transactions | Apply the matching public `sync.transactionFilter` in Prep |
| Commits dominate a historical replay | Compare bounded `sync.batchSize` values on a fresh namespace |
| Entity reads dominate handler time | Read only the entities needed and reuse values within the handler |
| Reads became faster but writes slowed | Check whether each declared field index serves a real query |

The generated starter uses 32-block commit groups; the supported range is 1–100. A larger group can reduce commit overhead but publishes checkpoints less often, holds a longer transaction and repeats more uncommitted work after a failure. Changes must preserve exact entity output and supported reorg recovery. Choose using measurements rather than a universal batch-size rule.

Keep external payments and other irreversible side effects outside handlers: replay and rollback apply to database projections. Preserve PostgreSQL durability settings when comparing durable indexing performance.

Use [Benchmark your indexer](/docs/chef/benchmarking/) to identify where time is spent, then repeat the same workload and verify every entity after tuning.
