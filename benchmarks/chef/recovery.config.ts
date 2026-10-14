import { defineConfig } from "@zeer/chef";

// Controlled public Regtest projection; no wallet keys or handler side effects.
export default defineConfig({
  project: process.env.ZEER_RECOVERY_PROJECT ?? "recovery_public",
  network: "regtest", startHeight: 1, reorgWindow: 3,
  schema: "./recovery.graphql", handlerVersion: "1",
  indexer: {
    async block({ block, context }) {
      await context.entities.set("Block", { id: String(block.height), hash: block.hash,
        previousHash: block.previousHash, time: BigInt(block.time), transactionCount: 0 });
      await context.entities.set("BranchBlock", { id: block.hash, height: block.height });
    },
    async transaction({ transaction, context }) {
      const raw = transaction.decoded.hex;
      if (typeof raw !== "string" || !/^(?:[0-9a-f]{2})+$/.test(raw)) throw new Error("Missing raw public transaction");
      await context.entities.set("Transaction", { id: `${transaction.blockHeight}:${transaction.index}`,
        txid: transaction.txid, blockHeight: transaction.blockHeight, index: transaction.index,
        version: transaction.version, locktime: BigInt(transaction.locktime), sizeBytes: raw.length / 2 });
      const block = await context.entities.get("Block", String(transaction.blockHeight));
      if (!block || typeof block.transactionCount !== "number") throw new Error("Missing block");
      await context.entities.set("Block", { ...block, transactionCount: block.transactionCount + 1 });
    },
  },
});
