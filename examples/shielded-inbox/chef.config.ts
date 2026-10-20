import { defineConfig, defineIndexer } from "@zeer/chef";
import type { Entities } from "./chef.generated.ts";

export default defineConfig<Entities>({
  project: "shielded_inbox",
  network: "testnet",
  startHeight: Number(process.env.ZEER_BIRTHDAY_HEIGHT),
  schema: "./schema.graphql",
  handlerVersion: "readable-notes-v1",
  reorgWindow: 100,
  shielded: {
    accountId: "inbox",
    keyFingerprint: process.env.ZEER_KEY_FINGERPRINT ?? "",
  },
  sync: {
    pageSize: 2,
    batchSize: 1,
    transactionFilter: { shielded_pools: ["sapling", "orchard", "ironwood"] },
  },
  indexer: defineIndexer<Entities>({
    async receipt({ receipt, context }) {
      await context.entities.set("ReadableNote", {
        id: receipt.id, txid: receipt.txid, pool: receipt.pool,
        outputIndex: receipt.output_index, blockHeight: receipt.height,
        valueZat: BigInt(receipt.value_zat), receiver: receipt.receiver,
        memoHex: receipt.memo_hex, scope: receipt.scope, origin: receipt.origin, coinbase: receipt.is_coinbase,
      });
    },
  }),
});
