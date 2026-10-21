# Inspect a Zcash transaction

Given a TX ID, Prep can ask its configured node whether that transaction is pending, mined or not currently observed. The response also contains decoded public fields and counts for Sapling, Orchard and Ironwood components.

This tutorial uses the live transaction observation route. For a transaction ID within a known archived range, see [the bounded lookup method](/docs/prep/clients/).

## 1. Install the client

Use Node.js 22.18+ and pnpm, or npm using the alternative below. In a working directory:

```sh
npm init -y
pnpm add @zeer-dev/prep-client@0.1.0
```

With npm, use `npm install @zeer-dev/prep-client@0.1.0` instead.

## 2. Read the transaction

Save this as `inspect-transaction.mjs`:

```js
import { PrepClient } from "@zeer-dev/prep-client";

const txid = process.argv[2];
if (!txid || !/^[0-9a-f]{64}$/.test(txid)) {
  throw new Error("Supply a lowercase 64-character transaction ID.");
}
const client = new PrepClient({
  url: process.env.PREP_URL ?? "https://zeer.endpx.cloud/api/prep",
  token: process.env.PREP_API_TOKEN,
});
const observation = await client.getTransaction(txid);
if (observation.status === "not_observed") {
  console.log(JSON.stringify({ txid, status: observation.status, observedAt: observation.observed_at }));
} else {
  const tx = observation.transaction;
  console.log(JSON.stringify({
    txid,
    status: observation.status,
    blockHeight: observation.block_height,
    confirmations: observation.confirmations,
    observedAt: observation.observed_at,
    coinbase: tx.is_coinbase,
    type: tx.transaction_type,
    saplingSpends: tx.sapling_spend_count,
    saplingOutputs: tx.sapling_output_count,
    orchardActions: tx.orchard_action_count,
    ironwoodActions: tx.ironwood_action_count,
    decoded: observation.decoded,
  }, null, 2));
}
```

## 3. Inspect a shielded example

Run the published Zeer demo transaction:

```sh
node inspect-transaction.mjs b9444bea5e092925ddfa52dbfbd8d1075c62b8b234260df3d9b9179f0a8d2d6e
```

At the example's verification it was mined at block `4523289`, with `coinbase: false` and Ironwood actions. The status and confirmation count are current source observations, so read the response rather than hardcoding them.

You can also [open the transaction inspector](https://zeer.endpx.cloud/app/prep?view=transaction&txid=b9444bea5e092925ddfa52dbfbd8d1075c62b8b234260df3d9b9179f0a8d2d6e) to browse Overview, Inputs / outputs and Raw.

## Interpret the response

| Value | Meaning |
| --- | --- |
| `pending` | The configured source currently observes it in the mempool; block height and confirmations are null |
| `mined` | The source reports a containing block and confirmation count |
| `not_observed` | This lookup did not return it; this does not prove it never existed |
| `is_coinbase` | The actual block-reward input marker, independent of the pools used |
| `transaction_type` | Source classification: coinbase, transparent, shielded, mixed or unknown |
| Pool counts | Public transaction components, including possible padding; not a count of recipients or payments |

Decoded public fields can contain transparent values, commitment data and encrypted shielded payloads. Numeric values inside decoded JSON are strings to preserve precision. A public lookup cannot reveal a shielded note's receiver, amount or memo text.

For authorized note values and memos, continue with [Chef's local viewing-key setup](/docs/chef/shielded/local/) and [reading receipts and memos](/docs/chef/shielded/memos/). Viewing keys stay in your own environment.
