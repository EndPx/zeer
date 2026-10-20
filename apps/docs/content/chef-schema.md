# Entity schema

Define entities in `schema.graphql`. Each requires `id: ID!`.

```graphql
type OrchardTransaction {
  id: ID!
  height: Int!
  version: Int!
  transactionIndex: Int!
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

**Notes:** Schema changes require [a new projection namespace](/docs/chef/evolution/); do not edit generated types to bypass a mismatch.
