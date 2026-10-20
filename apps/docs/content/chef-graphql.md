# Querying with GraphQL

Each Chef project exposes its own read-only entity API. The server requires a bearer token. Query a public hosted example through the existing playground; query a private local project through its authenticated endpoint.

## Read entities and the checkpoint

For the filtered Orchard example:

```graphql
query {
  OrchardTransactionList(first: 10) {
    items { id height version transactionIndex }
    nextCursor
  }
  _meta { height hash status }
}
```

Entity root names follow your schema. `OrchardTransactionList` will not exist on a project that only defines `BlockSummary`, and `ReadableNoteList` is not part of the public Chef demo.

## Filter and continue

Lists use `first` and an optional equality `where` object. Pass the returned `nextCursor` as `after` to continue in ID order. The per-response maximum is 100 items. This API does not use Hasura's `limit`, `_eq` or `order_by` syntax.

```graphql
query {
  OrchardTransactionList(first: 10, where: { height: 3000000 }) {
    items { id height version }
    nextCursor
  }
}
```

The height above is an example filter, not a promise of a populated result in your configured history. Lists order by ID, so a first page is not automatically the newest set of transactions.

## Interpret readiness

`_meta.height` and `_meta.hash` identify the committed projection checkpoint. A newly created database may be ready to backfill without being caught up. During source validation or reorganization reconciliation, the read gate can return unavailable. Preserve that state instead of showing a fabricated empty list.

BigInt fields return decimal strings. Queries are read-only: mutations, relations, subscriptions, introspection, fragments and executable directives are outside the current API profile.

Start with [the Chef playground](https://zeer.endpx.cloud/app/chef) for public BlockSummary examples, or [the local memo query client](/docs/chef/shielded/local/) for private receipt entities. Never put a private Chef token into public frontend source.
