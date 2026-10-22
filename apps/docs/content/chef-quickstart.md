# Run your own Chef project

Create a Zcash application with a schema, TypeScript handlers and a GraphQL API. This guide targets Chef 0.6.1 and its three starting points: a blank project, a public chain indexer and a shielded payment inbox. This walkthrough uses the public starter to follow new testnet blocks.

## Prerequisites

- **Node.js 24.14+** and **pnpm**, or npm.
- **Linux x86_64**, or **WSL2** on Windows.
- **PostgreSQL**, or Docker Engine with Compose v2 for the generated local database.

## 1. Initialize your indexer

For a one-time setup without installing the CLI globally:

```sh
pnpx @zeer-dev/cli init
```

`pnpx` runs the `@zeer-dev/cli` package without a global installation. `pnpm dlx @zeer-dev/cli init` is equivalent; npm users can run `npx @zeer-dev/cli@latest init`. To explicitly select the latest release tag, use `pnpx @zeer-dev/cli@latest init`. pnpm manages its download cache; existing generated projects keep their pinned SDK version.

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

If using an existing PostgreSQL database, set `DATABASE_URL` instead and skip `db:up`. Check the setup:

```sh
pnpm run doctor
```

Doctor checks the project, Prep source, database namespace, API token and listen port. A fresh project's `MIGRATION_REQUIRED` result means the database is reachable but its Chef namespace needs initialization. Doctor only reports what it finds; it does not create tables or start services.

## 3. Run and query

Start the API and follower together:

```sh
pnpm run dev --migrate
```

On the first run, `--migrate` explicitly allows Chef to initialize a compatible namespace. Dev generates entity types, checks the project's TypeScript, then checks the setup before starting the API and follower. It does not install dependencies or start PostgreSQL. For later runs, use `pnpm run dev`; you can also run `pnpm run migrate` separately before it.

Query your entities in another terminal:

```sh
pnpm run query
```

The response contains `BlockSummary` records from the configured start through the committed checkpoint. Immediately after a latest setup there may be only one block. `_meta.height` identifies what has actually committed. The API listens on `127.0.0.1:39370` and serves committed data while indexing continues. Ctrl+C stops both processes and retains committed progress. If either process exits unexpectedly, dev stops the other and reports a failure.

`follow` and `serve` remain available for running the writer and API independently. Run only one writer per project. For setup failures, use `pnpm run doctor --json` for structured checks and the [CLI reference](/docs/chef/cli-commands/) for recovery guidance.

## Historical indexing

For a new historical project, choose `0` during setup. To index only blocks 0 and 1, run `pnpm run migrate`, then `pnpm run sync --to 1` instead of dev. Start `pnpm run serve` separately to query that bounded result. With npm the sync equivalent is `npm run sync -- --to 1`.

Changing an existing project's start height changes its identity. Create a fresh project namespace and replay rather than editing the retained checkpoint. Read [restart and reorg handling](/docs/chef/recovery/) for compatible continuation.

## Start with your own model

Choose `1` or `blank` to begin without sample entities. Install dependencies and run `pnpm run typecheck`; the empty project can typecheck before code generation. Add entities to `schema.graphql`, each with `id: ID!`, then run `pnpm run codegen`. Implement your application handlers in `handlers.ts` before migrating and indexing. The CLI explains what is missing if the schema or indexer is empty.

Blank and public projects default to `latest`. A shielded inbox asks for a numeric birthday with no default: starting after a payment's block would miss that note. Init never reads a key, installs dependencies or starts a service.

For unattended setup, use `pnpx @zeer-dev/cli@0.6.1 init --template public --dir my-indexer --project my_indexer --start-height latest --json`. An exact launcher version makes automation repeatable. With npm, forward dev options as `npm run dev -- --migrate`. See the [CLI reference](/docs/chef/cli-commands/) for cache refresh and other commands, and [Performance](/docs/chef/benchmarking/) for measurement.
