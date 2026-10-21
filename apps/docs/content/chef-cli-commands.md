# Chef CLI commands

The `@zeer-dev/chef` package installs `zeer` and its compatible alias `zeer-chef`. The commands create projects, generate types, migrate a compatible namespace, index data and serve GraphQL.

## Install and inspect

Requires Node.js 24.14+ on Linux x86_64 or WSL2. With a configured pnpm global bin directory, install once:

```sh
pnpm add -g @zeer-dev/chef@0.1.3
zeer --version
zeer --help
zeer init
```

Without a global install, use `pnpm --package=@zeer-dev/chef@0.1.3 dlx zeer init`. The executable name is explicit because the package has two aliases. npm users can use `npm install -g @zeer-dev/chef@0.1.3` or the one-time `npx @zeer-dev/chef@0.1.3 init`.

For any command, `zeer <command> --help` prints its options without loading project configuration or contacting services. `zeer --version` prints the installed package version.

## Command overview

| Command | Action |
| --- | --- |
| `init` | Ask for missing setup options and create a new testnet project |
| `codegen` | Generate `chef.generated.ts` from the entity schema |
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

The terminal asks for project name, folder and start block. Enter accepts `my_indexer`, `my-indexer` and `latest`. Supplied flags are retained and only missing options are asked.

| Option | Default / rule |
| --- | --- |
| `--dir DIR` | New target folder; never overwrite an existing file, directory or symlink |
| `--project NAME` | Lowercase letter followed by lowercase letters, digits or underscores; at most 32 characters |
| `--start-height latest` | Capture Prep's available indexed height once and persist the numeric value |
| `--start-height HEIGHT` | Explicit inclusive start, from 0 through 4294967294; no metadata lookup |
| `--prep-url URL` | Source selection before `PREP_URL`; defaults to the public testnet Prep URL |
| `--json`, `--human` | Structured or readable output; mutually exclusive |

Latest lookup requires a ready `full-v1` testnet archive and has a **5-second** timeout. It selects the indexed archive height, not an unindexed source tip. A failed lookup does not fall back to genesis. Explicit numeric heights support offline initialization; runtime still checks source compatibility and coverage.

The chosen URL is saved in `.env`. An existing `PREP_API_TOKEN` is used only with an explicitly configured URL, never automatically sent to the default public source, and never copied into generated files or printed. Configure the generated project's private token yourself if needed.

For scripts or AI agents, provide all three setup values:

```sh
zeer init --dir my-indexer --project my_indexer --start-height latest --json
```

Use `--start-height 0` for a deterministic genesis project. `--json` and non-terminal sessions never prompt. Ctrl+C or end-of-input while answering or looking up the height cancels before scaffolding. Init creates project files; it does not install dependencies, start Docker, migrate a database or begin indexing.

## codegen

```sh
zeer codegen --config chef.config.ts
```

Read the TypeScript config and GraphQL schema, then write `chef.generated.ts` beside the config. No Prep or database connection is needed. Code generation does not typecheck your handlers; run the project's `typecheck` script separately.

## migrate

```sh
pnpm run migrate
```

The generated script loads `.env`. Migration validates namespace ownership and identity, then initializes or upgrades its compatible tables and declared indexes. It does not replay history, drop a namespace or make an incompatible schema safe to reuse. Use [a fresh project and replay](/docs/chef/evolution/) for identity changes.

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

## Troubleshooting

| Diagnostic | Next action |
| --- | --- |
| `INIT_PREP_UNAVAILABLE` | Check the source URL/access, retry, or provide an explicit numeric height |
| `INIT_PREP_NOT_READY` | Inspect `/height` and require a ready full-data testnet source |
| `PROJECT_DIRECTORY_EXISTS` | Choose a new target folder |
| `MIGRATION_REQUIRED` | Run migration with the same project and database |
| `PROJECT_IDENTITY_MISMATCH` | Restore the original config or replay into a fresh namespace |
| `WRITER_ALREADY_ACTIVE` | Stop the other writer for this project |
| `REBUILD_REQUIRED` | Keep the old namespace for inspection and follow the recovery procedure |

Chef currently has no managed deployment, database reset, `dev` process supervisor or Prometheus `metrics` command. Use [self-hosting](/docs/chef/self-hosting/), [environment variables](/docs/chef/environment-variables/) and the [performance guides](/docs/chef/benchmarking/) for the supported workflow.
