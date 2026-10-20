# Schema & handler evolution

Chef binds a project namespace to its configuration, schema and handler identity. Use a fresh namespace when changing that identity.

## Upgrade a projection

1. Preserve the existing config, namespace and consumer query contract.
2. Choose a new `project` and update the schema/handlers. Bump `handlerVersion` when imported helper behavior changes.
3. Generate types and migrate the new namespace.
4. Replay to a common source height/hash and verify complete entity values and API queries.
5. Recheck both projections, then switch consumers through your own routing procedure.

For an installed CLI:

```sh
zeer-chef codegen --config app-v2/chef.config.ts --json
zeer-chef migrate --config app-v2/chef.config.ts --json
zeer-chef sync --config app-v2/chef.config.ts --to "$target_height" --json
zeer-chef serve --config app-v2/chef.config.ts --port 39471 --json
```

**Notes:** `migrate` initializes/validates a namespace; it is not an in-place schema upgrade. Config-file bytes and index declarations participate in identity. Keep the old projection for rollback. Automated cutover orchestration is not implemented.

[Full evolution procedure](https://github.com/EndPx/zeer/blob/main/docs/SCHEMA_EVOLUTION.md)
