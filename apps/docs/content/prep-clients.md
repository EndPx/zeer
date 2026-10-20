# Prep clients

Prep is an HTTP API. Use native `fetch` or cURL directly, or install the local JavaScript ESM client with TypeScript declarations.

| Interface | Current status |
| --- | --- |
| HTTP JSON | Available through the documented Prep routes |
| JavaScript / TypeScript | `@zeer/prep-client`, unpublished; install from a local tarball |
| Other languages | Call the HTTP contract; additional language SDKs are not documented releases |

The client requires Node 22.18+ with native `fetch`. The full Zeer checkout and Chef workflow require Node 24.14+. This client is not a wallet SDK or a native Rust binding.

## Install from this checkout

From the Zeer repository root:

```sh
mkdir -p .tmp/prep-packages
npm pack ./packages/prep-client --pack-destination .tmp/prep-packages
```

In a fresh consumer project, install the resulting artifact using its actual absolute path:

```sh
npm init -y
npm install /absolute/path/to/zeer-prep-client-0.1.0.tgz
```

Do not substitute a public-registry install command: the package is not published there. See [packaging](https://github.com/EndPx/zeer/blob/main/docs/PACKAGING.md) for the combined Chef/client installation path.

## Read public block headers

Save this as `read-blocks.mjs` in the consumer project, then run `node read-blocks.mjs`:

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

## Choose a method

| Method | Purpose |
| --- | --- |
| `getHeight()` | Current archive coverage and source-status observation |
| `getCapabilities()` | Protocol features and configured bounds |
| `get(query)` | One bounded query response |
| `stream(query, options)` | Follow cursors through one finite captured range |
| `getTransactions(query)` | Bounded transaction-ID lookup under one snapshot |
| `getMempool()` / `getTransaction(txid)` | Optional live node observations |

Live-method availability depends on the deployment. Check its capabilities and handle source failures. The [client contract](https://github.com/EndPx/zeer/blob/main/packages/prep-client/README.md) and [declarations](https://github.com/EndPx/zeer/blob/main/packages/prep-client/src/index.d.ts) define the actual argument and result types.

## Timeouts and consistency

The default timeout is 30 seconds per request and 120 seconds for a stream, including consumer time between pages. Options allow a caller signal and finite page guard. The client validates protocol responses and rejects redirects; it does not silently retry or restart a changed snapshot.

Catch `ReorgError` when the archive invalidates a scan. Reconcile prior application effects before restarting. Nested numbers in decoded payloads remain strings; use exact arithmetic for values. Read [Continuation & historical scans](/docs/prep/continuation/) before processing a large range.
