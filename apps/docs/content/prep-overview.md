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

Recorded **20 October 2026** over blocks **0–99,023 inclusive** in a prepared Zcash Testnet archive. Times are medians of **three runs per mode**, in **seconds (s)**. The comparison is between fixed and adaptive Prep scans on a shared VPS over loopback.

| Task | Fixed Prep | Adaptive Prep | Speedup |
| --- | ---: | ---: | ---: |
| Retrieve 99,024 block headers | 0.967156 s | 0.689918 s | 1.40× |
| Find the genesis transaction ID | 0.234639 s | 0.004171 s | 56.26× |
| Orchard filter (0 matches) | 0.418542 s | 0.108843 s | 3.85× |

Both modes returned matching row counts and digests. The empty Orchard scan does not measure modern shielded-transaction processing. Timings include response retrieval, decoding and incremental row hashing; source preparation is excluded.

See the [full benchmark methodology and recorded samples](/docs/chef/benchmarks/#prep-retrieval) for page counts, resource limits and evidence.

## Use Cases

- **Transparent address analysis** — [Find transactions with outputs paying an address](/docs/prep/tutorials/address-outputs/) and inspect their public outputs.
- **Transaction explorers** — [Inspect transaction details](/docs/prep/tutorials/inspect-transaction/), distinguish block rewards, and show source-observed pending or mined status.
- **Shielded pool analytics** — Query [public Sapling, Orchard and Ironwood activity](/docs/prep/shielded/) to analyze component counts across a block range. Private note values and memos stay encrypted in public data.
- **Custom data pipelines** — [Stream selected history](/docs/prep/clients/) into your own analysis scripts or indexer, using fields and filters that fit the job.

## Quick links

[Quickstart](/docs/prep/quickstart/) · [Quickstart with AI](/docs/prep/quickstart-ai/) · [Benchmarks](/docs/chef/benchmarks/#prep-retrieval) · [Playground](https://zeer.endpx.cloud/app/prep) · [GitHub](https://github.com/EndPx/zeer)
