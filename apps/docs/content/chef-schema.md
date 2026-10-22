# Entity schema

An entity is a record type Chef stores for your application. Define it in `schema.graphql`; each entity needs a unique `id: ID!`. The quickstart creates this block summary:

```graphql
type BlockSummary {
  id: ID!
  height: Int! @index
  hash: String!
  time: BigInt!
  transactionCount: Int!
}
```

| Scalar | Handler / GraphQL representation |
| --- | --- |
| `ID`, `String` | String |
| `Boolean` | Boolean |
| `Int` | Bounded integer |
| `BigInt` | JavaScript `bigint` in handlers; decimal string in GraphQL |

Use `!` for required fields. Chef 0.6.0 supports scalar fields, bounded lists and entity relationships. Use these features in your own 0.6.0 project; the hosted Playground has its own demo schema.

## Lists and relationships

```graphql
type Transaction {
  id: ID!
  outputs: [TransactionOutput!]! @derivedFrom(field: "transaction")
}

type TransactionOutput {
  id: ID!
  transaction: Transaction! @index
  valueZat: BigInt!
  addresses: [String!]!
}
```

Store the reference as its target ID in the handler: `transaction: txid`. Generated handler types use a string for references. Derived fields such as `outputs` are computed at query time and cannot be written by handlers. The inverse must be a single entity reference with `@index`; it counts toward the existing project index limit.

Scalar and stored-reference lists contain at most 100 items; nested lists are unsupported. BigInt list items preserve exact integer strings in PostgreSQL/GraphQL and become `bigint` in handlers. Item and container nullability follow the declared GraphQL type.

```graphql
query Breakdown($txid: ID!) {
  TransactionById(id: $txid) {
    outputs(first: 100) { valueZat addresses transaction { id } }
  }
}
```

Inverse lists accept `first: 1..100` (default 25). If more children exist, the query fails with `RELATION_LIMIT_EXCEEDED` and `QUERY_CHILD_LIST`. Read every child through `TransactionOutputList(where: { transaction: $txid })` using normal cursor pagination. Excess children are never silently omitted. Nested reads share the root query's repeatable-read snapshot and readiness gate, with a 500-unit request budget for reference lookups and inverse-list work. Existing depth, field and response-size bounds still apply. Filter lists through their child entities; scalar-list equality filters are not supported.

References do not impose database foreign keys or cascade deletes. A missing optional target returns null; a required missing target fails according to GraphQL non-null rules. Schema changes require a fresh namespace and replay. Existing scalar-only schema fingerprints are preserved.

The [transaction breakdown example](https://github.com/EndPx/zeer/tree/main/examples/transaction-breakdown) combines these relationships with previous-output resolution.

## Generate types

In a starter project:

```sh
npm run codegen
npm run typecheck
```

Use stable IDs and exact integer values. Optional [equality indexes](/docs/chef/indexes/) use `@index` on supported fields.

**Notes:** To change an existing indexer's schema, use [a new project and replay its data](/docs/chef/evolution/). Regenerate types from the schema rather than editing them by hand.
