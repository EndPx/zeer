# TypeScript handlers

| Handler | Input |
| --- | --- |
| `block` | Every scanned block |
| `transactionMetadata` | Public identity, height, version and position metadata |
| `transaction` | Stored decoded public transaction data |
| `receipt` | An authorized note from the configured local scanner |

## Write entities

```ts
async transactionMetadata({ transaction, context }) {
  await context.entities.set("OrchardTransaction", {
    id: transaction.txid,
    height: transaction.blockHeight,
    version: transaction.version,
    transactionIndex: transaction.index,
  });
}
```

`context.entities.get`, `set` and `delete` run inside Chef's current transaction. Reads observe prior staged writes. Await operations and let failures reject the current block/batch.

**Notes:**

- `transaction` and `transactionMetadata` are mutually exclusive. Block handlers still run on filtered-empty blocks.
- Keep handlers deterministic. External payments, requests or messages cannot be undone by database rollback.
- Receipt handlers require [local scanner setup](/docs/chef/shielded/local/).

See the [complete example](https://github.com/EndPx/zeer/blob/main/examples/chef-filtered/chef.config.ts).
