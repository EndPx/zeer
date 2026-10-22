# Chef CLI commands

The `@zeer-dev/chef` package installs `zeer` and its compatible alias `zeer-chef`. The commands create projects, check their setup, generate types, migrate a compatible namespace, index data and serve GraphQL. In a generated project, `pnpm run dev` manages the API and follower together.

## Install and inspect

Requires Node.js 24.14+ on Linux x86_64 or WSL2. Run without a global installation:

```sh
pnpx @zeer-dev/cli init
pnpx @zeer-dev/cli --version
pnpx @zeer-dev/cli --help
```

`pnpm dlx @zeer-dev/cli init` is equivalent. npm users can run `npx @zeer-dev/cli@latest init`. The `zeer` launcher uses the matching published Chef CLI, including the same wizard and error handling. The SDK remains `@zeer-dev/chef`; generated projects declare their own exact dependency.

`pnpx @zeer-dev/cli@latest init` selects npm's `latest` tag. pnpm may reuse its dlx cache, so this is not an unconditional check for a new release on every invocation. On pnpm 10+, use `pnpx --config.dlx-cache-max-age=0 @zeer-dev/cli@latest init` for a fresh dlx resolution. Older pnpm releases can use the normal command; the cache-refresh flag is version-dependent. Keep an exact version such as `pnpx @zeer-dev/cli@0.6.0 init` for reproducible scripts. Launcher and Chef versions are published together.

An existing global `zeer` / `zeer-chef` command remains usable. The commands below show that executable form; prefix them with `pnpx` when using the launcher, for example `pnpx @zeer-dev/cli status --config chef.config.ts`.

For any command, `zeer <command> --help` prints its options without loading project configuration or contacting services. `zeer --version` prints the installed package version.

## Command overview

| Command | Action |
| --- | --- |
| `init` | Ask for missing setup options and create a new testnet project |
| `codegen` | Generate `chef.generated.ts` from the entity schema |
| `doctor` | Read setup diagnostics without changing the project or database |
| `dev` | Generate types, typecheck, check setup, then run API and follower together |
| `dev --migrate` | Explicitly permit compatible namespace migration before starting dev |
| `migrate` | Explicitly initialize/migrate a compatible project namespace and its indexes |
| `sync` | Index through a captured available Prep tip, then exit |
| `sync --to HEIGHT` | Index through an inclusive target height, then exit |
| `sync --follow` | Continue indexing and poll for new blocks |
| `status` | Read the saved checkpoint and observe source coverage |
| `serve` | Serve authenticated GraphQL over committed entities |

## init

```sh
zeer init
```

Guided setup asks for a template, project name, folder, Prep endpoint and start block. Select `1` / `blank`, `2` / `public`, or `3` / `shielded`. Enter selects the public starter. Supplied flags are retained and only missing options are asked.

| Template | Generated application |
| --- | --- |
| `blank` | Empty schema and handler module, config, environment, PostgreSQL recipe and scripts. Define your model and handlers before indexing. |
| `public` | `BlockSummary` entities, block and transaction-metadata handlers, and a sample GraphQL query. |
| `shielded` | `ReadableNote` receipt entities, memo queries, pinned scanner installer and continuous SQLite consumer. Configure your own local viewing-key file separately. |

| Option | Default / rule |
| --- | --- |
| `--template blank\|public\|shielded` | Starter selection; fully supplied scripts that omit it retain the public default |
| `--dir DIR` | New target folder; never overwrite an existing file, directory or symlink |
| `--project NAME` | Lowercase letter followed by lowercase letters, digits or underscores; at most 32 characters |
| `--start-height latest` | Capture Prep's available indexed height once and persist the numeric value |
| `--start-height HEIGHT` | Explicit inclusive start, from 0 through 4294967294; no metadata lookup |
| `--prep-url URL` | Source selection before `PREP_URL`; defaults to the public testnet Prep URL |
| `--json`, `--human` | Structured or readable output; mutually exclusive |

