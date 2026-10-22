# Run your own Chef project

Create a Zcash application with a schema, TypeScript handlers and a GraphQL API. Chef offers three starting points: a blank project, a public chain indexer and a shielded payment inbox. This walkthrough uses the public starter to follow new testnet blocks.

## Prerequisites

- **Node.js 24.14+** and **pnpm**, or npm.
- **Linux x86_64**, or **WSL2** on Windows.
- **PostgreSQL**, or Docker Engine with Compose v2 for the generated local database.

## 1. Initialize your indexer

For a one-time setup without installing the CLI globally:

```sh
pnpm --package=@zeer-dev/chef@0.3.0 dlx zeer init
```

The explicit executable name selects `zeer` from the package's two compatible aliases. With npm, use `npx @zeer-dev/chef@0.3.0 init`.

Accept the defaults or enter your own values:

```text
Template: 1 Blank project, 2 Public chain indexer, 3 Shielded payment inbox (public):
Project name (my_indexer):
Project folder (my-indexer):
Prep endpoint (https://zeer.endpx.cloud/api/prep):
Start block: latest indexed or a height (latest):
```

Choose `2` or `public` for this walkthrough. The choices contain:

| Starter | What you get |
| --- | --- |
| **Blank project** | Config, an empty entity schema and handler module, environment files, PostgreSQL recipe and project scripts. Define your own model and handlers before indexing. |
| **Public chain indexer** | A `BlockSummary` model with height, hash, time and transaction count; block and transaction-metadata handlers; a GraphQL query to inspect results. No wallet or viewing key is required. |
| **Shielded payment inbox** | A `ReadableNote` model, receipt handler, memo queries, pinned scanner installer and restartable SQLite consumer. It requires your own protected local testnet viewing key and an explicit numeric wallet birthday. Follow [Local viewing-key setup](/docs/chef/shielded/local/). |

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

## Start with your own model

Choose `1` or `blank` to begin without sample entities. Install dependencies and run `pnpm run typecheck`; the empty project can typecheck before code generation. Add entities to `schema.graphql`, each with `id: ID!`, then run `pnpm run codegen`. Implement your application handlers in `handlers.ts` before migrating and indexing. The CLI explains what is missing if the schema or indexer is empty.

Blank and public projects default to `latest`. A shielded inbox asks for a numeric birthday with no default: starting after a payment's block would miss that note. Init never reads a key, installs dependencies or starts a service.

For a globally installed CLI, use `pnpm add -g @zeer-dev/chef@0.3.0` once, then `zeer init`. For unattended setup, provide `--template public --dir my-indexer --project my_indexer --start-height latest --json`. See the [CLI reference](/docs/chef/cli-commands/) for every supported command and [Performance](/docs/chef/benchmarking/) for measurement.
