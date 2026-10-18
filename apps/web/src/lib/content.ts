export const repo = "https://github.com/EndPx/zeer";
export const docs = "/docs";
export const publicPrepApi = "https://zeer.endpx.cloud/api/prep";
export const chefQuery = `query {
  BlockSummaryList(first: 3) {
    items { height hash transactionCount }
    nextCursor
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
    id: "address",
    name: "Payments to an address",
    description: "Find transactions with a transparent output to a specific Zcash address.",
    detail: "Use this to build a public payment feed. Matches are based on output addresses; shielded recipients and sender history are not exposed.",
  },
  {
    id: "ids",
    name: "Find a transaction",
    description: "Find public transaction details by transaction ID across your selected block range.",
    detail: "Start from genesis when you do not know the block height. Continue through pages until the transaction is found or the selected range is complete.",
  },
  {
    id: "sapling",
    name: "Explore Sapling activity",
    description: "Find transactions containing Sapling spends or outputs.",
    detail: "Build activity feeds from public bundle presence. Recipients, individual shielded values and memos stay encrypted. Early blocks before Sapling activation have no matches.",
  },
  {
    id: "orchard",
    name: "Explore Orchard activity",
    description: "Find transactions containing Orchard actions.",
    detail: "Follow public Orchard activity for network analytics. This does not decrypt payments. Blocks before Orchard activation have no matches.",
  },
  {
    id: "headers",
    name: "Browse block history",
    description:
      "Read block heights, hashes, and timestamps without full transaction payloads.",
    detail: "Build a block timeline or check chain progress. Select a large historical range and retrieve a bounded page at a time.",
  },
  {
    id: "transactions",
    name: "Inspect transactions",
    description:
      "Read public transaction identifiers, positions, and serialized sizes.",
    detail: "Feed an explorer or indexing pipeline with just the public metadata it needs. Request pages without downloading full raw blocks.",
  },
] as const;
export type Example = (typeof examples)[number]["id"];
// Verified through the live testnet API at block 1000 on 19 October 2026.
export const testnetExample = {
  address: "t2UNzUUx8mWBCRYPRezvA363EYXyEpHokyi",
  txid: "42096f1b0d0ca49f42ca9e3fba73392378f02a9a3235bd361a1253e7ad613192",
};
export function prepQuery(
  example: Example,
  from: number,
  to: number | undefined,
  match = "",
  limit = 100,
) {
  return {
    from_block: from,
    ...(to === undefined ? {} : { to_block: to }),
    limit,
    field_selection: {
      block: example === "headers" ? ["height", "hash", "time"] : [],
      transaction:
        example === "headers"
          ? []
          : ["txid", "block_height", "index", "size_bytes"],
    },
    ...(example === "ids"
      ? { transaction_filter: { txids: match.trim() ? match.trim().split(/[\s,]+/) : [] } }
      : example === "address"
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
