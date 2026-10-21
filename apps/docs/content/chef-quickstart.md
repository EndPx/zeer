# Run your own Chef project

Create a Zcash indexer with a schema, TypeScript handlers and a GraphQL API. This quickstart generates a `BlockSummary` project and indexes its first two testnet blocks.

## Prerequisites

- **Node.js 24.14+** and npm.
- **Linux x86_64**, or **WSL2** on Windows.
- **PostgreSQL**, or Docker Engine with Compose v2 for the generated local database.

## 1. Initialize your indexer

Run this in a directory where `my-indexer` does not already exist:

```sh
npx @zeer-dev/chef@0.1.1 init --dir my-indexer --project my_indexer --start-height 0
cd my-indexer
npm install
npm run codegen
npm run typecheck
```

The `my_indexer` project name creates an isolated PostgreSQL schema named `chef_my_indexer` for this indexer's records and progress. Choose a fresh name for each independent indexer.

## 2. Connect Prep and PostgreSQL

In the generated `.env`, set:

```sh
PREP_URL=https://zeer.endpx.cloud/api/prep
PREP_API_TOKEN=
```

Keep the generated `CHEF_API_TOKEN` private. The public testnet Prep preview requires no personal token.

Start the included database:

```sh
npm run db:up
```

If using an existing PostgreSQL database, set `DATABASE_URL` instead and skip `db:up`. With either choice, initialize the namespace:

```sh
npm run migrate
npm run status
```

## 3. Run and query

Run the API in terminal A:

```sh
npm run serve
```

Index blocks 0 and 1 in terminal B:

```sh
npm run sync -- --to 1
```

Query your entities in terminal C:

```sh
npm run query
```

The response contains `BlockSummary` records for heights 0 and 1, with `_meta.height` equal to `1`. The API listens on `127.0.0.1:39370` by default and serves committed data while indexing continues.

To index through Prep's available history and follow new blocks, run `npm run follow` after the bounded sync finishes. Check [source coverage](https://zeer.endpx.cloud/api/prep/height) first.

## Generated files

| File | Purpose |
| --- | --- |
| `chef.config.ts` | Source, start height and TypeScript handlers |
| `schema.graphql` | `BlockSummary` entity definition |
| `chef.generated.ts` | Types produced by `codegen` |
| `.env` | Private source, database and API configuration |
| `compose.yaml` | Optional local PostgreSQL |
| `query.graphql` / `query.mjs` | Example query and authenticated runner |

## Next steps

- [Configure your source and handlers](/docs/chef/configuration/).
- [Define your own entities](/docs/chef/schema/) and [query them](/docs/chef/graphql/).
- [Read shielded receipts and memos locally](/docs/chef/shielded/local/).
- [Use Quickstart with AI](/docs/chef/quickstart-ai/).
- [Explore block handlers](/docs/chef/block-handlers/) or look up [CLI commands](/docs/chef/cli-commands/).
