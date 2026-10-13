import { PrepClient } from "../../packages/prep-client/src/index.js";

const client = new PrepClient({
  url: process.env.PREP_URL ?? "http://127.0.0.1:39368",
  token: process.env.PREP_API_TOKEN,
});
const height = await client.getHeight();
if (!height.ready) throw new Error(`Prep not ready: ${height.state}`);
const from = Number(process.env.PREP_FROM ?? height.start_block);
const to = Number(process.env.PREP_TO ?? height.archive_height + 1);
let blocks = 0, transactions = 0, pages = 0;
for await (const page of client.stream({
  from_block: from,
  to_block: to,
  limit: 64,
  field_selection: {
    block: ["height", "hash", "time"],
    transaction: ["txid", "block_height", "version", "raw", "vout"],
  },
})) {
  blocks += page.data.blocks.length;
  transactions += page.data.transactions.length;
  pages++;
}
console.log(JSON.stringify({
  status: "PASS", from, to_exclusive: to, pages, blocks, transactions,
  epoch: height.epoch, revision: height.revision,
  note: "SDK read completion; not independent consensus or a performance benchmark",
}, null, 2));
