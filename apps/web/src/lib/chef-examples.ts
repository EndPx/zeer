import { chefQuery } from "./content.ts";

export const chefExamples = [
  { id: "browse", name: "Browse block entities", description: "Read stored block summaries in ID order. Next example page follows the returned cursor." },
  { id: "genesis", name: "Genesis block", description: "Read the entity for block 0, including its hash and timestamp, to verify coverage from genesis." },
  { id: "height", name: "Filter by block height", description: "Use an equality filter on the indexed height field. Change the height below, then run the query." },
  { id: "compare", name: "Compare two heights", description: "Read blocks 1,000,000 and 2,000,000 together with GraphQL aliases. Compare their timestamps and transaction counts." },
  { id: "checkpoint", name: "Indexer checkpoint", description: "Read the committed checkpoint, canonical hash and readiness state while the indexer follows new blocks." },
  { id: "latest", name: "Latest indexed block", description: "Read the block at the last observed Chef checkpoint. Restore example captures a newer checkpoint without running the query." },
] as const;

export type ChefExample = typeof chefExamples[number]["id"];

export const localMemoQuery = `query ReadShieldedMemos {
  ReadableNoteList(first: 10) {
    items { txid pool blockHeight valueZat memoKind memoText }
    nextCursor
  }
  _meta { height status }
}`;

export function chefBlockHeight(value: string): number | null {
  if (!/^\d{1,10}$/.test(value)) return null;
  const height = Number(value);
  return Number.isSafeInteger(height) && height <= 0x7fff_ffff ? height : null;
}

export function chefPresetQuery(example: ChefExample, height = 4515166, checkpoint: number | null = null): string | null {
  switch (example) {
    case "browse": return chefQuery;
    case "genesis": return `query GenesisBlock {
  BlockSummaryById(id: "0") { id height hash time transactionCount }
  _meta { height status }
}`;
    case "height":
      if (chefBlockHeight(String(height)) === null) return null;
      return `query BlockAtHeight {
  BlockSummaryList(first: 1, where: { height: ${height} }) {
    items { id height time transactionCount }
  }
  _meta { height status }
}`;
    case "compare": return `query CompareBlocks {
  earlier: BlockSummaryById(id: "1000000") { height time transactionCount }
  later: BlockSummaryById(id: "2000000") { height time transactionCount }
  _meta { height status }
}`;
    case "checkpoint": return `query IndexerCheckpoint {
  _meta { height hash anchorHash status }
}`;
    case "latest":
      if (checkpoint === null || !Number.isSafeInteger(checkpoint) || checkpoint < 0 || checkpoint > 0xffff_fffe) return null;
      return `query LatestObservedBlock {
  BlockSummaryById(id: "${checkpoint}") { height hash time transactionCount }
  _meta { height status }
}`;
  }
}
