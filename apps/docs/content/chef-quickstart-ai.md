# Quickstart with AI

Open a working directory in your coding assistant and paste this prompt. You need Node 24.14+, Linux/WSL2 and PostgreSQL. The assistant should follow the same [Quickstart](/docs/chef/quickstart/) you would use manually.

```text
Create a standalone Zeer Chef 0.4.0 testnet project in a fresh directory.

Read https://zeer.endpx.cloud/docs/chef/quickstart/ and
https://zeer.endpx.cloud/docs/chef/configuration/ before writing code.

1. Use the public chain indexer template for this exercise. Run
   pnpx @zeer-dev/cli@0.4.0 init with --template public,
   explicit --dir, --project and --start-height latest flags with --json,
   using a fresh directory and a new project name. Record the numeric startHeight
   returned by init; do not replace it with a later source tip.
2. Install the generated project's dependencies, generate types and typecheck.
3. Configure the public testnet Prep URL and the intended PostgreSQL database.
   Keep credentials in the generated private environment file.
4. Use pnpm for dependency installation and project scripts (npm also works).
   Run pnpm run doctor. On a fresh namespace, MIGRATION_REQUIRED is expected;
   other failed checks need to be resolved before starting.
5. If the intended database and Prep service are available, run
   pnpm run dev --migrate. This explicitly allows compatible migration;
   dev generates types, typechecks and starts the API before the follower.
   Query BlockSummary at the captured startHeight and compare its fields
   with Prep at that exact height. Record the actual committed checkpoint.
6. Stop dev with Ctrl+C and confirm both children stop. Restart with
   pnpm run dev, then check that the same entity is retained without duplication
   and the checkpoint continues from committed progress. Stop the test when done.

Do not overwrite existing projects or databases. Keep handlers deterministic.
If a runtime dependency is missing, report that check as pending. Do not start
Docker, install dependencies or reset existing data as an implicit repair.
Show commands and observed results separately from files merely prepared.
```

For an application with your own model, replace `--template public` with `--template blank`. The assistant should install dependencies, verify that the blank starter typechecks, define entities in `schema.graphql`, generate their types and implement `handlers.ts` before indexing. It should not present an empty schema as a working application.

For an authorized payment inbox, use `--template shielded` and an explicit numeric `--start-height` at or before the notes you need. Follow [Local viewing-key setup](/docs/chef/shielded/local/) for scanner installation, fingerprint inspection and local configuration. Keep the UFVK in a protected file outside the project; provide its path locally instead of pasting key contents into an assistant. Init does not load a key. Receipt observations do not authorize a payment or establish a spendable balance.

See [Quickstart](/docs/chef/quickstart/) for manual setup.
