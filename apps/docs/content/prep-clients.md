# Prep clients

| Interface | Installation |
| --- | --- |
| HTTP JSON | Native `fetch` or [cURL](/docs/prep/curl/) |
| JavaScript / TypeScript | Local `@zeer/prep-client` tarball |

The client requires Node 22.18+. Use Node 24.14+ when working from the full Zeer checkout.

## Install

From the repository root:

```sh
mkdir -p .tmp/prep-packages
npm pack ./packages/prep-client --pack-destination .tmp/prep-packages
```

In a fresh consumer project:

```sh
npm init -y
npm install /absolute/path/to/zeer-prep-client-0.1.0.tgz
```

The package is currently unpublished; use the actual path to the generated tarball.

## Fetch headers

Save as `read-blocks.mjs` and run `node read-blocks.mjs`:

```js
import { PrepClient } from "@zeer/prep-client";

const client = new PrepClient({ url: "https://zeer.endpx.cloud/api/prep" });
const coverage = await client.getHeight();
if (!coverage.ready || coverage.start_block > 0 ||
    coverage.indexed_height === null || coverage.indexed_height < 1) {
  throw new Error("Blocks 0 and 1 are not available from this source.");
}
const page = await client.get({
  from_block: 0,
  to_block: 2,
  field_selection: { block: ["height", "hash", "time"], transaction: [] },
});
console.log(page.data.blocks);
console.log({ nextBlock: page.next_block, cursor: page.cursor });
```

## Methods

| Method | Purpose |
| --- | --- |
| `getHeight()` | Coverage and source status |
| `getCapabilities()` | Available protocol features |
| `get(query)` | One query page |
| `stream(query, options)` | Cursor pages through a finite captured range |
| `getTransactions(query)` | Bounded transaction-ID lookup |
| `getMempool()` / `getTransaction(txid)` | Optional live node observations |

**Notes:** Default timeouts are 30 seconds per request and 120 seconds per stream. The client does not silently retry or restart after `ReorgError`. See the [client reference](https://github.com/EndPx/zeer/blob/main/packages/prep-client/README.md) for options and bounds.
