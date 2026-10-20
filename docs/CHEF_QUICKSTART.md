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

- Linux x86_64 or WSL2; Node 24.14+ and npm.
- A compatible Prep endpoint and token if the operator requires one.
- Your own PostgreSQL database; the starter also includes optional local Docker
  Compose configuration. Docker Engine and Compose v2 are needed only for that option.
- Both Zeer package tarballs. They are **unpublished**; plain `npm install
  @zeer/chef` is not the current installation path.

## 1. Prepare the package artifacts

From the Zeer checkout:

```sh
npm ci
mkdir -p .tmp/chef-packages
npm pack ./packages/prep-client --pack-destination .tmp/chef-packages
npm pack ./packages/chef --pack-destination .tmp/chef-packages
```

Chef builds during packing. Record the absolute paths of both tarballs. The
[packaging verifier](PACKAGING.md) checks package contents and standalone imports.

## 2. Create a standalone project

Using the built CLI from the checkout (or an already installed `zeer-chef` binary):

```sh
node packages/chef/dist/cli.js init \
  --dir /absolute/path/to/my-zcash-indexer \
  --project my_zcash_indexer \
  --start-height 0
```

The directory must not already exist. Its parent must exist and be writable.
Choose a start height within your Prep archive. The full-data starter supports
genesis height 0; another provider may expose a later starting range.

Init creates an independent package, testnet config, BlockSummary schema/handlers,
strict TypeScript config, a query example, local Postgres Compose config and a
README. It generates unique local database/API secrets in git-ignored `.env`
(mode 0600 on POSIX). It makes no network requests and starts no services.

The starter counts transactions through `transactionMetadata`, so it does not
download decoded bodies. Its explicit `sync` settings fetch up to 1,000 blocks
per page and commit 32 at a time. A failed batch rolls back in full. Existing
configs without these settings retain their previous defaults.
For an application that only needs matching transactions, use the
[filtered genesis example](../examples/chef-filtered/README.md). It applies the
public filter at Prep and stores only matches, while validating every header.

Inside the new project, install the two tarballs together:

```sh
npm install /absolute/path/to/zeer-prep-client-0.1.0.tgz /absolute/path/to/zeer-chef-0.1.0.tgz
npm run codegen
npm run typecheck
```

No files are imported from the Zeer checkout. Keep the generated lockfile with
your project. Type stripping does not replace explicit typechecking.

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
npm run db:up
```

Postgres binds loopback port 39472, with persistent project-scoped storage. If the
port is occupied, update both Compose and DATABASE_URL. Multiple starter projects
need distinct Compose names and host ports. The template's resource ceilings are
0.5 CPU / 512 MiB for Postgres, not a limit on your whole Chef application.

## 4. Index and serve GraphQL

```sh
npm run migrate
npm run status
```

Use an available inclusive end height. Omit `--to` to capture Prep's current
indexed height. `migrate` creates a project namespace, not the database server.
Status compares source coverage with the persisted checkpoint. A new empty
project may be ready to backfill; it is not caught up merely because it connects.

Start the API in terminal A so it can serve each committed prefix immediately:

```sh
npm run serve
```

Start indexing in terminal B, using the same config and environment:

```sh
npm run sync -- --to 1002
# Or follow new blocks after historical catch-up:
# npm run follow
```

Run a query in terminal C while indexing is active:

```sh
npm run query
```

These are separate Node processes. Both use the same PostgreSQL project; only
sync/follow acquires the writer lock. Do not run sync and follow concurrently for
the same project. `_meta.height` identifies the committed prefix currently served.
A prefix can be useful before catch-up finishes, but it is not complete history.
The API may return a temporary unavailable response during source reconciliation.

This executes `query.graphql` against `http://127.0.0.1:39370/graphql` with the
generated token. Entity results must match the indexed source; `_meta` reports
the persisted checkpoint. Responses return BigInt values as decimal strings.
Lists sort by ID; use an equality filter on `height` for a particular block.

For ongoing indexing, run `npm run follow` separately alongside `npm run serve`.
Ctrl+C stops each process. The next sync resumes from PostgreSQL; repeating a
completed range should commit no new blocks. `npm run db:stop` retains local data.

## Scope and recovery

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
