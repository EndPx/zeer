import { defineConfig } from "@zeer/chef";
import type { ChefEntities } from "./chef.generated.ts";

export default defineConfig<ChefEntities>({
  project: "public_demo",
  network: "mainnet",
  startHeight: 1,
  schema: "./schema.graphql",
  handlerVersion: "1",
  reorgWindow: 100,
  indexer: {
    async block({ block, context }) {
      await context.entities.set("Block", { id: String(block.height), hash: block.hash, time: BigInt(block.time), transactionCount: 0 });
    },
    async transaction({ transaction, context }) {
      const decoded = transaction.decoded;
      if (typeof decoded.size !== "string" || !/^(0|[1-9][0-9]*)$/.test(decoded.size) || !Array.isArray(decoded.vin) || !Array.isArray(decoded.vout)) throw new Error("Required public transaction fields are missing");
      const sizeBytes = Number(decoded.size);
      if (!Number.isSafeInteger(sizeBytes) || sizeBytes > 2147483647) throw new Error("Invalid transaction size");
      await context.entities.set("PublicTransaction", {
        id: transaction.txid, minedHeight: transaction.blockHeight, version: transaction.version,
        locktime: BigInt(transaction.locktime), sizeBytes,
        transparentInputCount: decoded.vin.length, transparentOutputCount: decoded.vout.length,
      });
      const block = await context.entities.get("Block", String(transaction.blockHeight));
      if (!block) throw new Error("Block handler must run first");
      await context.entities.set("Block", { ...block, transactionCount: block.transactionCount + 1 });
    },
  },
});
