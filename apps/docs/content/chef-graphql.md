# Querying with GraphQL

Chef serves authenticated read-only queries for your project's entity schema.

```graphql
query {
  BlockSummaryList(first: 10) {
    items { id height hash time transactionCount }
    nextCursor
  }
  _meta { height hash status }
}
```

| Option / field | Meaning |
| --- | --- |
| `first` | Page size, at most 100 items |
| `after` | Returned `nextCursor` for continuation in ID order |
| `where` | Scalar equality filters, such as `{height: 3000000}` |
| `_meta` | Highest block fully committed to this project, its hash and the project's read status |

This query works with the quickstart's `BlockSummary` schema. Entity query names follow your schema: the filtered example uses `OrchardTransactionList`, and the local inbox uses `ReadableNoteList`.

**Notes:** Send the project's bearer token with direct API requests. BigInt values are decimal strings. Reads can be unavailable during reconciliation. Mutations, relations, subscriptions, introspection, fragments and executable directives are not in this API profile.
