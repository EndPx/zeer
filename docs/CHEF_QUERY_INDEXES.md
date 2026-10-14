# Opt-in Chef query indexes

Chef supports a bounded, explicit field-index declaration for application equality
queries. This adds database indexes through `migrate`; it does not change the
GraphQL query language, ordering, read snapshots, authorization or source handling.
No field indexes are enabled by default.

Choose fields used by a concrete application workflow and inspect their current
SQL plans first. A transaction browser commonly filters by mined block height;
an application may also browse its handler-produced block summaries by transaction
count. Annotate only the fields selected for your own projection:

```graphql
type PublicTransaction {
  id: ID!
  minedHeight: Int! @index
  version: Int!
  locktime: BigInt!
  sizeBytes: Int!
  transparentInputCount: Int!
  transparentOutputCount: Int!
}

type Block {
  id: ID!
  hash: String!
  time: BigInt!
  transactionCount: Int! @index
}
```

This is an opt-in example, not a modification of the repository's default public
example. `@index` is interpreted by Chef's entity schema parser. Do not add a
separate GraphQL directive definition. The generated application types still
describe the same scalar values; the annotation is database metadata.

## Declaration contract

- A field accepts at most one `@index`, without arguments or additional directives.
- Indexed scalars are `Int`, `Boolean`, `BigInt`, and `ID` on fields other than
  primary `id`. Required and nullable fields are supported.
- Primary `id` is excluded because the existing `(entity,id)` primary key already
  serves details and ordinary ID pagination.
- `String` is excluded. Chef permits strings up to 16 KiB, which can exceed a
  PostgreSQL B-tree index tuple bound. The supported scalar bounds keep each
  declared field value and ID bounded without truncation or hashing semantics.
- At most eight field indexes are allowed across one project, not eight per entity.
- Entity/field names are validated for models supplied programmatically as well
  as schemas parsed from text. Index names are deterministic hashes of the
  entity/field tuple, scoped to the project's namespace.

Each annotation contributes to the parsed model fingerprint. Schemas without
annotations retain their previous fingerprints. Adding, removing or moving an
annotation changes project identity and requires a new namespace under the
[schema-evolution procedure](SCHEMA_EVOLUTION.md). Continue to bump handler
versions when imported helper behavior changes.

## Explicit migration and query semantics

`migrate` validates namespace ownership and identity, then creates declared
indexes in its existing PostgreSQL migration transaction. Repeating migration
with the same model is idempotent. A failed transaction does not leave partially
initialized namespace/index changes. Chef does not automatically create indexes
when a reader or writer opens a project.

For an annotated `minedHeight` field, the index has this shape in the marked
project namespace:

```sql
CREATE INDEX <deterministic_name>
ON <chef_project>.entities ((data -> 'minedHeight'), id)
WHERE entity = 'PublicTransaction';
```

The partial predicate excludes unrelated entity types. Using the native JSONB
value matches the existing parameterized equality filter. Numeric `Int`, Boolean,
canonical decimal-string `BigInt`, `ID`, and explicit JSON null retain their
existing semantics. BigInt values remain strings in PostgreSQL/GraphQL and
`bigint` in handlers; no floating-point or numeric cast is introduced.

With equality fixed on the indexed field, the second index key preserves the
existing ID cursor order. This adds no range filtering, numerical BigInt ordering,
height ordering, text search, compound-field declaration or query hint. The
planner chooses whether to use an index, and low-selectivity filters may still
benefit little or use another plan.

Indexes participate in the same application transactions as entity writes and
undo restoration. A failed block rolls back its row/index changes. Supported
reorg recovery restores before-images and their indexes behind the existing
reconciling read gate. A query still uses one repeatable-read snapshot for its
checkpoint and entity results.

## Adoption and validation

Freeze the original version, add annotations in a new schema/version, choose a
new project name, and explicitly migrate/replay the new projection. Independently
verify full entities and checkpoints before routing readers. Do not apply an
annotated schema to an existing unannotated namespace or alter its state record
to bypass identity rejection.

Use the [query harness](../benchmarks/chef/query/README.md) to collect actual
`EXPLAIN (ANALYZE, BUFFERS)` plans and repeated authenticated HTTP measurements
for the same application rows, filters, cursor positions and limits. Assess
index build time, disk footprint and ingestion/replay overhead as separate costs.
Generic indexes across every entity are not the declared production shape.
Keep timing results and comparisons local under `benchmarks/results/`; this
contract publishes no speed ranking or latency promise.

Removing an annotation also changes identity and uses a fresh namespace. Retaining
the prior project preserves rollback options; namespace/index retirement remains
an explicit operator retention decision.
