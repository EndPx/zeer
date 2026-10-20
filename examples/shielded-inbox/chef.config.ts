import { defineConfig, defineIndexer } from "@zeer-dev/chef";
import type { ChefEntities } from "./chef.generated.ts";
import { readableMemo } from "./memo.ts";

export default defineConfig<ChefEntities>({
  project: "shielded_inbox_memos",
  network: "testnet",
  startHeight: Number(process.env.ZEER_BIRTHDAY_HEIGHT),
  schema: "./schema.graphql",
  handlerVersion: "readable-memos-v1",
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
  indexer: defineIndexer<ChefEntities>({
    async receipt({ receipt, context }) {
      await context.entities.set("ReadableNote", {
        id: receipt.id, txid: receipt.txid, pool: receipt.pool,
        outputIndex: receipt.output_index, blockHeight: receipt.height,
        valueZat: BigInt(receipt.value_zat), receiver: receipt.receiver,
        memoHex: receipt.memo_hex, ...readableMemo(receipt.memo_hex),
        scope: receipt.scope, origin: receipt.origin, coinbase: receipt.is_coinbase,
      });
    },
  }),
});
