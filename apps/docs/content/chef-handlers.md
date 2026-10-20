# TypeScript handlers

Handlers define how source observations update your application entities. Chef is responsible for the source/checkpoint transaction around those updates.

## Select the handler that fits your data

| Handler | Input | Use |
| --- | --- | --- |
| `block` | A scanned block | Per-block summaries and state |
| `transactionMetadata` | Public identity/version/position metadata | Lightweight filtered transaction entities |
| `transaction` | Stored decoded public transaction data | Public input/output or structural processing |
| `receipt` | A successfully decrypted authorized note observation | Local shielded inbox entities |

`transactionMetadata` and `transaction` are mutually exclusive. A block handler runs for every scanned block, even when the public transaction filter matches nothing. The `receipt` path requires the opt-in local scanner configuration.

## Write through the entity context

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

The complete executable configuration is in [the filtered example](https://github.com/EndPx/zeer/blob/main/examples/chef-filtered/chef.config.ts). Entity `get`, `set` and `delete` operations run inside Chef's current transaction. Reads observe earlier staged updates. Await operations and let failures reject the block or batch.

## Keep replay deterministic

Use only supported entity operations for persistent effects. Wall-clock time, randomness, HTTP requests, email, payments and filesystem writes are outside the supported deterministic handler contract. Replaying a block can repeat those external actions; rolling back database entities cannot retract them.

Do not retain a handler context after its block completes. Keep the same frozen handler/configuration when resuming a project. When helper behavior changes, bump `handlerVersion` and follow [the evolution procedure](/docs/chef/evolution/).

## Work with private receipts

The inbox example stores a receipt's actual `value_zat`, note identity and memo bytes, then derives a conservative text projection. It does not treat coinbase/internal notes or memo text as a business payment decision. See [Reading receipts & memos](/docs/chef/shielded/memos/).
