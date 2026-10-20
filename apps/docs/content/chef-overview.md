# Zeer Chef

**Zeer Chef** turns Zcash data into application entities with TypeScript handlers, PostgreSQL storage and a GraphQL API.

<picture class="overview-demo">
  <source media="(prefers-reduced-motion: reduce)" srcset="/docs/demos/chef-query.png" />
  <img src="/docs/demos/chef-query.gif" alt="A public Chef GraphQL query returning the genesis block." width="1040" height="600" />
</picture>

*Recorded public testnet query.*

:::info Chef & Prep
**Chef** defines and stores your application model. **[Prep](/docs/prep/overview/)** supplies the public block and transaction data; applications can also query Prep directly.
:::

## Key features

- **[TypeScript handlers](/docs/chef/handlers/)** — transform blocks, transactions and authorized receipts.
- **[Entity schemas](/docs/chef/schema/)** — define the records stored in PostgreSQL.
- **[GraphQL](/docs/chef/graphql/)** — query committed entities and checkpoint metadata.
- **[Recovery](/docs/chef/recovery/)** — resume checkpoints and handle supported reorgs.
- **[Shielded & Memos](/docs/chef/shielded/overview/)** — read authorized notes through a local testnet scanner.

## Quick links

[Quickstart](/docs/chef/quickstart/) · [Quickstart with AI](/docs/chef/quickstart-ai/) · [Playground](https://zeer.endpx.cloud/app/chef) · [GitHub](https://github.com/EndPx/zeer)
