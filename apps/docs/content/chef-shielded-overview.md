# Shielded receipts & privacy

Chef's opt-in local scanner reads incoming testnet notes authorized by your Unified Full Viewing Key (UFVK), then passes receipts to a TypeScript handler.

```text
Prep transaction bytes → local scanner + UFVK → receipt handler → PostgreSQL → GraphQL
```

| Pool | Current receipt profile |
| --- | --- |
| Sapling | Supported |
| Orchard | Supported |
| Ironwood | Supported |
| Sprout | Unsupported |

Receipts include a stable note ID, pool/output position, exact `value_zat`, receiver component, memo bytes, scope and coinbase flag. Chef commits the projection with its checkpoint and recovery information.

**Notes:**

- This is an experimental testnet-only profile. The scanner reads a protected local UFVK file; public Prep does not accept viewing keys.
- A receipt is a note observation, not a spendable balance or settlement approval.

[Set up the local scanner](/docs/chef/shielded/local/) · [Read memos](/docs/chef/shielded/memos/) · [Full receipt contract](https://github.com/EndPx/zeer/blob/main/docs/SHIELDED_RECEIPTS.md)
