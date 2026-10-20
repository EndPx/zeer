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
