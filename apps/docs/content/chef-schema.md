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

Use `!` for required fields. Lists and entity relationships are outside the current schema profile.

## Generate types

In a starter project:

```sh
npm run codegen
npm run typecheck
```

Use stable IDs and exact integer values. Optional [equality indexes](/docs/chef/indexes/) use `@index` on supported fields.

**Notes:** To change an existing indexer's schema, use [a new project and replay its data](/docs/chef/evolution/). Regenerate types from the schema rather than editing them by hand.
