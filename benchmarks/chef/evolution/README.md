# Schema/handler shadow replay proof

This is a PostgreSQL acceptance harness for the existing manual namespace
workflow designed in [SCHEMA_EVOLUTION.md](../../../docs/SCHEMA_EVOLUTION.md).
Its input is an explicitly synthetic four-block public source. PostgreSQL and
GraphQL are real; this is not a node, consensus or read-router test.

Use Node 24.14+ with dependencies and Chef build ready. Select a disposable
PostgreSQL database with `CHEF_TEST_DATABASE_URL`; the harness refuses missing
database configuration instead of skipping the gate. Provision/stop that database
through its own bounded experiment procedure. It should not contain application
data or production credentials.

```sh
npm ci
npm run build:chef
# CHEF_TEST_DATABASE_URL supplied through the experiment environment.
node benchmarks/chef/evolution/verify.mjs \
  --output benchmarks/results/evolution-$(date -u +%Y%m%dT%H%M%SZ)
```

The harness creates the parent `benchmarks/results` directory if needed; the
requested run directory must be new. Results remain ignored/local. This proof
does not publish a report.

The harness creates two unique `ev_<random>_v1/v2` project namespaces, binds two
authenticated GraphQL servers on ephemeral loopback ports and validates:

1. V1 replays to a pinned height/hash/epoch with exact values above JavaScript's
   safe integer boundary.
2. Same-namespace schema and handler-fingerprint changes are rejected and leave
   v1 unchanged. Programmatic fingerprints here are explicit test identities;
   the CLI additionally hashes its documented configuration inputs.
3. V2 adds required fields and changes projection semantics. An injected handler
   interruption rolls back the failed block, verifies the complete two-row prefix
   and both exact aggregates, and leaves v1 intact. The injection is a test control, not a deployment that
   changes code under a retained production fingerprint.
4. Resumed v2 results match literal independently specified expected rows and
   totals, and its new GraphQL fields work while the v1 contract rejects them with
   HTTP 400. Both servers reject unauthenticated requests with HTTP 401. Repeating
   replay commits zero blocks.
5. A reachable unready source and network mismatch gate the v2 API with 503;
   recovery uses normal sync, not manual state edits.
6. An epoch-only change with unchanged block hash invalidates approval; a new pin
   becomes eligible without modifying entities. A later synthetic canonical branch
   change invalidates that new pin. Normal sync removes orphan effects and verifies
   complete replacement rows and exact v2 totals against literal expected values.
7. A stopped v1 remains ready but fails current-pin eligibility. Its writer must
   reconcile before it is eligible as a rollback target; complete v1 replacement
   rows and total must match their own literal oracle.

`acceptance.json` records PASS/FAIL, stage snapshots, selected project names and
scope. Missing acceptance or a FAIL does not pass this gate. Both schemas are
retained deliberately for inspection even after a passing run; the harness closes
its own API and PostgreSQL connections. Its validation helper evaluates a pinned
checkpoint; it is not a shipped readiness lease, cutover command or router.

If cleanup is needed, inspect the recorded names and remove only those exact
disposable experiment schemas from the selected database. Do not enumerate/drop
other namespaces or globally prune Docker resources. Retain failed proof records.
