# Your first Prep query

:::tip Try the playground first
[Open Prep Playground](https://zeer.endpx.cloud/app/prep) to choose an example, select fields and run a public testnet query in your browser.
:::

Fetch Zcash block headers with the JavaScript client. This example reads testnet blocks 0 and 1 and prints the selected fields.

## Prerequisites

**Node.js 24.14+**, npm and Git for the source installation below. Use a POSIX shell, such as WSL on Windows. The public testnet preview requires no personal API token.

## 1. Install the client

The npm release is pending. Build the client package from the repository:

```sh
git clone https://github.com/EndPx/zeer.git
cd zeer
ZEER_CHECKOUT="$(pwd)"
mkdir -p .tmp/prep-packages
npm pack ./packages/prep-client --pack-destination .tmp/prep-packages
mkdir ../prep-quickstart
cd ../prep-quickstart
npm init -y
npm install "$ZEER_CHECKOUT/.tmp/prep-packages/zeer-prep-client-0.1.0.tgz"
```

## 2. Write your query

Save this as `read-blocks.mjs`:

```js
import { PrepClient } from "@zeer/prep-client";

const client = new PrepClient({ url: "https://zeer.endpx.cloud/api/prep" });
const coverage = await client.getHeight();
if (!coverage.ready || coverage.start_block > 0 ||
    coverage.indexed_height === null || coverage.indexed_height < 1) {
  throw new Error("Blocks 0 and 1 are not available from this source.");
}

const query = {
  from_block: 0,
  to_block: 2,
  field_selection: { block: ["height", "hash", "time"], transaction: [] },
};

for await (const page of client.stream(query)) {
  console.log(page.data.blocks);
}
```

## 3. Run

```sh
node read-blocks.mjs
```

The output contains block heights **0** and **1**, each with its hash and timestamp. `to_block` is exclusive, so `2` is outside the requested range.

## How it works

| Part | Purpose |
| --- | --- |
| `PrepClient` | Connects to the chosen [network URL](/docs/prep/networks/) |
| `getHeight()` | Checks available coverage and readiness |
| `field_selection` | Returns only the fields you request; `transaction: []` omits transaction records |
| `stream(query)` | Follows response cursors until the captured range is complete |

## Next steps

- [Clients](/docs/prep/clients/) — methods, types and resources.
- [Fields & filters](/docs/prep/fields/) — select transactions and public pool activity.
- [cURL examples](/docs/prep/curl/) — call the API directly.
- [Getting started](/docs/prep/getting-started/) — build a repeatable integration.
