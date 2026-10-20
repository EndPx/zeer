# Quickstart with AI

Open the Zeer checkout in your coding assistant and paste this prompt. The example uses Node's native `fetch` and the public testnet endpoint.

```text
Create a small Zeer Prep integration in a fresh local directory.

Read docs/PREP_QUERY.md, docs/PUBLIC_API.md and packages/prep-client/README.md.

1. Check coverage at https://zeer.endpx.cloud/api/prep/height.
2. Write a Node .mjs script that POSTs /query with from_block: 0, to_block: 2,
   block fields height/hash/time and transaction: []. The end is exclusive.
3. Run it against the real API. Check returned heights 0 and 1, scan progress
   and cursor. If this source range is unavailable, report the error.
4. Explain continuation with the original request plus its returned cursor.
5. Provide the script, command and observed result. Separate completed checks
   from checks you could not run. Do not overwrite an existing project.

If using @zeer/prep-client, install its local tarball; it is unpublished.
```

For the manual path, use [Quickstart](/docs/prep/quickstart/). For SDK installation, use [Clients](/docs/prep/clients/).
