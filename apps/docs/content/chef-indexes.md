# Equality query indexes

Add `@index` to supported fields used by equality queries:

```graphql
type PublicTransaction {
  id: ID!
  minedHeight: Int! @index
  version: Int!
}
```

| Rule | Supported behavior |
| --- | --- |
| Scalars | `Int`, `Boolean`, `BigInt`, non-primary `ID` |
| Nullability | Required or nullable |
| Declaration | One argument-free `@index` per field |
| Project limit | At most eight field indexes |
| Creation | Explicit `migrate` |

Primary `id` already has a lookup index. String fields are excluded from this profile.

**Notes:** Adding/removing an annotation changes model identity and requires [a fresh namespace](/docs/chef/evolution/). Extra indexes consume storage and write work. See the [full index contract](https://github.com/EndPx/zeer/blob/main/docs/CHEF_QUERY_INDEXES.md) for SQL behavior.
