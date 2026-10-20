import { PrepClient } from "@zeer/prep-client";

const from = Number(process.env.FROM_BLOCK ?? 0);
const to = process.env.TO_BLOCK ? Number(process.env.TO_BLOCK) : undefined;
const pool = process.env.SHIELDED_POOL ?? "all";
if (!Number.isSafeInteger(from) || from < 0 || from > 0xffffffff ||
    to !== undefined && (!Number.isSafeInteger(to) || to <= from || to > 0x100000000) ||
    !["all", "sapling", "orchard", "ironwood"].includes(pool)) throw new Error("Invalid FROM_BLOCK, exclusive TO_BLOCK or SHIELDED_POOL");

const client = new PrepClient({
  url: process.env.PREP_URL ?? "https://zeer.endpx.cloud/api/prep",
  token: process.env.PREP_API_TOKEN || undefined,
});
const fields = ["txid", "block_height", "version", "sapling_spend_count", "sapling_output_count", "orchard_action_count", "ironwood_action_count"];
const capabilities = await client.getCapabilities();
if (!fields.every(field => capabilities.query.transaction_fields.includes(field)) ||
    !capabilities.query.transaction_filters.includes("shielded_pools")) throw new Error("Source does not advertise public shielded counts/pool filtering; update Prep and the client together.");

const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
let next = from;
for await (const page of client.stream({
  from_block: from,
  ...(to === undefined ? {} : { to_block: to }),
  transaction_filter: { shielded_pools: pool === "all" ? ["sapling", "orchard", "ironwood"] : [pool] },
  field_selection: { block: [], transaction: fields },
}, { signal: controller.signal })) {
  if (page.network !== "testnet") throw new Error("This example requires Zcash testnet.");
  console.log(JSON.stringify({ scanned_from: next, next_block: page.next_block,
    range_complete: page.cursor === null, transactions: page.data.transactions }));
  next = page.next_block;
}
