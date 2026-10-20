# Checkpoints, restart & reorgs

| Event | Behavior |
| --- | --- |
| Normal restart | Compatible sync resumes the persisted checkpoint |
| Failed commit group | No partial group checkpoint is committed |
| Supported reorg | Orphaned entities roll back before replacement replay |
| Reorg outside retained history | An explicit rebuild may be required |
| Changed project identity | Use [schema/handler evolution](/docs/chef/evolution/) |

## Inspect status

```sh
node --env-file=/protected/chef.env packages/chef/dist/cli.js status \
  --config /absolute/path/to/chef.config.ts --human
```

`status` reports source/project state; it does not start a writer or reconcile it.

**Notes:** Restart with the same config, source and database. Do not move checkpoints manually or delete data as a routine restart. Reads can be unavailable during reconciliation/source validation. External effects are outside database rollback.
