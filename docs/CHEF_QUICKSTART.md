# Run your own Chef project

Chef runs on your development machine or server. It connects to a Prep service
over HTTP(S), processes public Zcash data with your TypeScript handlers, stores
entities in your PostgreSQL database and exposes authenticated GraphQL. The Prep
operator may be Zeer or you; running Chef does not require running Zebra locally.

The current starter targets **Zcash testnet**. Use the [limited public Prep
preview](PUBLIC_API.md) or your own full-data testnet service with known coverage.
Inspect `/height` for current coverage and source readiness.
For a bounded modern testnet replay with live GraphQL and restart steps, use the
[hackathon demo example](../examples/chef-hackathon/README.md). Reviewers can
follow the [public console walkthrough](HACKATHON_DEMO.md).
For a self-contained historical example without an existing source, see the
[fixture quickstart](../examples/quickstart/README.md); that older example uses
explicitly labeled mainnet fixtures and is not a live testnet service.

## Requirements

- Linux x86_64 or WSL2; Node 24.14+ and pnpm (or npm).
- A compatible Prep endpoint and token if the operator requires one.
- Your own PostgreSQL database; the starter also includes optional local Docker
  Compose configuration. Docker Engine and Compose v2 are needed only for that option.
- The published `@zeer-dev/chef` CLI and its Prep client dependency, installed below.

## 1. Create a standalone project

Run the published launcher without a global installation:

```sh
pnpx @zeer-dev/cli init
```

Choose Public chain indexer for this walkthrough, then answer the project name,
folder, Prep endpoint and start block prompts. Enter accepts each public-starter
default (`my_indexer`, `my-indexer`, public Prep, `latest`). Latest captures the selected
Prep archive height once; explicit `0` includes genesis history. The chosen
source URL is recorded in `.env`. npm users can run `npx @zeer-dev/cli@latest init`.
`pnpx @zeer-dev/cli@latest init` explicitly selects the latest launcher tag,
subject to pnpm's dlx cache. For reproducible scripts, use
`pnpx @zeer-dev/cli@0.6.0 init --template public --dir DIR --project NAME --start-height HEIGHT --json`.
The `zeer-chef` command remains an alias. Only terminal sessions ask questions.

The directory must not already exist. Its parent must exist and be writable.
Choose a start height within your Prep archive. The full-data starter supports
genesis height 0; another provider may expose a later starting range.

Latest setup makes one bounded Prep metadata read; an explicit height works offline.
Init creates an independent package, testnet config, BlockSummary schema/handlers,
strict TypeScript config, a query example, local Postgres Compose config and a
README. It generates unique local database/API secrets in git-ignored `.env`
(mode 0600 on POSIX). It starts no services.

The starter counts transactions through `transactionMetadata`, so it does not
download decoded bodies. Its explicit `sync` settings fetch up to 1,000 blocks
per page and commit 32 at a time. A failed batch rolls back in full. Existing
configs without these settings retain their previous defaults.
For an application that only needs matching transactions, use the
[filtered genesis example](../examples/chef-filtered/README.md). It applies the
public filter at Prep and stores only matches, while validating every header.

## 2. Install dependencies

Inside the new project (use your chosen folder if different):

```sh
cd my-indexer
pnpm install
```

No files are imported from the Zeer checkout. Keep the generated lockfile with
your project. Dev generates the schema types and runs the project's TypeScript
compiler before starting services. `pnpm run codegen` and `pnpm run typecheck`
remain available separately. npm users can use `npm install` and `npm run`.

For an unpublished source candidate, the [packaging verifier](PACKAGING.md)
describes building and installing both local tarballs together.

## 3. Configure Prep and PostgreSQL

Edit `.env`: set `PREP_URL`, optional `PREP_API_TOKEN`, and `DATABASE_URL`.
For the shared public preview, use `https://zeer.endpx.cloud/api/prep` and
leave the Prep token blank. Its quotas are shared; use a dedicated/self-hosted
endpoint for sustained high-throughput indexing.
The generated database URL matches the optional local Postgres credentials.
If using remote PostgreSQL, use that service's TLS configuration and skip the
local database command. Keep all connection strings and tokens server-side.

