# Zeer Chef

**Zeer Chef** turns Zcash data into application entities with TypeScript handlers, PostgreSQL storage and a GraphQL API.

<picture class="overview-demo">
  <source media="(prefers-reduced-motion: reduce)" srcset="/docs/demos/chef-flow.png" />
  <img src="/docs/demos/chef-flow.gif" alt="Chef processes Prep data through TypeScript handlers, stores entities in PostgreSQL and serves committed data through GraphQL." width="1040" height="600" />
</picture>

*How Chef turns chain data into your application API.*

:::info Chef & Prep
**Chef** defines and stores your application model. **[Prep](/docs/prep/overview/)** supplies the public block and transaction data; applications can also query Prep directly.
:::

## Key features

- **[TypeScript handlers](/docs/chef/handlers/)** — transform blocks, transactions and authorized receipts.
- **[Entity schemas](/docs/chef/schema/)** — define the records stored in PostgreSQL.
- **[GraphQL](/docs/chef/graphql/)** — query committed entities and checkpoint metadata.
- **[Recovery](/docs/chef/recovery/)** — resume checkpoints and handle supported reorgs.
- **[Shielded & Memos](/docs/chef/shielded/overview/)** — read authorized notes through a local testnet scanner.

## Use Cases

- **Application backends** — Turn chain data into your own entity model and give a frontend an authenticated [GraphQL API](/docs/chef/graphql/).
- **Activity dashboards** — Use [block handlers](/docs/chef/block-handlers/) and [transaction handlers](/docs/chef/handlers/) to store counts and summaries for charts, reports or historical analysis.
- **Payment inboxes and relayers** — Run the [local shielded scanner](/docs/chef/shielded/overview/) to index readable notes, exact received amounts and memos. Your application matches receipts to orders and checks confirmations and canonicality before authorizing a payout.

## Quick links

[Quickstart](/docs/chef/quickstart/) · [Quickstart with AI](/docs/chef/quickstart-ai/) · [Benchmarks](/docs/chef/benchmarks/) · [Playground](https://zeer.endpx.cloud/app/chef) · [GitHub](https://github.com/EndPx/zeer)
