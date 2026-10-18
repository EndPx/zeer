export const repo = "https://github.com/EndPx/zeer";
export const docs = "/docs";
export const chefQuery = `query {
  BlockSummaryList(first: 3) {
    items { height hash transactionCount }
  }
  _meta { height status }
}`;
export const chefCode = `async block({ block, context }) {
  await context.entities.set("BlockSummary", {
    id: String(block.height),
    height: block.height,
    hash: block.hash,
    time: BigInt(block.time),
    transactionCount: 0,
  });
}`;
export const examples = [
  {
    id: "headers",
    name: "Block headers",
    description:
      "Read block heights, hashes, and timestamps without full transaction payloads.",
  },
  {
    id: "transactions",
    name: "Transaction metadata",
    description:
      "Read public transaction identifiers, positions, and serialized sizes.",
  },
  {
    id: "ids",
    name: "Transactions by ID",
    description:
      "Look up transaction IDs within a bounded block range. Missing IDs are scoped to that range.",
  },
  {
    id: "address",
    name: "Transparent output address",
    description:
      "Match public transparent outputs. This is not input-address history or shielded recipient discovery.",
  },
  {
    id: "sapling",
    name: "Sapling activity",
    description:
      "Find transactions with public Sapling components. Recipients, amounts, and memos remain encrypted.",
  },
  {
    id: "orchard",
    name: "Orchard activity",
    description:
      "Find transactions with public Orchard actions, without decrypting shielded information.",
  },
] as const;
export type Example = (typeof examples)[number]["id"];
export function prepQuery(
  example: Example,
  from: number,
  to: number,
  match = "",
) {
  if (example === "ids")
    return {
      from_block: from,
      to_block: to,
      txids: match.trim() ? match.trim().split(/[\s,]+/) : [],
    };
  return {
    from_block: from,
    to_block: to,
    limit: 100,
    field_selection: {
      block: example === "headers" ? ["height", "hash", "time"] : [],
      transaction:
        example === "headers"
          ? []
          : ["txid", "block_height", "index", "size_bytes"],
    },
    ...(example === "address"
      ? { transaction_filter: { transparent_output_addresses: [match] } }
      : example === "sapling"
        ? { transaction_filter: { has_sapling: true } }
        : example === "orchard"
          ? { transaction_filter: { has_orchard: true } }
          : {}),
  };
}
// Recorded source identities from the standalone testnet replay verification.
// These are never substituted for an actual upstream response.
export const sampleBlocks = [
  {
    height: 1000,
    hash: "000156e38cdb273bda134bd89d22a0b082c3ee57efdfaeef8be7fd7a243e37ad",
    time: 1477784550,
    transactionCount: 1,
  },
  {
    height: 1001,
    hash: "00014f2efd9ff84760e03819398ce434b57d838246d0a3442ff2cd01cbe13265",
    time: 1477784704,
    transactionCount: 1,
  },
  {
    height: 1002,
    hash: "000255ccb7485b2e4944d8a5458d9620ac5fa146dbf855321b715052173ee7c5",
    time: 1477784889,
    transactionCount: 1,
  },
];