For the included local database:

```sh
pnpm run db:up
```

Postgres binds loopback port 39472, with persistent project-scoped storage. If the
port is occupied, update both Compose and DATABASE_URL. Multiple starter projects
need distinct Compose names and host ports. The template's resource ceilings are
0.5 CPU / 512 MiB for Postgres, not a limit on your whole Chef application.

## 4. Check the setup

```sh
pnpm run doctor
```

Doctor checks the configured project, source compatibility and coverage,
database namespace, API token and listen port. It reports failures with fixed
codes and next actions. A new namespace normally reports `MIGRATION_REQUIRED`:
it has not been initialized yet. Resolve other failures before continuing.
Doctor is read-only; it does not start PostgreSQL, migrate or change a read gate.

## 5. Index and serve GraphQL

On the first run, explicitly permit compatible namespace initialization:

```sh
pnpm run dev --migrate
```

Dev generates types, typechecks and runs setup checks, then starts the API before
the follower. `--migrate` uses the existing migration path only when migration is
the sole blocker. It never resets incompatible or unmarked data. It creates a
project namespace, not the database server. It does not install dependencies or
start Docker. Later runs can use `pnpm run dev` without the migration flag.

Run a query in another terminal while indexing is active:

```sh
pnpm run query
```

Dev manages separate API and follower Node processes using the same PostgreSQL
project; only the follower acquires the writer lock. Do not run another dev,
sync or follow for the same project. `_meta.height` identifies the committed prefix currently served.
A prefix can be useful before catch-up finishes, but it is not complete history.
The API may return a temporary unavailable response during source reconciliation.

This executes `query.graphql` against `http://127.0.0.1:39370/graphql` with the
generated token. Entity results must match the indexed source; `_meta` reports
the persisted checkpoint. Responses return BigInt values as decimal strings.
Lists sort by ID; use an equality filter on `height` for a particular block.

Ctrl+C stops both processes. An unexpected child exit stops its peer and fails
dev. The next run resumes from PostgreSQL. `pnpm run db:stop` retains local data.
With npm, forward dev options as `npm run dev -- --migrate`.

For bounded historical work, prepare the namespace with `pnpm run migrate`, then
use `pnpm run sync --to HEIGHT` and `pnpm run serve` independently. The target is
inclusive and must be within Prep coverage at or after your configured start.
Omit `--to` to capture Prep's available tip once and exit when reached. Repeating
a completed range should commit no new blocks. `pnpm run status` compares the
saved checkpoint with a bounded source observation; connecting successfully
does not mean the project has caught up.

## Scope and recovery

For background operation and database recovery, follow the generated-project
[self-hosting recipe](https://zeer.endpx.cloud/docs/chef/self-hosting/). The 0.5.0 starter adds separate follower/API containers and explicit migration,
backup and restore scripts. The local `dev` workflow above remains available.

The first API provides bounded, read-only queries. WebSocket subscriptions,
introspection, private viewing-key scanning and public hosting are not included
in this public-data walkthrough. The separate opt-in
[shielded inbox](../examples/shielded-inbox/README.md) documents local receipt scanning.
Changing a model/config/handler identity requires a new project namespace and
replay; never reset existing data as a routine onboarding step. See
[operations](OPERATIONS.md) and [schema evolution](SCHEMA_EVOLUTION.md).

## Verification

`examples/chef-starter/verify.mjs` checks an installed starter outside the monorepo
against a prepared testnet Prep service and a disposable PostgreSQL database.
It compares all BlockSummary fields with captured source blocks 1000â€“1002,
checks authentication, stops/restarts the API, resumes indexing and checks a
repeat commits zero blocks. Evidence stays local. This small historical replay
is onboarding proof, not whole-chain scale or live testnet-tip proof.