Blank and public guided setup default to `latest`. The shielded template requires an explicit numeric wallet birthday and rejects `latest`; choose a height at or before the notes you need. Starting later misses older notes.

Latest lookup requires a ready `full-v1` testnet archive and has a **5-second** timeout. It selects the indexed archive height, not an unindexed source tip. A failed lookup does not fall back to genesis. Explicit numeric heights support offline initialization; runtime still checks source compatibility and coverage.

The chosen URL is saved in `.env`. An existing `PREP_API_TOKEN` is used only with an explicitly configured URL, never automatically sent to the default public source, and never copied into generated files or printed. Configure the generated project's private token yourself if needed.

For scripts or AI agents, select a template and provide all three setup values:

```sh
zeer init --template public --dir my-indexer --project my_indexer --start-height latest --json
zeer init --template blank --dir custom-indexer --project custom_indexer --start-height latest --json
zeer init --template shielded --dir payment-inbox --project payment_inbox --start-height 4523000 --json
```

The shielded height above is illustrative: replace it with your wallet's birthday. Existing scripts with `--dir`, `--project` and `--start-height` but no `--template` still create the public starter. Use `--start-height 0` for a deterministic genesis project. `--json` and non-terminal sessions never prompt. Ctrl+C or end-of-input while answering or looking up the height cancels before scaffolding. Init creates project files; it does not load a viewing key, install dependencies, start Docker, migrate a database or begin indexing.

## codegen

```sh
zeer codegen --config chef.config.ts
```

Read the TypeScript config and GraphQL schema, then write `chef.generated.ts` beside the config. No Prep or database connection is needed. Code generation does not typecheck your handlers; run the project's `typecheck` script separately.

The blank starter can typecheck while still empty. Add entity types with `id: ID!` before codegen, then implement handlers in `handlers.ts` before indexing. In a shielded project, use `pnpm run codegen`: its script loads the local account identity from `.env`.

## migrate

```sh
pnpm run migrate
```

The generated script loads `.env`. Migration validates namespace ownership and identity, then initializes or upgrades its compatible tables and declared indexes. It does not replay history, drop a namespace or make an incompatible schema safe to reuse. Use [a fresh project and replay](/docs/chef/evolution/) for identity changes.

## doctor

```sh
pnpm run doctor
pnpm run doctor --json
```

Check the configured project before starting it. Doctor uses bounded reads to inspect the model and handlers, Prep compatibility and coverage, PostgreSQL namespace identity, API token and requested listen port. A shielded project also checks its local scanner and configured viewing-key identity. Key inspection runs locally; neither a key nor a decoded receipt is sent to Prep.

Each check has a status, a fixed diagnostic code and a suggested next action. JSON output includes `ready`, `status` and a `checks` array, so scripts can distinguish a failed check from one skipped because an earlier dependency was unavailable. Failed checks return a nonzero exit code. A warning can describe recoverable reconciliation without declaring the project blocked.

Doctor does not generate code, migrate tables, acquire the writer lock, change a read gate, start Docker or install packages. It checks the observed setup; a successful result does not reserve the port, prove another writer is absent or guarantee that the source stays available.

For a fresh project, `MIGRATION_REQUIRED` means migration is still needed. Run `pnpm run migrate`, or explicitly allow it with `pnpm run dev --migrate`. Identity mismatches and blocked namespaces need the [recovery procedure](/docs/chef/recovery/), rather than an automatic reset.

## dev

```sh
# First run against the intended new namespace:
pnpm run dev --migrate
# Continue a prepared project:
pnpm run dev
```

Dev first writes the generated entity types and runs the installed project's TypeScript compiler when `tsconfig.json` exists. A JavaScript-only project without that file reports typechecking as skipped; configuration and handler validation still apply. With a TypeScript project, install its declared development dependencies before running dev.

