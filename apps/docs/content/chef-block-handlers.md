# Block handlers

Use `indexer.block` to run logic for every block Chef scans. A block handler can create block records, initialize counters or update an application aggregate. It runs before that block's transaction and receipt handlers.

This guide stores one header per block. Follow the [Chef quickstart](/docs/chef/quickstart/) through project installation and environment configuration, using `block_headers_guide` as the project name. Stop before `migrate`, `sync` or `serve`: make the replacements below before initializing this fresh database namespace.

## 1. Define the entity

Replace the starter's `schema.graphql` with:

```graphql
type BlockHeader {
  id: ID!
  height: Int! @index
  hash: String!
  time: BigInt!
}
```

## 2. Register the handler

Replace `chef.config.ts` with:

```ts
import { defineConfig, defineIndexer } from "@zeer-dev/chef";
import type { ChefEntities } from "./chef.generated.ts";

export default defineConfig<ChefEntities>({
  project: "block_headers_guide",
  network: "testnet",
  startHeight: 0,
  schema: "./schema.graphql",
  handlerVersion: "headers-v1",
  reorgWindow: 100,
  indexer: defineIndexer<ChefEntities>({
    async block({ block, context }) {
      await context.entities.set("BlockHeader", {
        id: String(block.height),
        height: block.height,
        hash: block.hash,
        time: BigInt(block.time),
      });
    },
  }),
});
```

| Block field | Meaning |
| --- | --- |
| `height` | Source block height |
| `hash` | Block hash |
| `previousHash` | Parent hash |
| `time` | Unix timestamp in seconds |

Chef still verifies contiguous headers when only a block handler is configured; it does not need decoded transaction bodies for this example.

## 3. Index and query

Use the same Prep and PostgreSQL environment as the quickstart. Generate the entity types and initialize this fresh namespace:

```sh
npm run codegen
npm run typecheck
npm run migrate
npm run sync -- --to 1
npm run serve
```

In another terminal, replace `query.graphql` with the following query and run `npm run query`:

```graphql
{
  genesis: BlockHeaderById(id: "0") { height hash time }
  nextBlock: BlockHeaderById(id: "1") { height hash time }
  _meta { height status }
}
```

Expect headers for blocks `0` and `1`, with `_meta.height: 1`. Running the same sync command again retains those two records and the checkpoint.

## Filtering and replay

A public transaction filter narrows transaction input; block handlers still run when no transactions match. To run application logic every hundred blocks, put `if (block.height % 100 !== 0) return;` inside the handler. This skips your application work for other heights while Chef continues checking and checkpointing every scanned block.

Await entity operations. A handler failure rolls back the current commit group. A reorg can replay affected blocks, so use deterministic IDs and keep irreversible side effects outside handlers. See [checkpoints and recovery](/docs/chef/recovery/).
