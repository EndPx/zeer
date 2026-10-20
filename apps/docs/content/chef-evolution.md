# Schema & handler evolution

Chef binds a project namespace to its configuration, schema and handler identity. Use a fresh namespace when changing that identity.

## Upgrade a projection

1. Preserve the existing config, namespace and consumer query contract.
2. Choose a new `project` and update the schema/handlers. Bump `handlerVersion` when imported helper behavior changes.
3. Generate types and migrate the new namespace.
4. Replay to a common source height/hash and verify complete entity values and API queries.
5. Recheck both projections, then switch consumers through your own routing procedure.

From a generated standalone project, first update `project` in `chef.config.ts`
to a fresh name and choose an inclusive source height as `target_height`:

```sh
npm run codegen
npm run migrate -- --json
npm run sync -- --to "$target_height" --json
npm run serve -- --port 39471 --json
```

**Notes:** `migrate` initializes/validates a namespace; it is not an in-place schema upgrade. Config-file bytes and index declarations participate in identity. Keep the old projection for rollback. Automated cutover orchestration is not implemented.

[Full evolution procedure](https://github.com/EndPx/zeer/blob/main/docs/SCHEMA_EVOLUTION.md)
