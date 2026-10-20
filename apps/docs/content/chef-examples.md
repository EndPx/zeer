# Chef examples

Choose the smallest example that exercises your application's data path.

| Example | Data path | Start here |
| --- | --- | --- |
| Standalone block summaries | Public transaction metadata → BlockSummary → GraphQL | [Chef quickstart](/docs/chef/quickstart/) |
| Filtered Orchard transactions | Public Orchard predicate → transactionMetadata handler → entities | [Filtered genesis example](https://github.com/EndPx/zeer/tree/main/examples/chef-filtered) |
| Shielded inbox | Full transaction bytes → local scanner → receipt handler → private notes/memos | [Local setup](/docs/chef/shielded/local/) |
| Small offline historical replay | Explicitly labelled fixture history → public entity projection | [Fixture quickstart](https://github.com/EndPx/zeer/tree/main/examples/quickstart) |

The older fixture quickstart uses historical mainnet fixtures. It is useful for reproducibility, but it is not a live testnet service. Do not relabel those records as testnet.

## Try the public Chef playground

[Open Chef Playground](https://zeer.endpx.cloud/app/chef). The public project offers BlockSummary examples for browsing, genesis, an exact height, comparing heights, the checkpoint and the latest observed block. Inspect the returned `_meta` and coverage information.

The public project's configured scope follows block zero through the available Prep history. The observed committed checkpoint determines how much of that scope is actually queryable at a given moment. Choosing an example does not make future blocks available.

## Build a different application model

Copy an example into your own project, choose a fresh project namespace, and adapt its schema and handlers. Compare complete expected entity values and checkpoint hashes at a known range before extending the workload. [Testing](/docs/chef/testing/) explains the evidence to collect.
