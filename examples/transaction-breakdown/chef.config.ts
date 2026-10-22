import { defineConfig, readTransparentOutputs, resolveTransparentInputs, transparentOutputId } from "@zeer-dev/chef";
import type { ChefEntities } from "./chef.generated.ts";

export default defineConfig<ChefEntities>({
  project: "transaction_breakdown",
  network: "testnet",
  startHeight: 0,
  schema: "./schema.graphql",
  handlerVersion: "1",
  reorgWindow: 100,
  sync: { pageSize: 16, batchSize: 8 },
  indexer: {
    async transaction({ transaction, context }) {
      const inputs = await resolveTransparentInputs(transaction, async (txid, n) => {
        const previous = await context.entities.get("TransactionOutput", transparentOutputId(txid, n));
        return previous ? { id: previous.id, txid: previous.transaction, outputIndex: previous.outputIndex,
          valueZat: previous.valueZat.toString(), addresses: previous.addresses, scriptHex: previous.scriptHex } : null;
      });
      await context.entities.set("Transaction", { id: transaction.txid, height: transaction.blockHeight, version: transaction.version });
      for (const output of readTransparentOutputs(transaction)) {
        await context.entities.set("TransactionOutput", { id: output.id, transaction: transaction.txid, outputIndex: output.outputIndex,
          valueZat: BigInt(output.valueZat), addresses: output.addresses, scriptHex: output.scriptHex });
      }
      for (const input of inputs) {
        await context.entities.set("TransactionInput", { id: `${transaction.txid}:${input.inputIndex}`, transaction: transaction.txid,
          inputIndex: input.inputIndex, resolution: input.status, previousTxid: input.previousTxid, previousOutputIndex: input.previousOutputIndex,
          previousOutput: input.previousOutput?.id ?? null, valueZat: input.previousOutput ? BigInt(input.previousOutput.valueZat) : null,
          addresses: input.previousOutput?.addresses ?? null });
      }
    },
  },
});
