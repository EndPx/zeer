# Checkpoints, restart & reorgs

A checkpoint is the last block Chef fully saved. A reorg happens when the source replaces part of the chain with a different branch; Chef must undo the affected records before processing the replacement blocks.

| Event | Behavior |
| --- | --- |
| Normal restart | Compatible sync resumes the persisted checkpoint |
| Failed commit group | No partial group checkpoint is committed |
| Supported reorg | Orphaned entities roll back before replacement replay |
| Reorg outside retained history | An explicit rebuild may be required |
| Changed project identity | Use [schema/handler evolution](/docs/chef/evolution/) |

## Inspect status

```sh
npm run status -- --human
```

Run this from your generated project directory. It loads the project's `.env` and reports source/project state without starting the indexer. To resume indexing, run `npm run follow` with the same configuration and database.

**Notes:** Restart with the same config, source and database. Do not move checkpoints manually or delete data as a routine restart. Reads can be unavailable during reconciliation/source validation. External effects are outside database rollback.
