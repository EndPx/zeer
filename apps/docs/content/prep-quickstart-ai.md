# Quickstart with AI

Use your coding assistant to build a small Prep integration against real public testnet data. Start with a bounded request before scanning a large historical range.

Prefer to write the request yourself? Follow the [manual quickstart](/docs/prep/quickstart/).

## Before you start

Open the [Zeer checkout](https://github.com/EndPx/zeer) in your assistant. Choose a fresh directory for the integration. You need Node for a JavaScript example, or cURL for the first HTTP request. No wallet, viewing key or personal API token is needed for the public preview.

If your assistant uses online documentation, give it the [documentation index](https://zeer.endpx.cloud/docs/generated/llms.txt). Keep the public endpoint's [shared quotas](/docs/prep/public-api/) in mind.

## Give your assistant this prompt

```text
Build my first Zeer Prep integration in a fresh local directory.

First read these files from the Zeer checkout:
- docs/PREP_QUERY.md
- docs/PUBLIC_API.md
- packages/prep-client/README.md and its public declarations

Use the public Zcash testnet base URL:
https://zeer.endpx.cloud/api/prep

1. Inspect the current height/readiness and advertised capabilities.
2. Create a small Node .mjs example using native fetch. Request from_block 0,
   to_block 2, block fields height/hash/time and transaction: []. Explain that
   the end is exclusive. Fail visibly if this range is unavailable.
3. Inspect the actual response: block heights should be 0 and 1. Report its
   returned cursor and scan progress. Do not substitute captured sample data.
4. Show how a longer query continues with the same original request plus its
   returned cursor. Empty matches do not end a scan. A REORG response needs
   reconciliation/restart of the scan, not blind continuation with an old cursor.
5. Keep public amounts exact and distinguish top-level numeric metadata from
   string-valued numbers inside decoded JSON.
6. Add a README with the exact commands and observed verification results.

Use the existing HTTP contract. Do not invent Envio/EVM fields or wallet APIs.
The @zeer/prep-client package is unpublished; if adding that client, install a
tarball packed from the local checkout as the Clients guide describes.
Do not request wallet keys, store credentials in code, overwrite an existing
project, or begin an unbounded full-history experiment.
If you cannot run a step, say which files were prepared and which checks remain.
```

## Check the result

The first success is a real request returning the requested genesis headers. A generated script or a pasted JSON response is not execution evidence. Ask the assistant to show the command, HTTP outcome and returned heights.

For continuation, inspect the original request and returned cursor together. The public API uses bounded responses even when no explicit scan limit is supplied.

## Continue building

Choose a public transaction task from [Preset Queries](/docs/prep/examples/), then follow [Getting Started](/docs/prep/getting-started/) for an application integration or [Clients](/docs/prep/clients/) for the JavaScript/TypeScript package.

Memo decryption belongs to [Chef's local workflow](/docs/chef/shielded/local/); public Prep requests do not accept a viewing key.
