# Zeer Chef

Chef turns Prep data into an application-specific database and GraphQL API. Write TypeScript handlers, define your entities, and run the indexer on your machine or server.

## You own the application model

| File | Responsibility |
| --- | --- |
| `chef.config.ts` | Project identity, source range, schema and handlers |
| `schema.graphql` | Entity names, scalar fields and optional equality indexes |
| Handler code | Deterministic entity updates from blocks, transactions or authorized receipts |

Chef validates source headers and commits application entities, the checkpoint and undo information together. The API can serve a committed prefix while historical indexing continues. It reports the checkpoint so consumers can distinguish partial history from catch-up.

## Choose your data path

- **Blocks:** summaries and per-block application state.
- **Transaction metadata:** filtered, lightweight public projections.
- **Decoded transactions:** handlers that need the full stored public structure.
- **Authorized receipts:** the opt-in local watch-only testnet scanner and private memo workflow.

Shielded & Memos is a Chef feature. The public hosted Chef playground demonstrates public entities; it does not accept viewing keys or expose a developer's private inbox.

## Start locally

The quickstart creates an independent project with optional local PostgreSQL configuration. Node 24.14+ and Linux x86_64 or WSL2 are required for the documented path. Packages currently install from tarballs built from the repository.

[Run your first Chef project](/docs/chef/quickstart/) or [choose an example](/docs/chef/examples/).
