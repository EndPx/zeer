# Zeer Chef

**Zeer Chef** turns Zcash data into application entities with TypeScript handlers, PostgreSQL storage and a GraphQL API.

These guides target **Chef and CLI 0.7.0**. The Prep client has its own version, **0.1.0**. Your project's schema and installed SDK determine its API; the hosted Playground retains its separately deployed demo schema.

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
- **[Relationships and lists](/docs/chef/schema/#lists-and-relationships)** — connect records and query bounded nested results.
- **[GraphQL](/docs/chef/graphql/)** — query committed entities and checkpoint metadata.
- **[Recovery](/docs/chef/recovery/)** — resume checkpoints and handle supported reorgs.
- **[Shielded & Memos](/docs/chef/shielded/overview/)** — read authorized notes through a local testnet scanner.

## Performance Benchmarks

Recorded **20 October 2026** over blocks **0–9,999 inclusive**. Chef started with an empty project namespace and produced **10,000 BlockSummary entities**, with a separate GraphQL process serving reads during indexing. Durations are in **seconds (s)**.

| Chef input profile | First data observed in GraphQL | 10,000 entities indexed |
| --- | ---: | ---: |
| Fixed source pages, 32-block commits | 1.201 s | 36.696 s |
| Adaptive source pages, 32-block commits | 1.591 s | 35.215 s |

Each profile has one recorded run. The timer includes CLI startup, Prep reads, handler execution, PostgreSQL commits and polling through completion. Both runs reached checkpoint 9,999 with identical entity results.

These are historical block-summary measurements. The later [Chef 0.6.1 address-analytics study](/docs/chef/benchmarks/#address-analytics-with-chef-061) separately measures a 512-block application replay with concurrent GraphQL reads. The [0.6.0 acceptance record](https://github.com/EndPx/zeer/blob/main/docs/CHEF_060_ACCEPTANCE.md) verifies the runtime's package installation, transaction breakdown and restart behavior; 0.6.1 retains that runtime. [Chef 0.7.0 operational acceptance](https://github.com/EndPx/zeer/blob/main/docs/CHEF_070_ACCEPTANCE.md) separately verifies the heartbeat, diagnosis and source-interruption workflow.

See the [Chef benchmark methodology and recorded samples](/docs/chef/benchmarks/) for timing boundaries, resource limits and evidence.

To tune your own project, start with [Database / Queries](/docs/chef/database-performance/), [Latency at the Head](/docs/chef/latency-at-head/) or [Benchmarking](/docs/chef/benchmarking/), depending on the delay you observe.

## Use Cases

- **Application backends** — Turn chain data into your own entity model and give a frontend an authenticated [GraphQL API](/docs/chef/graphql/).
- **Activity dashboards** — Use [block handlers](/docs/chef/block-handlers/) and [transaction handlers](/docs/chef/handlers/) to store counts and summaries for charts, reports or historical analysis.
- **Specialized explorers** — Model [transaction inputs and outputs](/docs/chef/handlers/#transparent-inputs-and-outputs) as related entities, with exact values and explicit unresolved history.
- **Monitoring and notifications** — Poll bounded entity ranges from a separate consumer and deliver notifications after applying your recovery policy. Chef does not provide subscriptions, webhooks or a durable change feed.
- **Payment inboxes and relayers** — Run the [local shielded scanner](/docs/chef/shielded/overview/) to index readable notes, exact received amounts and memos. Your application matches receipts to orders and checks confirmations and canonicality before authorizing a payout.

## Quick links

[Quickstart](/docs/chef/quickstart/) · [Quickstart with AI](/docs/chef/quickstart-ai/) · [Benchmarks](/docs/chef/benchmarks/) · [Playground](https://zeer.endpx.cloud/app/chef) · [GitHub](https://github.com/EndPx/zeer)
