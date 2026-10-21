# Chef CLI commands

The `@zeer-dev/chef` npm package installs the **`zeer`** executable, with `zeer-chef` as a compatible alias. It creates projects, generates entity types, runs indexing and serves GraphQL.

## Install and initialize

Requires Node.js 24.14+ on Linux x86_64 or WSL2. Initialize a new directory with the published CLI:

```sh
npx @zeer-dev/chef@0.1.2 init
cd my-indexer
npm install
npx zeer --help
```

The setup asks three questions. Press Enter to accept each default:

```text
Project name (my_indexer):
Project folder (my-indexer):
Start block (0):
```

For the shorter command on future projects, install the CLI globally once:

```sh
npm install -g @zeer-dev/chef@0.1.2
zeer init
```

For scripts and AI agents, supply all options so no questions are needed:

```sh
npx @zeer-dev/chef@0.1.2 init --dir my-indexer --project my_indexer --start-height 0 --json
```

`--json` and non-terminal sessions never prompt. In a terminal, supplied options are kept and only missing options are asked. Invalid names and heights are explained and requested again. Ctrl+C or end-of-input cancels before any project files are created.

`init` creates files only. It refuses an existing target directory and does not install packages, start Docker or connect to a database. Follow the [quickstart](/docs/chef/quickstart/) to configure and run the generated project.

## Commands

| Command | Action |
| --- | --- |
| `init` | Guided setup for a new standalone testnet project |
| `init --dir DIR --project NAME --start-height HEIGHT` | Create the same project with explicit options for scripts |
| `codegen` | Read the config and schema; write `chef.generated.ts` beside the config |
| `migrate` | Initialize or migrate this compatible project's PostgreSQL namespace |
| `sync` | Index through a captured available Prep tip, then exit |
| `sync --to HEIGHT` | Index through an inclusive target height, then exit |
| `sync --follow` | Continue indexing and poll for new Prep blocks |
| `status` | Read the saved checkpoint and source coverage without changing the database |
| `serve` | Serve authenticated GraphQL over committed entities |

## Options

| Option | Commands | Default / rule |
| --- | --- | --- |
| `--config PATH` | All except `init` | `chef.config.ts`, relative to the working directory |
| `--json` | All commands | Structured output |
| `--human` | All commands | Readable output; cannot be combined with `--json` |
| `--to HEIGHT` | `sync` | Inclusive height; cannot be combined with `--follow` |
| `--follow` | `sync` | Continue until interrupted |
| `--poll-seconds N` | `sync` | `5`; integer from `1` to `60`, used while following |
| `--listen HOST` | `serve` | `127.0.0.1` |
| `--port PORT` | `serve` | `39370` |

Without an output flag, terminals get readable output and redirected output gets JSON. Use `--json` explicitly for scripts. `status` bounds its Prep metadata request to five seconds; a ready checkpoint does not by itself mean the source has been checked successfully.

## Run a project

The generated npm scripts load `.env` and invoke the installed CLI:

```sh
npm run codegen
npm run typecheck
npm run migrate
npm run sync -- --to 1
npm run status
```

For continuous operation, run these in separate terminals:

```sh
npm run follow
```

```sh
npm run serve
```

Press Ctrl+C to stop a process. Restarting a compatible project resumes its committed checkpoint. Configuration, schema or handler changes can require [a new namespace and replay](/docs/chef/evolution/); `migrate` does not make an incompatible project generation safe to reuse.

See [environment variables](/docs/chef/environment-variables/) for direct invocation with `node --env-file`. The CLI has no `dev`, `deploy`, `stop` or wallet-signing command.
