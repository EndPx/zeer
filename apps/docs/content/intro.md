# Build with Zeer

Zeer gives Zcash developers two ways to work with chain data: query public data directly with **Prep**, or build application entities with **Chef**.

Start with a real public query, then add the processing your application needs. The current developer preview targets **Zcash testnet**. Check the endpoint's reported coverage before querying a range.

## Choose your starting point

| You want to… | Start here |
| --- | --- |
| Retrieve blocks or matching public transactions | [Query Prep in a few steps](/docs/prep/quickstart/) |
| Store your own entities and expose GraphQL | [Run your own Chef project](/docs/chef/quickstart/) |
| Read notes and memos with your own viewing key | [Set up Chef's local shielded inbox](/docs/chef/shielded/local/) |
| Try the public examples before writing code | [Open the playground](https://zeer.endpx.cloud/app) |

## Two layers, one developer workflow

**Prep** supplies public block data, transaction metadata and selected public transaction structure. Choose a starting block, filters and fields. Continue through the returned cursor to finish a historical scan.

**Chef** runs your TypeScript handlers over Prep data, writes application entities and checkpoints into your PostgreSQL database, and exposes authenticated read-only GraphQL. Its opt-in local scanner can also pass authorized shielded receipts to your handlers.

[Understand the source-to-API path](/docs/architecture/).

## Start with public data

The public playground does not need a wallet connection or viewing key. Try block headers, a transaction lookup or public Sapling/Orchard/Ironwood activity. Results come from the API; a selected example fills the request before you run it.

Reading a shielded memo is a separate, local Chef workflow. The configured viewing key determines which incoming notes can be read. Keep those results and keys in your own environment.

## What the preview provides

Use the docs alongside the [source repository](https://github.com/EndPx/zeer). The Chef and Prep client packages currently install from local tarballs built from the checkout. The quickstarts document that path explicitly; npm publication is not assumed.

Public endpoint access is shared and bounded. A successful query establishes the returned range and snapshot, not an unlimited throughput allocation or full application readiness. Each product guide explains coverage, continuation and failure states.
