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

## Key features

- **[Range queries](/docs/prep/query/)** — read available block history.
- **[Fields & filters](/docs/prep/fields/)** — return the public records and fields you need.
- **[Continuation](/docs/prep/continuation/)** — page through a captured historical range.
- **[Public shielded activity](/docs/prep/shielded/)** — inspect Sapling, Orchard and Ironwood components.
- **[JavaScript / TypeScript client](/docs/prep/clients/)** — integrate with native fetch and typed declarations.

## Quick links

[Quickstart](/docs/prep/quickstart/) · [Quickstart with AI](/docs/prep/quickstart-ai/) · [Benchmarks](/docs/chef/benchmarks/#prep-retrieval) · [Playground](https://zeer.endpx.cloud/app/prep) · [GitHub](https://github.com/EndPx/zeer)
