# TypeScript handlers

Chef calls your handlers as it reads each block. Handlers turn that source data into the entities defined in your schema.

| Handler | Input |
| --- | --- |
| `block` | Every scanned block |
| `transactionMetadata` | Public identity, height, version and position metadata |
| `transaction` | Stored decoded public transaction data |
| `receipt` | An authorized note from the configured local scanner |

## Write entities

```ts
async block({ block, context }) {
  await context.entities.set("BlockSummary", {
    id: String(block.height),
    height: block.height,
    hash: block.hash,
    time: BigInt(block.time),
    transactionCount: 0,
  });
}
```

This is the quickstart's block handler. Its `transactionMetadata` handler then increments `transactionCount` for each transaction in that block.

`context.entities.get`, `set` and `delete` run inside Chef's database transaction. A read sees earlier writes in the same transaction. Await every operation; if a handler fails, the current commit group is not saved.

**Notes:**

- `transaction` and `transactionMetadata` are mutually exclusive. Block handlers still run on filtered-empty blocks.
- The same input should produce the same entity changes when replayed. External payments, requests or messages cannot be undone by database rollback.
- Receipt handlers require [local scanner setup](/docs/chef/shielded/local/).

See the [starter handlers](https://github.com/EndPx/zeer/blob/main/packages/chef/src/scaffold.ts) or the [filtered transaction example](https://github.com/EndPx/zeer/blob/main/examples/chef-filtered/chef.config.ts).
