# Chef examples

| Example | Purpose | Guide |
| --- | --- | --- |
| Block summaries | Metadata → BlockSummary → GraphQL | [Quickstart](/docs/chef/quickstart/) |
| Filtered Orchard transactions | Public predicate → transaction entities | [Source](https://github.com/EndPx/zeer/tree/main/examples/chef-filtered) |
| Shielded inbox | Local scanner → private receipts and memos | [Local setup](/docs/chef/shielded/local/) |
| Standalone receipt consumer | Bounded or continuous block-scoped queries → private SQLite; restart and reorg reconciliation | [Source and setup](https://github.com/EndPx/zeer/tree/main/examples/receipt-consumer) |
| Historical fixture replay | Reproducible offline public-data example | [Source](https://github.com/EndPx/zeer/tree/main/examples/quickstart) |

Try the public BlockSummary presets in [Chef Playground](https://zeer.endpx.cloud/app/chef).

**Notes:** The older fixture example uses labelled mainnet history. For your own projection, choose a fresh namespace and check the source range.
