# From source to API

```text
Zcash → Prep → your application
          └→ Chef → PostgreSQL → GraphQL → your application
```

| Component | Responsibility |
| --- | --- |
| Prep | Store available public chain data and serve filtered queries |
| Chef | Process source data with your TypeScript handlers |
| PostgreSQL | Store entities, checkpoints and recovery history |
| GraphQL | Expose the committed application entities |

Use Prep directly for raw-data queries. Add Chef when you need your own persistent application model.

Entities are the records your handlers create. A checkpoint records the last block Chef fully saved, so a restart can continue from that point.

For authorized shielded notes, Chef uses a local scanner and the developer's viewing key before passing readable receipts to the handler. See [Shielded & Memos](/docs/chef/shielded/overview/).

## Share one Prep across applications

Several applications can use the same Prep endpoint while running separate Chef indexers. Each project has its own schema, handlers, checkpoint and database namespace. Projects can share PostgreSQL with separate namespaces or use separate databases; each namespace still permits only one active writer. Shielded scanners and viewing keys remain in each operator's environment.

Size the shared source for combined traffic, especially during backfill. Ten applications do not require ten Zcash nodes, but they do not automatically receive ten times the public preview's capacity. Check [source limits](/docs/prep/public-api/) and measure the combined workload; this release does not include a ten-application capacity benchmark.
