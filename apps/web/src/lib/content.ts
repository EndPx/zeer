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
    detail: "Inspect public spend and output counts for Sapling activity. Recipients, individual shielded values and memos stay encrypted. Early blocks before activation have no matches.",
  },
  {
    id: "orchard",
    name: "Explore Orchard activity",
    description: "Find transactions containing Orchard actions.",
    detail: "Inspect the public number of Orchard actions in each matching transaction. Actions do not reveal individual payments. Blocks before activation have no matches.",
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
    name: "Transaction sizes & inputs",
    description:
      "Compare transaction sizes, versions and transparent input/output counts.",
    detail: "Build lightweight network analytics from metadata. This example omits full inputs, outputs and serialized transaction bodies.",
  },
  {
    id: "versions",
    name: "Filter by version",
    description: "Find transactions using a specific transaction format version.",
    detail: "Compare formats using a server-side version filter. A version number alone does not mean that a transaction contains shielded payments.",
  },
  {
    id: "raw",
    name: "Raw transaction bytes",
    description: "Retrieve serialized transaction hex for parsers and verification tools.",
    detail: "Inspect the actual wire payload, with no broadcast or wallet action. Raw shielded payloads remain encrypted. Start with one block per page to keep responses small.",
  },
] as const;
export type Example = (typeof examples)[number]["id"];
export type PrepFields = { block: string[]; transaction: string[] };
export const blockFieldOptions = [
  { key: "height", label: "Block number", required: true },
  { key: "hash", label: "Block hash", required: false },
  { key: "time", label: "Timestamp", required: false },
] as const;
export const transactionFieldOptions = [
  { key: "txid", label: "Transaction hash", required: true },
  { key: "block_height", label: "Block number", required: true },
  { key: "vin", label: "Inputs / transaction type", required: false },
  { key: "vout", label: "Transparent outputs", required: false },
  { key: "index", label: "Position in block (starts at 0)", required: false },
  { key: "size_bytes", label: "Size in bytes", required: false },
  { key: "version", label: "Transaction version", required: false },
  { key: "locktime", label: "Lock time", required: false },
  { key: "transparent_input_count", label: "Transparent input count", required: false },
  { key: "transparent_output_count", label: "Transparent output count", required: false },
  { key: "decoded", label: "Decoded public transaction", required: false },
  { key: "raw", label: "Raw transaction hex", required: false },
] as const;
export function defaultPrepFields(example: Example): PrepFields {
  switch (example) {
    case "headers": return { block: ["height", "hash", "time"], transaction: [] };
    case "address": return { block: ["height", "time"], transaction: ["txid", "block_height", "vout"] };
    case "ids": return { block: ["height", "hash", "time"], transaction: ["txid", "block_height", "version", "locktime", "vin", "vout"] };
    case "sapling": case "orchard": return { block: ["height", "time"], transaction: ["txid", "block_height", "decoded"] };
    case "transactions": return { block: ["height", "time"], transaction: ["txid", "block_height", "version", "size_bytes", "transparent_input_count", "transparent_output_count"] };
    case "versions": return { block: ["height", "time"], transaction: ["txid", "block_height", "version", "size_bytes"] };
    case "raw": return { block: ["height"], transaction: ["txid", "block_height", "raw"] };
  }
}
export function sharedPrepFields(example: Example, block: unknown, transaction: unknown): PrepFields {
  const fallback = defaultPrepFields(example);
  if (typeof block !== "string" || typeof transaction !== "string") return fallback;
  const fields = { block: block ? block.split(",") : [], transaction: transaction ? transaction.split(",") : [] };
  if (!fields.block.includes("height") || fields.block.some(key => !blockFieldOptions.some(option => option.key === key)) ||
      fields.transaction.some(key => !transactionFieldOptions.some(option => option.key === key)) ||
      new Set(fields.block).size !== fields.block.length || new Set(fields.transaction).size !== fields.transaction.length ||
      (example === "headers" ? fields.transaction.length > 0 : !fields.transaction.includes("txid") || !fields.transaction.includes("block_height"))) return fallback;
  return fields;
}
// Verified through the live testnet API at block 1000 on 19 October 2026.
export const testnetExample = {
  address: "t2UNzUUx8mWBCRYPRezvA363EYXyEpHokyi",
  txid: "42096f1b0d0ca49f42ca9e3fba73392378f02a9a3235bd361a1253e7ad613192",
};
export function defaultExampleMatch(example: Example): string {
  return example === "address" ? testnetExample.address : example === "ids" ? testnetExample.txid : example === "versions" ? "5" : "";
}
// Verified public testnet ranges. Applying a sample fills inputs; it never substitutes a response.
export function verifiedExample(example: Example, match = "") {
  switch (example) {
    case "address": return { from: 1000, limit: 3, match: testnetExample.address };
    case "ids": return { from: 1000, limit: 1, match: testnetExample.txid };
    case "sapling": return { from: 1000000, limit: 100, match: "" };
    case "orchard": return { from: 4515166, limit: 1, match: "" };
    case "headers": return { from: 0, limit: 3, match: "" };
    case "transactions": return { from: 1000000, limit: 100, match: "" };
    case "versions": return match === "4" ? { from: 1000000, limit: 3, match: "4" } : match === "6" ? { from: 4515166, limit: 1, match: "6" } : { from: 1842420, limit: 3, match: "5" };
    case "raw": return { from: 1000, limit: 1, match: "" };
  }
}
export function prepQuery(
  example: Example,
  from: number,
  to: number | undefined,
  match = "",
  limit: number | undefined = undefined,
  fields = defaultPrepFields(example),
) {
  return {
    from_block: from,
    ...(to === undefined ? {} : { to_block: to }),
    ...(limit === undefined ? {} : { limit }),
    field_selection: fields,
    ...(example === "versions"
      ? { transaction_filter: { versions: [Number(match)] } }
      : example === "ids"
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
