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

For authorized shielded notes, Chef uses a local scanner and the developer's viewing key before passing readable receipts to the handler. See [Shielded & Memos](/docs/chef/shielded/overview/).
