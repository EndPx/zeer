# Zeer Prep

Prep is Zeer's public Zcash data layer. Retrieve block headers, transaction metadata, transparent outputs and public shielded structures through HTTP queries.

## Query exactly the public fields you need

Use a starting block, optional transaction filters and field selection. Headers-only queries can suppress transaction records; metadata queries can avoid full decoded bodies. The response explains the scanned range and provides continuation when needed.

| Task | Guide |
| --- | --- |
| Make your first request | [Quickstart](/docs/prep/quickstart/) |
| Build the first integration with an assistant | [Quickstart with AI](/docs/prep/quickstart-ai/) |
| Move from a request to an application | [Getting Started](/docs/prep/getting-started/) |
| Install the JavaScript/TypeScript package | [Clients](/docs/prep/clients/) |
| Understand every request and response field | [Query & response](/docs/prep/query/) |
| Combine filters and choose fields | [Filters & field selection](/docs/prep/fields/) |
| Finish a long historical scan | [Continuation](/docs/prep/continuation/) |
| Inspect a pending or mined transaction | [Transaction lookup & mempool](/docs/prep/transactions/) |

## Shielded structure is public; note plaintext is private

Prep can report public Sapling descriptions and separate Orchard/Ironwood action counts. Those are structural observations, not a count of payments. Shielded recipients, individual received amounts and memo text require authorized decryption in the [local Chef workflow](/docs/chef/shielded/local/).

## Check coverage first

Read `/height` for the available start, indexed height and readiness. An unavailable source-tip observation does not mean the source tip is zero. The [public preview contract](/docs/prep/public-api/) explains the shared endpoint and its quotas.

[Run your first query](/docs/prep/quickstart/) or [open Prep Playground](https://zeer.endpx.cloud/app/prep).

Browse [cURL examples](/docs/prep/curl/), [API access & tokens](/docs/prep/tokens/), [Supported networks](/docs/prep/networks/) and [Troubleshooting](/docs/prep/troubleshooting/) as your integration grows.
