# Testing your indexer

Verify what your handlers store, not only that a process starts. Use a small pinned range and compare entity values and checkpoints with independently read source data.

## Run framework checks from the checkout

```sh
npm ci
npm run build:chef
npm run test:chef
```

The suite includes unit and integration cases. Database/native cases require explicit environment configuration; skipped cases are not live integration evidence. Review the [package test files](https://github.com/EndPx/zeer/tree/main/packages/chef/test) before providing a database, and use isolated test namespaces.

## Validate your application projection

1. Record the source network, coverage and a target height/hash.
2. Generate types and run the project's TypeScript check.
3. Migrate a fresh project namespace and index a bounded range.
4. Query every expected entity and compare exact IDs, values and checkpoint metadata.
5. Restart the same compatible configuration and confirm that committed work is not duplicated.
6. Exercise failure/recovery and any reorg behavior your deployment relies on.

Do not use the same handler implementation as its own expected-output oracle. A matching row count alone can miss wrong values or duplicate identities.

## Private receipt tests

The shielded inbox contains memo classification tests and native/SQL integration instructions. Use [the documented local commands](/docs/chef/shielded/local/) and your own isolated key/database configuration. Public fixture keys and seeds are test material, never accounts for funds.

## Performance evidence

Separate raw Prep reads from Chef's durable entity commits and GraphQL query latency during ingest. Record source range, selected fields, handlers, database, memory/CPU ceilings and exact output checks. A small historical test or a UI response time does not establish a whole-chain indexing duration.
