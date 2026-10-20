# Configuration

Define the project in `chef.config.ts`. Source and database connections come from `PREP_URL`, optional `PREP_API_TOKEN`, and `DATABASE_URL`.

```ts
import { defineConfig } from "@zeer/chef";

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

**Notes:** A failed commit group advances no checkpoint. Changing project identity requires [a new namespace](/docs/chef/evolution/). See the [complete filtered example](https://github.com/EndPx/zeer/tree/main/examples/chef-filtered) for its matching schema.
