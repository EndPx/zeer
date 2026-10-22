# Chef transaction breakdown — 0.6.0

Chef and launcher 0.6.0 are published on npm. Installing the release does not migrate hosted projects or automatically add a transaction schema to them. See the [runnable schema and handlers](../examples/transaction-breakdown/README.md).

The [23 October release acceptance](CHEF_060_ACCEPTANCE.md) records the complete Linux suite and independent registry-installed testnet verification. The Windows pre-release checks at the end of this document retain their earlier date and skipped-platform counts.

## Previous-output resolution

`readTransparentOutputs(transaction)` validates public `decoded.vout`, converts decimal value strings to exact zatoshis and returns output identities, script components and addresses present in those scripts. JavaScript floating-point amounts, negative values, fractional zatoshis and inconsistent indices fail. Outputs are keyed by `transparentOutputId(txid, outputIndex)`.

`resolveTransparentInputs(transaction, lookup)` walks public inputs with a bounded lookup callback. Its result distinguishes `resolved`, `unresolved` and `coinbase`. Resolved output identity must match the exact referenced TX ID and index. Duplicate inputs, self-references, malformed records and lookup failures fail explicitly. Unresolved inputs have no previous output; consumers must not substitute zero or infer sender identity from an output address.

The example retains previous outputs in Chef's canonical entity store. Sequential transaction handlers can resolve a transaction spending an earlier output within the same block. The entities participate in normal commit, restart, journal and rollback behavior. Genesis replay includes historical funding outputs; a later start or transaction filter can leave references unresolved. This is historical indexing, not UTXO spendability or consensus validation.

For explicit prefetch outside a DB handler, `lookupTransparentOutputs` uses Prep's batch endpoint: at most 128 TX IDs and a 10,000-block range, forwarding the caller's pinned snapshot and cancellation options. It returns source snapshot and missing IDs; it does not scan all history implicitly, fall back to unrelated RPCs, or insert fetched data into a canonical projection. Revalidate canonicality when importing external observations.

## Relations and lists

- Single entity references are stored as ID strings, without an extra `_id` suffix.
- Stored scalar/reference lists have a 100-item bound. BigInt values preserve exact decimal storage and handler bigint types. Nested lists are rejected.
- `@derivedFrom(field: "...")` reads inverse one-to-many references. The inverse must be a single indexed reference to the declaring entity. Derived fields are omitted from write types and cannot be set.
- Inverse lists use `first: 1..100`, default 25. More children produce `RELATION_LIMIT_EXCEEDED`, with recovery `QUERY_CHILD_LIST`. Root entity list cursors remain the complete consumption path for large child sets.
- All nested reads use the same read view as the root query. No network lookup occurs in GraphQL. A per-request budget reserves inverse-list row limits before I/O, including concurrent siblings, and bounds reference lookups; depth 5, field 100, response 2 MiB and admission limits remain.
- Schema fingerprints for existing scalar-only models remain byte-compatible. New relation/list declarations change model identity and require a fresh project namespace and replay. No table discovery or implicit migration occurs.

## Verification

Tests cover exact large values, missing outputs, coinbase, malformed inputs, failed lookup, snapshot forwarding, nested inverse/forward traversal, scalar lists, overflow recovery, cursor consumption, request fanout bounds and legacy fingerprints. A real PostgreSQL test uses the example handler to persist funding/spending records, restart, read nested GraphQL, close the read gate during reorg, roll back, reject an old cursor and ingest a replacement branch without retaining old input values.

PostgreSQL fixtures and generated test identities are local-only; synthetic branches are not claimed as mined testnet transactions. Native shielded-scanner suites require their documented Linux executable and remain separate from transparent breakdown acceptance.

Local acceptance on 22 October 2026: Chef build and example codegen/typecheck passed; 180 tests passed, zero failed, and seven platform/native-scanner tests were skipped on Windows. PostgreSQL-backed suites ran against an isolated password-protected PostgreSQL 18 cluster, including the new breakdown/reorg test. The documentation production build passed. The temporary database server was stopped after verification. No npm publish, hosted migration, full-history replay or live settlement was performed.
