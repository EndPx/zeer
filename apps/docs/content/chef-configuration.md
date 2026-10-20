# Configuration file

Define the project in `chef.config.ts`. Source and database connections come from `PREP_URL`, optional `PREP_API_TOKEN`, and `DATABASE_URL`.

The generated starter already has a working block-summary configuration. This example shows a different project that stores only transactions with Orchard activity; use its [matching entity schema](https://github.com/EndPx/zeer/blob/main/examples/chef-filtered/schema.graphql).

```ts
import { defineConfig } from "@zeer-dev/chef";

export default defineConfig<{
  OrchardTransaction: { id: string; height: number; version: number; transactionIndex: number };
}>({
  project: "orchard_public",
  network: "testnet",
  startHeight: 0,
  schema: "./schema.graphql",
  handlerVersion: "1",
  reorgWindow: 100,
  sync: { pageSize: 1000, batchSize: 32, transactionFilter: { has_orchard: true } },
  indexer: {
    async transactionMetadata({ transaction, context }) {
      await context.entities.set("OrchardTransaction", {
        id: transaction.txid,
        height: transaction.blockHeight,
        version: transaction.version,
        transactionIndex: transaction.index,
      });
    },
  },
});
```

| Option | Purpose |
| --- | --- |
| `project` | PostgreSQL project namespace |
| `network`, `startHeight` | Source network and inclusive historical start |
| `schema` | Entity schema path |
| `handlerVersion` | Handler generation, including imported helper changes |
| `reorgWindow` | Retained recovery window |
| `sync.pageSize` | Source page size |
| `sync.batchSize` | Blocks per atomic commit group |
| `sync.transactionFilter` | Public Prep predicates |
| `sync.adaptiveScan` | Opt into adaptive pages when the Prep server advertises support |
| `shielded` | Local receipt-scanner account and fingerprint; see [local setup](/docs/chef/shielded/local/) |

`schema` is resolved relative to the config file. Without explicit sync settings,
Chef uses 16 blocks per source page and one block per commit; the generated starter
sets 1,000 and 32 respectively. Fixed source pages allow 1–1,000 blocks, adaptive
pages allow up to 1,000,000, and commit groups allow 1–100 blocks. `reorgWindow`
defaults to 100 and allows 1–1,000 retained blocks.

Use [block handlers](/docs/chef/block-handlers/) for per-block entities, or choose
one of the [transaction handlers](/docs/chef/handlers/) for transaction input.
Connection settings are covered in [Environment Variables](/docs/chef/environment-variables/).

**Notes:** A failed commit group advances no checkpoint. Changing project identity requires [a new namespace](/docs/chef/evolution/). See the [complete filtered example](https://github.com/EndPx/zeer/tree/main/examples/chef-filtered) for its matching schema.
