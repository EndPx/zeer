# Getting started with Prep

## 1. Choose an interface

Use HTTP directly with [cURL](/docs/prep/curl/) or `fetch`, or install the [JavaScript/TypeScript client](/docs/prep/clients/).

## 2. Check the endpoint

The public testnet base URL is `https://zeer.endpx.cloud/api/prep`.

| Route | Check |
| --- | --- |
| `GET /height` | Network, available range and readiness |
| `GET /capabilities` | Supported fields, filters and bounds |

## 3. Build a query

Choose a starting block, optional exclusive end, public transaction filters and [field selection](/docs/prep/fields/). Start with headers or metadata; request raw/decoded payloads when your application needs them.

## 4. Process the response

Read `data.blocks` and `data.transactions`. Continue with the same request plus its returned cursor until `cursor` is null. Empty matches can still advance the scan.

See [Query & response](/docs/prep/query/) for the format and [Troubleshooting](/docs/prep/troubleshooting/) for failures.

For a complete script, start with [Analyzing Address Outputs](/docs/prep/tutorials/address-outputs/) or [Inspecting Transactions](/docs/prep/tutorials/inspect-transaction/).
