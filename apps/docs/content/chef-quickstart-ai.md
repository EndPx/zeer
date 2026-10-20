# Quickstart with AI

Build a standalone Chef project with your coding assistant. The first goal is a small public-data projection that you can inspect through GraphQL, followed by a checkpoint-preserving restart.

For the step-by-step manual path, use [Quickstart](/docs/chef/quickstart/).

## Before you start

Open the Zeer checkout in the assistant. The documented Chef path requires Linux x86_64 or WSL2, Node 24.14+, a compatible Prep endpoint and your PostgreSQL database. The starter offers optional local Docker Compose configuration.

Choose a new project directory and namespace. Keep your real database URL and tokens in a protected environment file; the assistant can work with variable names and placeholders rather than printing their values.

## Give your assistant this prompt

```text
Help me create a standalone Zeer Chef testnet indexer in a fresh directory.

Read the actual repository interfaces before writing code:
- docs/CHEF_QUICKSTART.md
- docs/PACKAGING.md
- packages/chef/README.md
- the generated starter and examples/chef-filtered/chef.config.ts

Use Zeer APIs, not Envio/Hasura API conventions.

1. Check Node/platform prerequisites. Build and pack the local @zeer/prep-client
   and @zeer/chef tarballs. These packages are not published on npm.
2. Use the real Chef init command to scaffold a new testnet project with
   start-height 0 and a fresh project namespace. Never overwrite existing data.
3. Explain chef.config.ts, schema.graphql and the TypeScript handlers. Start
   with the generated BlockSummary example and supported scalar entity fields.
4. Install both local tarballs in that standalone project. Generate its types
   and run its TypeScript check. Keep the generated lockfile.
5. Check Prep coverage/readiness at https://zeer.endpx.cloud/api/prep. Do not
   assume the configured source range is already indexed by Chef.
6. If an intended PostgreSQL connection or the chosen local Compose database
   is available, migrate only the new namespace. Start the authenticated reader
   and index the small inclusive range ending at height 1, using the same config
   and environment. Do not modify another application's database.
7. Query BlockSummary and _meta through the local authenticated endpoint. Compare
   the committed block identities with Prep. Restart the compatible sync command
   and check that committed work is not duplicated.
8. Provide commands, file paths, observed outputs and any unfinished checks.

Keep tokens server-side. Do not log secrets or put a database URL in source.
If PostgreSQL is unavailable, finish the scaffold/typecheck and report that the
runtime check is pending; do not claim successful indexing.
Keep handlers deterministic and restrict persistent effects to the entity API.
Do not add payments, a transactional outbox, subscriptions, EVM logs, automatic
schema upgrades or private wallet scanning to this first example.
```

## What a useful result contains

You should have an independent project, generated entity types, a working typecheck and reproducible commands. Runtime success additionally needs actual PostgreSQL commits and GraphQL results at a known checkpoint. A ready empty namespace is not a caught-up indexer.

The starter's `sync --to` end is inclusive; a Prep query's `to_block` end is exclusive. Keep that distinction in the assistant's comparisons.

## Extend one behavior at a time

After the starter works, ask for a [filtered transaction projection](/docs/chef/examples/), a different [entity schema](/docs/chef/schema/), or a deterministic [handler](/docs/chef/handlers/). Changed project identity requires [explicit evolution](/docs/chef/evolution/).

For authorized notes and memo text, follow **Chef → Shielded & Memos → [Local viewing-key setup](/docs/chef/shielded/local/)**. That separate local testnet guide uses the developer's protected viewing-key file. Never paste a seed, spending key or viewing key into an assistant chat or public playground.
