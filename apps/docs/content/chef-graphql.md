# Querying with GraphQL

Chef serves authenticated read-only queries for your project's entity schema.

```graphql
query {
  OrchardTransactionList(first: 10) {
    items { id height version transactionIndex }
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
| `_meta` | Committed checkpoint height/hash and status |

Entity root names follow your schema. Use `OrchardTransactionList` for the filtered example and `ReadableNoteList` for the local inbox. The public playground provides `BlockSummary` queries.

**Notes:** Send the project's bearer token with direct API requests. BigInt values are decimal strings. Reads can be unavailable during reconciliation. Mutations, relations, subscriptions, introspection, fragments and executable directives are not in this API profile.