After setup checks pass, dev starts GraphQL, waits for it to listen, then starts the follower. Both use the same installed Chef version, configuration and environment. The API defaults to `127.0.0.1:39370`; the follower retains the normal polling and recovery behavior. The generated scripts load the project's `.env`.

`--migrate` permits the existing migration path only when missing migration is the sole blocking check. It never resets an incompatible or unmarked namespace, forces a blocked read gate open or replaces existing application data. A compatible namespace does not need another migration. Dev does not start PostgreSQL or install dependencies.

Ctrl+C or SIGTERM stops both child processes, retaining committed work. If either child exits unexpectedly, dev stops its peer and exits with a failure. Startup checks cannot eliminate races: a port claimed after inspection or an existing writer still causes startup to fail. Run only one dev/follow/sync writer for a project.

Use `serve` and `follow` separately for independently managed processes. Dev is a local process supervisor; it does not install an operating-system service or provide a deployment manager.

| Option | Commands | Default / rule |
| --- | --- | --- |
| `--listen HOST` | `doctor`, `dev`, `serve` | `127.0.0.1` |
| `--port PORT` | `doctor`, `dev`, `serve` | `39370`; integer from 1 through 65535 |
| `--poll-seconds SECONDS` | `dev`, `sync --follow` | `5`; integer from 1 through 60 |
| `--migrate` | `dev` | Off; explicitly permits compatible migration when it is the only blocker |

## sync

```sh
pnpm run sync
pnpm run follow --poll-seconds 1
```

Without a target, finite sync captures the available Prep tip and exits after reaching it. `--to` is inclusive and cannot be combined with `--follow`. The target must be at least the configured start and within available coverage. For example, `pnpm run sync --to 4522799` requires a fresh historical project starting at or before that height; it is not a target for a newly initialized latest project. Follow polls every **5 seconds** by default; `--poll-seconds` accepts 1–60.

`pageSize`, `batchSize`, source filters and adaptive scans live in `chef.config.ts`, not CLI flags. Compatible restarts resume the durable checkpoint. Ctrl+C stops with committed progress retained; invocation counters can exclude a committed partial-page prefix. See [Benchmarking](/docs/chef/benchmarking/) for interpreting counters.

## status

```sh
pnpm run status --json
```

Read the durable checkpoint before observing Prep with a **5-second** timeout. Status does not acquire a writer lock or change the database. A source outage, incompatible source or unresolved reconciliation produces a nonzero diagnostic. A zero Chef–Prep gap does not prove the source is at the network head; inspect source freshness and the separate Prep gap. See [Latency at the Head](/docs/chef/latency-at-head/).

## serve

```sh
pnpm run serve --listen 127.0.0.1 --port 39370
```

Serve authenticated read-only GraphQL; the writer runs separately with `sync` or `follow`. Defaults are loopback and port 39370; ports must be 1–65535. `CHEF_API_TOKEN` must contain at least 16 bytes. Ctrl+C stops this server.

## Shared options and exit behavior

| Option | Commands | Rule |
| --- | --- | --- |
| `--config PATH` | All except `init` | Default `chef.config.ts`, relative to the working directory |
| `--json` | All | Structured output; init requires explicit setup options |
| `--human` | All | Readable output; does not force prompting on redirected input |
| `--help` | Root or individual command | Print help without loading project configuration |
| `--version` | Root | Print installed package version |

Without an output flag, terminal output is readable and redirected output is JSON. Successful commands exit with code 0; errors return nonzero. Cancelling init returns 130. Logs omit third-party error details that could contain credentials.

The generated scripts load `.env` and work with pnpm or npm. With npm, put forwarded options after an extra separator: `npm run sync -- --to 4522799 --json`. A direct invocation can load the environment with `node --env-file=.env node_modules/@zeer-dev/chef/dist/cli.js status --json`.

## Background runtime and backups

Chef 0.6.0 starters include these scripts, introduced in 0.5.0. They wrap the project's Docker Compose recipe; they are separate from the `zeer` subcommands above. Keep the pnpm lockfile and configure the project before using them.

