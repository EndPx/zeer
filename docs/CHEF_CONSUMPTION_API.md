# Chef application-consumption API (0.2.0)

The user-facing contract and examples live in [Querying with GraphQL](../apps/docs/content/chef-graphql.md). This implementation note records the migration and consistency boundaries.

This contract was introduced in 0.2.0 and remains in Chef 0.6.0. The [0.6.0 relationship and transaction breakdown extension](TRANSACTION_BREAKDOWN.md) adds bounded nested reads and lists without replacing these range, cursor or freshness rules. Historical verification counts below retain their original version.

- Equality `where` arguments are preserved. New `range` arguments avoid changing their scalar input types. Initial ordered/range scope is required `Int! @index` and primary ID. A bounded page returns at most 100 entities, fetched with a 101-row lookahead and SQL keysets rather than offsets.
- Ordering is an indexed Int and same-direction ID tie-breaker, or ID alone. Numeric JSONB values use the existing `(data -> field, id)` partial B-tree. BigInt remains an exact decimal string, never a lexical numeric range.
- HMAC-SHA256 cursors bind the normalized entity/filter/range/order to project generation, revision and checkpoint. Page size and response projection may change. The API token signs cursors; rotation requires restarting pagination. Invalid continuations return HTTP 409 `CURSOR_INVALIDATED` with current metadata and no partial response. Raw-ID continuations from 0.1.x must restart.
- PostgreSQL repeatable-read pins metadata and entity rows for each request. Cross-request historical snapshots are not retained. New atomic batches and rollback invalidate cursors; a checkpoint trigger prevents rollback/replay to the same height/hash from restoring an earlier cursor identity. Failed/no-op writes, read-gate changes and freshness-only updates do not advance the data revision.
- A generation UUID is created on migration or namespace creation. Namespace identity already checks schema, handler/config fingerprint, network and start height. Schema/handler changes still require a new namespace. Revisions are decimal strings to avoid floating-point precision loss.
- `GET /status` uses the same authentication/admission/response limits as GraphQL, reads one state row and bypasses only the entity read gate. Follower observations come from existing Prep metadata reads. Unavailability clears source values; a stopped follower leaves timestamped cached observations for the consumer to age. No RPC or Prep request is made on the status/query path.
- `lastCommitAt` is a database timestamp inside the checkpoint-changing transaction, not an fsync or consensus timestamp. Freshness is not proof of consensus or permission to settle.

## Migration

Stop the project's follower and API, back up the database, install 0.2.0, keep the exact existing config/schema and run `zeer migrate` with that config. Restart writer and reader together. Legacy namespaces receive only additional state columns and a checkpoint revision trigger; entities, checkpoints and undo rows remain in place. Migration of legacy consumption metadata requires the writer lock. The namespace marker advances to version 2. An old migration binary refuses that marker; do not mix old and new processes.

Old projects begin at revision `0` with a new generation, unknown source state and unknown historical last-commit time. Existing rows become queryable immediately after migration, without full replay. Future follower/commit operations populate the observations. Adding an index annotation is a separate identity change and does not become an in-place schema migration.

Custom stores may retain their existing handler/runtime interfaces but cannot serve safe list pagination until `ReadView.consumption` and range/order keysets follow this contract. Missing snapshot metadata closes list queries with 503. Implement `consumptionStatus` for the cached status endpoint and `recordSourceObservation` to persist follower observations. By-ID reads retain their previous behavior.

Durable change feeds, retained snapshot pagination, generic BigInt ranges and external settlement side effects are deferred. No ZeeSwap order or payout logic belongs in this API.

## Verification

`npm run build:chef` and `npm run test:chef` exercise CLI, schema, cursor validation and HTTP behavior. With `CHEF_TEST_DATABASE_URL` set to an isolated disposable PostgreSQL database, the integration suite checks tied random-order IDs in both directions, query/identity changes, committed and failed batches, rollback/replay ABA, repeatable-read concurrency, cached freshness during gates, additive migration and index-plan selection. The native scanner test additionally requires `ZEER_SCANNER_TEST_EXECUTABLE`; report that separately when absent. These checks do not remeasure the earlier 0.1.3 live latency results.

Recorded 21 October 2026: **86 local unit/CLI/HTTP tests passed**, plus **37 isolated PostgreSQL integration tests** and **5 web pagination tests**. The PostgreSQL run skipped one native-scanner integration requiring its executable; local external-service skips are not counted as passes. The tarball passed an isolated install, offline numeric init, code generation and strict generated-project/API typechecks. Both review axes passed after corrections. See [recorded verification metadata](CHEF_CONSUMPTION_VERIFICATION.json). Chef 0.2.0 is now published: the registry latest tag, downloaded tarball integrity and a fresh registry consumer matched the tested candidate. Hosted project upgrades are separate.
