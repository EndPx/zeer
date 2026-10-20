# Entity schema

Define the application records you want to query. Each entity requires `id: ID!`. The current schema supports `ID`, `String`, `Boolean`, `Int` and `BigInt` scalar fields, with nullable fields where needed.

```graphql
type OrchardTransaction {
  id: ID!
  height: Int!
  version: Int!
  transactionIndex: Int!
}
```

This matches the [filtered public example](https://github.com/EndPx/zeer/blob/main/examples/chef-filtered/schema.graphql). Stable IDs make replay and application lookups predictable. For a transaction entity, the transaction ID is useful; note observations need the scanner's stable note identity instead.

## Generate types

From a checkout with Chef built:

```sh
node packages/chef/dist/cli.js codegen --config examples/chef-filtered/chef.config.ts
```

Standalone projects created by the [quickstart](/docs/chef/quickstart/) provide `npm run codegen` and a TypeScript check. Generated types describe the configured model. Do not edit generated files to compensate for an incompatible schema.

## Exact values

Use JavaScript `bigint` in handlers for `BigInt` fields. GraphQL returns those values as canonical decimal strings. Preserve zatoshi values as integers rather than converting them into floating-point amounts.

The memo example deliberately uses `memoText: String` as a nullable field: not every 512-byte memo has a safe text representation. It also preserves `memoHex` and an explicit `memoKind`.

## Query indexes

Use an argument-free `@index` on supported fields only when it serves an actual equality query. There are bounds and identity implications; the [index reference](/docs/chef/indexes/) explains them. Chef does not automatically create arbitrary indexes from reader queries.

## Current boundaries

Lists, relationships, custom scalar types and schema-level directives are not part of this schema profile. Do not copy an Envio or Hasura schema unchanged and assume those features are supported. A model change requires [explicit evolution](/docs/chef/evolution/) into a new projection.
