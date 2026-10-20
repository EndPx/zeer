import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineConfig } from "@zeer-dev/chef";
import type { ChefEntities } from "./chef.generated.ts";

const manifest = readFileSync(new URL("./demo.json", import.meta.url), "utf8");
const demo = JSON.parse(manifest) as {
  project: string; network: "testnet"; fromBlock: number; toBlock: number;
};
if (demo.network !== "testnet" || demo.fromBlock !== 4510000 || demo.toBlock !== 4519999)
  throw new Error("Unexpected hackathon demo coverage");

export default defineConfig<ChefEntities>({
  project: demo.project,
  network: demo.network,
  startHeight: demo.fromBlock,
  schema: "./schema.graphql",
  // Bind the range manifest to the persisted project identity too.
  handlerVersion: `demo-v1-${createHash("sha256").update(manifest).digest("hex")}`,
  reorgWindow: 100,
  sync: { pageSize: 1000, batchSize: 32 },
  indexer: {
    async block({ block, context }) {
      await context.entities.set("BlockSummary", {
        id: String(block.height), height: block.height,
        hash: block.hash, time: BigInt(block.time), transactionCount: 0,
      });
    },
    async transactionMetadata({ transaction, context }) {
      const id = String(transaction.blockHeight);
      const summary = await context.entities.get("BlockSummary", id);
      if (!summary) throw new Error("Block summary must exist before transactions");
      await context.entities.set("BlockSummary", {
        ...summary, transactionCount: summary.transactionCount + 1,
      });
    },
  },
});
