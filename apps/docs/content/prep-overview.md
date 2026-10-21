# Zeer Prep

**Zeer Prep** is the public Zcash data API behind Chef. Query blocks and transactions by range, apply public filters, and select the fields your application needs.

<picture class="overview-demo">
  <source media="(prefers-reduced-motion: reduce)" srcset="/docs/demos/prep-flow.png" />
  <img src="/docs/demos/prep-flow.gif" alt="Prep reads public Zcash blocks, applies your range, fields and filters, and returns selected records as JSON." width="1040" height="600" />
</picture>

*How Prep selects public chain data for your application.*

:::info Prep & Chef
**Prep** provides public chain data for direct queries and custom pipelines. **[Chef](/docs/chef/overview/)** adds TypeScript handlers, PostgreSQL entities and GraphQL.
:::

## The Problem Prep Solves

Reading one transaction is straightforward. Building a useful history for an application also means choosing a range, finding relevant records and tracking scan completion.

- **Too much data to process** — A full block response can contain fields your application never uses.
- **Repeated filtering work** — Address-output searches and public pool analysis need consistent selection rules across many blocks.
- **Historical scan bookkeeping** — An empty result page can still have more history to scan; applications need a clear continuation boundary.

Prep handles range queries, public filters and field selection at the data layer, leaving your application to decide what to build from the results.

## Key Benefits

- **Focused responses** — [Select fields and filters](/docs/prep/fields/) to receive the public records your application needs.
- **Clear scan progress** — [Follow cursors](/docs/prep/continuation/) through a captured range, including pages with no matching transactions.
- **Public pool visibility** — Inspect distinct [Sapling, Orchard and Ironwood components](/docs/prep/shielded/) for your analysis.
- **Simple integration** — Use the [JavaScript / TypeScript client](/docs/prep/clients/) with native fetch and typed declarations, or call the HTTP API directly.
- **Your own application logic** — Query Prep directly for custom pipelines, or use [Chef](/docs/chef/overview/) to store application entities and serve GraphQL.

## Performance Benchmarks

Recorded **21 October 2026** on Zcash Testnet blocks **4,522,544–4,522,799 inclusive**: 256 blocks and 531 transactions, with real transparent, Sapling, Orchard and Ironwood activity. Times are medians of **three runs per candidate**, in **seconds (s)**, after verified warmups.

| Task | Returned rows | Prep | Zebra RPC |
| --- | ---: | ---: | ---: |
| Block headers | 256 | 0.003608 s | 0.262936 s |
| All transaction metadata | 531 | 0.159506 s | 0.347455 s |
| 16 selected TX IDs | 16 | 0.018925 s | 0.014246 s |
| Transactions paying one transparent address | 200 | 0.134044 s | 0.157427 s |
| Sapling component filter | 2 | 0.127810 s | 0.288864 s |
| Orchard component filter | 2 | 0.177232 s | 0.300796 s |
| Ironwood component filter | 181 | 0.142961 s | 0.287944 s |

All rows and digests matched. Zebra is faster for the selected TX IDs. The address lookup winner changed between trials, so it has no consistent ranking here. This compares warm service paths over loopback on a shared VPS, with unequal service quotas; it is not a universal performance claim. Preparing the new 256-block archive took **1.576383 s** separately in one direct run, excluding node initial sync.

See the [Prep benchmark methodology and recorded samples](/docs/prep/benchmarks/) for request counts, response sizes, cache conditions, preparation costs, resource limits and both complete trials.

## Use Cases

- **Transparent address analysis** — [Find transactions with outputs paying an address](/docs/prep/tutorials/address-outputs/) and inspect their public outputs.
- **Transaction explorers** — [Inspect transaction details](/docs/prep/tutorials/inspect-transaction/), distinguish block rewards, and show source-observed pending or mined status.
- **Shielded pool analytics** — Query [public Sapling, Orchard and Ironwood activity](/docs/prep/shielded/) to analyze component counts across a block range. Private note values and memos stay encrypted in public data.
- **Custom data pipelines** — [Stream selected history](/docs/prep/clients/) into your own analysis scripts or indexer, using fields and filters that fit the job.

## Quick links

[Quickstart](/docs/prep/quickstart/) · [Quickstart with AI](/docs/prep/quickstart-ai/) · [Benchmarks](/docs/prep/benchmarks/) · [Playground](https://zeer.endpx.cloud/app/prep) · [GitHub](https://github.com/EndPx/zeer)
