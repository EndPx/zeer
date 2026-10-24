import { defineConfig, readTransparentOutputs, resolveTransparentInputs, transparentOutputId } from "@zeer-dev/chef";
import type { ChefEntities } from "./chef.generated.ts";

export default defineConfig<ChefEntities>({
  project: "address_analytics", network: "testnet", startHeight: 0,
  schema: "./schema.graphql", handlerVersion: "1", reorgWindow: 100,
  sync: { pageSize: 16, batchSize: 8 },
  indexer: {
    async block({ block, context }) {
      const old = await context.entities.get("Coverage", "chain");
      await context.entities.set("Coverage", { id: "chain", startHeight: 0,
        lastHeight: block.height, processedBlocks: (old?.processedBlocks ?? 0) + 1,
        unresolvedInputs: old?.unresolvedInputs ?? 0, unattributedOutputs: old?.unattributedOutputs ?? 0 });
    },
    async transaction({ block, transaction, context }) {
      const coverage = await context.entities.get("Coverage", "chain");
      if (!coverage) throw new Error("COVERAGE_BLOCK_HANDLER_REQUIRED");
      const changes = new Map<string, { receivedZat: bigint; spentZat: bigint; receiving: boolean; spending: boolean }>();
      function change(address: string) {
        let entry = changes.get(address);
        if (!entry) { entry = { receivedZat: 0n, spentZat: 0n, receiving: false, spending: false }; changes.set(address, entry); }
        return entry;
      }
      const inputs = await resolveTransparentInputs(transaction, async (txid, n) => {
        const out = await context.entities.get("ObservedOutput", transparentOutputId(txid, n));
        if (out?.spentBy) throw new Error("PREVIOUS_OUTPUT_ALREADY_SPENT");
        return out ? { ...out, valueZat: out.valueZat.toString() } : null;
      });
      for (const input of inputs) {
        if (input.status === "unresolved") coverage.unresolvedInputs++;
        const out = input.previousOutput;
        if (!out) continue;
        const stored = await context.entities.get("ObservedOutput", out.id);
        if (!stored) throw new Error("PREVIOUS_OUTPUT_DISAPPEARED");
        await context.entities.set("ObservedOutput", { ...stored, spentBy: transaction.txid });
        if (out.addresses.length === 1) {
          const entry = change(out.addresses[0]); entry.spentZat += BigInt(out.valueZat); entry.spending = true;
        }
      }
      for (const out of readTransparentOutputs(transaction)) {
        await context.entities.set("ObservedOutput", { ...out, valueZat: BigInt(out.valueZat), spentBy: null });
        if (out.addresses.length !== 1) { coverage.unattributedOutputs++; continue; }
        const entry = change(out.addresses[0]); entry.receivedZat += BigInt(out.valueZat); entry.receiving = true;
      }
      for (const [address, delta] of changes) {
        const old = await context.entities.get("AddressSummary", address);
        await context.entities.set("AddressSummary", { id: address,
          receivedZat: (old?.receivedZat ?? 0n) + delta.receivedZat,
          spentZat: (old?.spentZat ?? 0n) + delta.spentZat,
          incomingTransactions: (old?.incomingTransactions ?? 0) + Number(delta.receiving),
          outgoingTransactions: (old?.outgoingTransactions ?? 0) + Number(delta.spending),
          firstHeight: old?.firstHeight ?? block.height, lastHeight: block.height });
        await context.entities.set("AddressActivity", { id: `${transaction.txid}:${address}`, address,
          txid: transaction.txid, blockHeight: block.height, blockHash: block.hash, ...delta });
      }
      await context.entities.set("Coverage", coverage);
    },
  },
});