| Script | Action |
| --- | --- |
| `pnpm run runtime:build` | Generate types, typecheck and build the pinned application image |
| `pnpm run runtime:migrate` | Explicitly initialize a compatible namespace |
| `pnpm run runtime:check` | Check namespace and source state without reading a viewing key |
| `pnpm run runtime:up` | Start separate follower/API containers using existing images |
| `pnpm run runtime:stop` | Stop follower/API and retain PostgreSQL |
| `pnpm run runtime:status` | Show Compose service state |
| `pnpm run runtime:logs` | Show the latest follower/API log entries |
| `pnpm run db:backup --file backups/chef.dump` | Create a new namespace archive and checksum metadata |
| `pnpm run db:restore --file backups/chef.dump --database chef_restored` | Restore a verified archive into a fresh database |

Use [Self-hosting & backups](/docs/chef/self-hosting/) for database startup, private key mounts, health checks and the required checks before switching to a restored database. Upgrading an existing SDK dependency does not add scaffold files to that project.

## Troubleshooting

| Diagnostic | Next action |
| --- | --- |
| `SHIELDED_BIRTHDAY_REQUIRED` | Choose a numeric wallet birthday at or before the notes you need |
| `INIT_PREP_UNAVAILABLE` | Check the source URL/access, retry, or provide an explicit numeric height |
| `INIT_PREP_NOT_READY` | Inspect `/height` and require a ready full-data testnet source |
| `PROJECT_DIRECTORY_EXISTS` | Choose a new target folder |
| `MIGRATION_REQUIRED` | Run migration with the same project and database |
| `DOCTOR_NOT_READY` | Inspect the failed checks and resolve their individual diagnostic codes |
| `PROJECT_TYPESCRIPT_REQUIRED` | Install the project's declared TypeScript development dependency |
| `TYPECHECK_FAILED` | Run the project's typecheck, fix errors and retry dev |
| `DEV_PREFLIGHT_FAILED` | Resolve the setup failures before starting the API or follower |
| `DEV_API_START_TIMEOUT` | Inspect API startup and whether the configured host/port can listen |
| `DEV_API_EXITED` / `DEV_FOLLOWER_EXITED` | Resolve the reported child failure; dev has stopped its peer |
| `PROJECT_IDENTITY_MISMATCH` | Restore the original config or replay into a fresh namespace |
| `WRITER_ALREADY_ACTIVE` | Stop the other writer for this project |
| `REBUILD_REQUIRED` | Keep the old namespace for inspection and follow the recovery procedure |

Chef currently has no managed deployment, database reset or Prometheus `metrics` command. Use [self-hosting](/docs/chef/self-hosting/), [environment variables](/docs/chef/environment-variables/) and the [performance guides](/docs/chef/benchmarking/) for the supported workflow.

The server also exposes authenticated `GET /status` for [cached freshness metadata](/docs/chef/graphql/#check-freshness-without-calling-rpc). This differs from the CLI `status` command, which actively checks Prep. Upgrades from 0.1.x require stopping the follower and API, running the additive migration with the same config, then restarting both.

Dev and doctor were introduced in 0.4.0 and remain available in 0.6.0. Existing projects keep their dependency and scaffold files until explicitly upgraded. Add missing scripts matching the generated launch command, or invoke the upgraded local CLI with `node --env-file=.env node_modules/@zeer-dev/chef/dist/cli.js dev`. Keep config, schema and namespace identity unchanged for compatible continuation. Adding the new relation/list model requires a fresh namespace and replay; see [project evolution](/docs/chef/evolution/).

If Doctor reports a **readable checkpoint ahead of Prep**, `dev` stops with
`DEV_RECONCILIATION_REQUIRED` before starting the API. Run `pnpm run follow`
to reconcile, stop it after recovery, then restart `dev`. A checkpoint whose
read gate is already closed can recover under `dev`.
