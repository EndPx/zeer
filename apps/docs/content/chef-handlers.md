# Transaction handlers

Choose `transactionMetadata` when identity, version and position are enough. Use `transaction` when your handler needs decoded public transaction fields. Configure one of these inside `indexer` in `chef.config.ts`.

| Handler | Input |
| --- | --- |
| `transactionMetadata` | Public identity, height, version and position metadata |
| `transaction` | Stored decoded public transaction data |

## Store transaction metadata

This handler matches the [Orchard transaction configuration](/docs/chef/configuration/) and its `OrchardTransaction` schema:

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

| Metadata field | Meaning |
| --- | --- |
| `txid` | Transaction ID; a useful stable entity ID |
| `blockHeight` | Containing block's height |
| `index` | Zero-based transaction position within the block |
| `version`, `locktime` | Public format fields |

For decoded input, replace `transactionMetadata` with `transaction` and read `transaction.decoded`. Nested numeric values in decoded data are strings; preserve exact amounts rather than converting them to floating point. The same block, context and metadata fields remain available.

## Transparent inputs and outputs

Chef 0.6.0 exports helpers for decoded transparent transactions:

| Helper | Purpose |
| --- | --- |
| `readTransparentOutputs(transaction)` | Read output indices, exact zatoshi strings, script addresses and script hex |
| `transparentOutputId(txid, outputIndex)` | Build the stable `txid:outputIndex` output ID |
| `resolveTransparentInputs(transaction, lookup)` | Resolve previous outputs through your indexed records; return `resolved`, `unresolved` or `coinbase` |
| `lookupTransparentOutputs(client, request, options?)` | Prefetch at most 128 TX IDs over a bounded Prep snapshot outside the database handler |

The prefetch helper permits a range of at most 10,000 blocks; the hosted public Prep preview applies a stricter 1,000-block limit. Missing results mean absent from that requested range. Preserve and revalidate the returned source snapshot before committing imported observations.

Input amounts and script addresses come from the referenced previous output, not the spending transaction alone. If your index does not contain that output, retain `unresolved` and null values. An output address does not prove sender identity. Store inputs and outputs as related entities to expose them through nested GraphQL.

The [complete transaction breakdown example](https://github.com/EndPx/zeer/tree/main/examples/transaction-breakdown) provides the schema, handler lookup and query. It retains a historical output index and makes no network call inside the handler. Start early enough to include the funding transactions your application needs.

## Handler order and writes

Chef runs the [block handler](/docs/chef/block-handlers/) first, then the selected transaction handler for each matching transaction in source order. If local receipt scanning is enabled, its receipt handlers follow the transaction handler for that transaction.

`context.entities.get`, `set` and `delete` run inside Chef's database transaction. A read sees earlier writes in the same transaction. Await every operation; if a handler fails, the current commit group is not saved.

**Notes:**

- `transaction` and `transactionMetadata` are mutually exclusive. A transaction filter narrows their input; it does not remove block headers or skip the block handler.
- The same input should produce the same entity changes when replayed. External payments, requests or messages cannot be undone by database rollback.
- Receipt handlers require [local scanner setup](/docs/chef/shielded/local/).

See the [starter handlers](https://github.com/EndPx/zeer/blob/main/packages/chef/src/scaffold.ts) or the [filtered transaction example](https://github.com/EndPx/zeer/blob/main/examples/chef-filtered/chef.config.ts).
