# Find payments to a transparent address

This tutorial finds transactions with transparent outputs paying an address. It uses Prep's address filter and streams every response page in the selected range.

The filter matches output addresses. It does not resolve spent inputs into sender addresses, and these results are not a wallet balance or a complete history of transactions to and from the address. Shielded receivers and note values require a [local Chef scanner](/docs/chef/shielded/overview/).

## 1. Install the client

Use Node.js 22.18+ and pnpm, or npm using the alternative below. In a new working directory:

```sh
npm init -y
pnpm add @zeer-dev/prep-client@0.1.0
```

With npm, use `npm install @zeer-dev/prep-client@0.1.0` instead.

## 2. Write the query

Save this as `address-outputs.mjs`:

```js
import { PrepClient } from "@zeer-dev/prep-client";

const address = process.argv[2];
if (!address) throw new Error("Supply a Zcash testnet transparent address.");
const from = Number(process.env.FROM_BLOCK ?? 0);
const to = process.env.TO_BLOCK === undefined ? undefined : Number(process.env.TO_BLOCK);
if (!Number.isInteger(from) || from < 0 || from > 0xffff_ffff ||
    to !== undefined && (!Number.isInteger(to) || to <= from || to > 0x1_0000_0000)) {
  throw new Error("Use a nonnegative start and an optional greater exclusive end.");
}

const client = new PrepClient({
  url: process.env.PREP_URL ?? "https://zeer.endpx.cloud/api/prep",
  token: process.env.PREP_API_TOKEN,
});
const coverage = await client.getHeight();
if (coverage.network !== "testnet" || !coverage.ready || from < coverage.start_block) {
  throw new Error("Select a ready testnet source covering the requested start.");
}
const capabilities = await client.getCapabilities();
const query = {
  from_block: from,
  ...(to === undefined ? {} : { to_block: to }),
  ...(capabilities.query.max_adaptive_scan_blocks ? { scan_mode: "adaptive" } : {}),
  field_selection: {
    block: [],
    transaction: ["txid", "block_height", "index", "is_coinbase", "transaction_type", "vout"],
  },
  transaction_filter: { transparent_output_addresses: [address] },
};

let matches = 0;
let scannedThrough = from;
for await (const page of client.stream(query, { totalTimeoutMs: 600_000 })) {
  for (const transaction of page.data.transactions) {
    console.log(JSON.stringify(transaction));
    matches++;
  }
  scannedThrough = page.next_block;
  console.error(`Scanned [${from}, ${page.next_block}) of [${from}, ${page.to_block}); ${matches} matching transactions`);
}
console.log(JSON.stringify({ complete: true, fromBlock: from, toBlock: scannedThrough, matchingTransactions: matches }));
```

`vout` contains the public outputs, including their amount strings. A matching transaction can have other recipients too; inspect each output's `scriptPubKey.addresses` or `scriptPubKey.address` before attributing a value to the selected address.

## 3. Run a known sample

On Linux or WSL, run this one-block sample first:

```sh
FROM_BLOCK=4515166 TO_BLOCK=4515167 node address-outputs.mjs tmTwLU5Y855hfBZ25ZaWuTvcrqjrCMFAZR9
```

The address appears in a coinbase transaction at block `4515166`. Look for transaction `8cad3f018f86d262a372141c7252d3d4f48ef5958f86b2b3f5368056e4722a54`, `is_coinbase: true`, and the final `complete: true` summary. Block rewards can match the filter; a match does not establish a normal user payment or that an output is unspent.

For a scan from block 0 through the available captured head, omit both range variables:

```sh
node address-outputs.mjs YOUR_TESTNET_TRANSPARENT_ADDRESS
```

Omitting `to_block` captures an exclusive end on the first response. The client follows cursors, including pages with no matches, and stops at that end. This is a finite history scan, rather than a live subscription. The script allows ten minutes for the stream; scan duration depends on the range, source and selected payload.

## Read completion correctly

Rows printed before a timeout, source error or `REORG` are partial. Only a successfully completed stream prints the final summary. Reconcile any saved results before starting a new scan after a source snapshot change. For large jobs, persist results with their range and source context and follow the [continuation contract](/docs/prep/continuation/).

Next: [inspect one returned transaction](/docs/prep/tutorials/inspect-transaction/) or change the [filters and field selection](/docs/prep/fields/).
