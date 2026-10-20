# Configuration

Chef loads an operator-controlled TypeScript configuration. `PREP_URL` selects the public-data source; `DATABASE_URL` selects your PostgreSQL database. Keep those environment values and API tokens outside committed source.

The [filtered Orchard example](https://github.com/EndPx/zeer/blob/main/examples/chef-filtered/chef.config.ts) illustrates a lightweight public projection:

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
  sync: {
    pageSize: 1000,
    batchSize: 32,
    transactionFilter: { has_orchard: true },
  },
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

## Identity and range

`project` owns a marked PostgreSQL namespace. `network` and `startHeight` define the intended source history. A start of zero requires an archive that includes genesis. `schema` resolves the entity definition file. `handlerVersion` records behavioral changes, including imported helpers that are not recursively fingerprinted.

These values bind the projection's identity. Changing configuration, schema or handler behavior is not a routine restart: use the [new-namespace evolution procedure](/docs/chef/evolution/).

## Fetching and committing are separate

`pageSize` controls a source page; `batchSize` controls how many blocks may commit atomically. The example fetches up to 1,000 blocks and commits at most 32 at a time. A failed group advances no checkpoint for that group. Chef still validates all headers, including ranges whose transaction filter matches nothing.

Compatible newer Prep servers also support opt-in `sync.adaptiveScan: true`. Check source capabilities before enabling it and read the [package contract](https://github.com/EndPx/zeer/blob/main/packages/chef/README.md) for the independent page, commit and response bounds.

## Local shielded configuration

An explicit `shielded` configuration identifies a watch-only account and viewing-key fingerprint. The native scanner executable and UFVK file are protected local environment settings. Follow [local viewing-key setup](/docs/chef/shielded/local/) rather than adding keys to public query requests.
