# Transparent address analytics

Build address history and observed totals with **Chef 0.6.1**. Prep supplies public transactions; the handler resolves transparent inputs from previously indexed outputs, writes one activity per address and transaction, and exposes summaries through GraphQL.

## Run

Copy this directory into your own project, install dependencies, then generate types:

```sh
pnpm install
pnpm run codegen
pnpm run typecheck
pnpm test
```

Set the protected `DATABASE_URL`, `CHEF_API_TOKEN`, and `PREP_URL=https://zeer.endpx.cloud/api/prep` in your environment. Use a fresh database namespace. See the [Chef quickstart](https://zeer.endpx.cloud/docs/chef/quickstart/) for PostgreSQL setup and environment loading.

```sh
pnpm run migrate
# Optional bounded first check: heights 0 and 1, inclusive.
pnpm run sync --to 1
pnpm run serve
```

For the database recovery test, set `CHEF_TEST_DATABASE_URL` to a disposable local database and run `pnpm run test:postgres`. It creates an isolated random namespace and removes it afterward. The fixture verifies that restart preserves state and a rollback restores summaries, activities, coverage and outpoints together. It is a controlled database rollback, not a natural network reorg.

Run `query.graphql` with an indexed transparent address as `$address`. For a full backfill, continue with `pnpm run sync --follow`. The start is deliberately fixed at 0: filtering out funding transactions would make later inputs unresolved. Historical backfill can take time; it is not part of code generation or the fixture test.

For a bounded modern-data experiment, change `startHeight` and use a **new project namespace** before migrating. `Coverage.startHeight` records the first block actually indexed. Inputs funded before that height can remain unresolved; the resulting totals cover the observed range and are not a complete address balance. The [512-block application study](../../docs/PREP_APPLICATION_STUDY_20261024.md) exercises this mode with PostgreSQL, concurrent GraphQL reads and restart.

## Read the result

- `AddressSummary`: exact `receivedZat`/`spentZat`, incoming/outgoing transaction counts, first/last observed block heights. Several outputs or inputs involving one address in one transaction count once. A zero-value output still counts as activity.
- `AddressActivity`: per-transaction amounts, direction flags, height and hash. Follow `nextCursor` with `after`; rebuild the range after `CURSOR_INVALIDATED`, including removals caused by a reorg.
- `ObservedOutput`: durable outpoint identity, amount, script address list and observed spending transaction. Reusing an already spent outpoint fails the handler.
- `Coverage`: processed blocks, last height, unresolved inputs and outputs without a single attributable address. Query `_meta` for Chef's committed checkpoint/readiness.

Only outputs whose decoded script lists **exactly one address** contribute to address totals. Multi-address and unrecognized scripts are retained as outputs but are not credited in full to every listed address. Unresolved inputs increment coverage; their unknown amounts are never converted into attributed zero-value spends. Amounts use BigInt in the handler and decimal strings in GraphQL.

These are **observed transparent totals**, not a wallet balance or proof of identity. They include coinbase outputs without computing spendability or maturity. This example does not calculate fees, infer senders/change, add fiat prices, or read shielded plaintext. Complete balance reporting requires additional UTXO/coverage rules and verification. Chef stores entity changes with the block checkpoint and handles rollback within its configured recovery window; the example test checks handler accounting and the actual GraphQL query, not a live network reorg.
