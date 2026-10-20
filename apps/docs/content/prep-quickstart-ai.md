# Quickstart with AI

Open a working directory in your coding assistant and paste this prompt. The example reads public testnet data and needs no wallet or viewing key.

```text
Create a small Zeer Prep integration in a fresh local directory.

Read https://zeer.endpx.cloud/docs/prep/quickstart/ and
https://zeer.endpx.cloud/docs/prep/query/ before writing code.

1. Check coverage at https://zeer.endpx.cloud/api/prep/height.
2. Follow the Quickstart's client installation method. Write a Node .mjs script
   that requests from_block: 0, to_block: 2,
   block fields height/hash/time and transaction: []. The end is exclusive.
3. Run it against the real API. Check returned heights 0 and 1, scan progress
   and cursor. If this source range is unavailable, report the error.
4. Explain continuation with the original request plus its returned cursor.
5. Provide the script, command and observed result. Separate completed checks
   from checks you could not run. Do not overwrite an existing project.

Use the client's stream method to follow cursor pages through the range.
```

For the manual path, use [Quickstart](/docs/prep/quickstart/). For SDK installation, use [Clients](/docs/prep/clients/).
