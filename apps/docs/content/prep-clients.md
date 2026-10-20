# Prep clients

Use the JavaScript client for typed queries and cursor handling, or call Prep's HTTP JSON API from your language of choice.

## Quick links

| Client | Resources |
| --- | --- |
| **Node.js / TypeScript** | [API reference](https://github.com/EndPx/zeer/blob/main/packages/prep-client/README.md) · [GitHub](https://github.com/EndPx/zeer/tree/main/packages/prep-client) · [Quickstart](/docs/prep/quickstart/) |
| **HTTP JSON** | [Query reference](/docs/prep/query/) · [cURL examples](/docs/prep/curl/) · [Playground](https://zeer.endpx.cloud/app/prep) |

## Node.js / TypeScript

Requires **Node.js 22.18+**. The ESM package uses native `fetch` and includes TypeScript declarations.

The npm release is pending. Follow the [source installation](/docs/prep/quickstart/#1-install-the-client) to create the tarball, then install its actual file path in your project:

```sh
npm install /absolute/path/to/zeer-prep-client-0.1.0.tgz
```

```js
import { PrepClient } from "@zeer/prep-client";

const client = new PrepClient({ url: "https://zeer.endpx.cloud/api/prep" });
for await (const page of client.stream({
  from_block: 0,
  to_block: 2,
  field_selection: { block: ["height", "hash"], transaction: [] },
})) {
  console.log(page.data.blocks);
}
```

### Methods

| Method | Purpose |
| --- | --- |
| `getHeight()` / `getCapabilities()` | Coverage, readiness and protocol features |
| `get(query)` | One query page |
| `stream(query, options)` | Cursor pages through a finite captured range |
| `getTransactions(query)` | Bounded transaction-ID lookup |
| `getMempool()` / `getTransaction(txid)` | Optional live node observations |

The client validates responses and exposes typed errors. Streams advance through empty filtered pages and stop on snapshot changes instead of silently restarting. Defaults are 30 seconds per request and 120 seconds per stream; [options](https://github.com/EndPx/zeer/blob/main/packages/prep-client/README.md) let you set timeouts and cancellation.

## API access

The public Zcash Testnet preview requires no personal token. For a private Prep deployment, pass its bearer token as the client's `token` option. Keep private credentials out of frontend bundles. See [API access & tokens](/docs/prep/tokens/).
