# Run your own Chef project

Create a Zcash indexer with a schema, TypeScript handlers and a GraphQL API. This quickstart starts near Prep's available testnet head and follows new blocks.

## Prerequisites

- **Node.js 24.14+** and **pnpm**, or npm.
- **Linux x86_64**, or **WSL2** on Windows.
- **PostgreSQL**, or Docker Engine with Compose v2 for the generated local database.

## 1. Initialize your indexer

For a one-time setup without installing the CLI globally:

```sh
pnpm --package=@zeer-dev/chef@0.2.0 dlx zeer init
```

The explicit executable name selects `zeer` from the package's two compatible aliases. With npm, use `npx @zeer-dev/chef@0.2.0 init`.

Accept the defaults or enter your own values:

```text
Project name (my_indexer):
Project folder (my-indexer):
Start block: latest indexed or a height (latest):
```

`latest` reads the chosen Prep service once and writes its available indexed height as a number in `chef.config.ts`. The CLI prints the captured height. It does not select the node's possibly higher source tip or change the configured start on restart. Choose `0` to include genesis history. If Prep cannot provide a ready full-data testnet height, setup explains the failure without creating project files.

The folder must not already exist. Inside it:

```sh
cd my-indexer
pnpm install
pnpm run codegen
pnpm run typecheck
```

Use your chosen folder if different. `my_indexer` creates the isolated PostgreSQL namespace `chef_my_indexer`. Keep the generated `pnpm-lock.yaml` with the project. If using npm, use `npm install` and the matching `npm run` commands with `package-lock.json` instead.

## 2. Connect Prep and PostgreSQL

The CLI records the selected Prep URL in `.env`. Its default is:

```sh
PREP_URL=https://zeer.endpx.cloud/api/prep
PREP_API_TOKEN=
```

To select your own source during initialization, use `--prep-url URL` or `PREP_URL`. `PREP_API_TOKEN` is sent only when a source is explicitly configured and is not copied into the generated project. Set it locally if your service requires it. The public testnet preview needs no personal token.

Keep the generated `CHEF_API_TOKEN` private. Start the included database:

```sh
pnpm run db:up
```

If using an existing PostgreSQL database, set `DATABASE_URL` instead and skip `db:up`. Initialize the namespace:

```sh
pnpm run migrate
pnpm run status
```

## 3. Run and query

Run the API in terminal A:

```sh
pnpm run serve
```

Follow available blocks in terminal B:

```sh
pnpm run follow
```

Query your entities in terminal C:

```sh
pnpm run query
```

The response contains `BlockSummary` records from the configured start through the committed checkpoint. Immediately after a latest setup there may be only one block. `_meta.height` identifies what has actually committed. The API listens on `127.0.0.1:39370` and serves committed data while indexing continues.

## Historical indexing

For a new historical project, choose `0` during setup. To index only blocks 0 and 1, run `pnpm run sync --to 1` instead of `follow`. With npm the equivalent is `npm run sync -- --to 1`.

Changing an existing project's start height changes its identity. Create a fresh project namespace and replay rather than editing the retained checkpoint. Read [restart and reorg handling](/docs/chef/recovery/) for compatible continuation.

For a globally installed CLI, use `pnpm add -g @zeer-dev/chef@0.2.0` once, then `zeer init`. See the [CLI reference](/docs/chef/cli-commands/) for every supported command, [Performance](/docs/chef/benchmarking/) for measurement, or [Local viewing-key setup](/docs/chef/shielded/local/) for private receipts.
