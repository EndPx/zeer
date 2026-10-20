# Checkpoints, restart & reorgs

Chef stores the application checkpoint with entity changes and undo information. Normal restart resumes a compatible project; a change in identity requires a fresh projection.

## Resume the same project

Stop the writer with Ctrl+C and run the same `sync` or `--follow` command with the same configuration, source and database. Already committed groups are not reapplied as new work. A group that failed before commit is retried from its previous checkpoint.

For a standalone starter, `npm run db:stop` retains local database storage. Do not delete the database or move a checkpoint manually as part of a routine restart.

## Inspect status

From the checkout, using your private environment file:

```sh
node --env-file=/protected/chef.env packages/chef/dist/cli.js status \
  --config /absolute/path/to/chef.config.ts --human
```

`status` checks source coverage and persisted project state. It does not start a writer or perform reconciliation. A successful observation does not prove that another writer process is running.

## Reorganization recovery

Chef compares retained canonical headers and rolls back orphaned entity projections inside its undo window before replaying the replacement branch. Reads are gated during reconciliation or source validation failures. A deeper change outside retained recovery history can require an explicit rebuild.

Public Prep cursors can separately return `REORG` after a snapshot change. An application that uses Prep directly owns its own continuation/reconciliation logic; Chef's database rollback is not applied to arbitrary external consumers.

## Changed schemas or handlers

Changing project configuration, schema, imported helper behavior or handler generation can change what historical entities should exist. Preserve the old project and use [the explicit evolution procedure](/docs/chef/evolution/) for a fresh namespace and replay.

There is no automatic zero-downtime deployment orchestrator or transactional outbox in this preview. Database rollback cannot retract an external payment or message sent by handler code.
