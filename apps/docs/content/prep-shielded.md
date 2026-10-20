# Public shielded activity

Query public components of Sapling, Orchard and Ironwood transactions.

| Pool | Public fields |
| --- | --- |
| Sapling | `sapling_spend_count`, `sapling_output_count` |
| Orchard | `orchard_action_count` |
| Ironwood | `ironwood_action_count` |

```json
{
  "from_block": 0,
  "transaction_filter": { "shielded_pools": ["sapling", "orchard", "ironwood"] },
  "field_selection": {
    "block": [],
    "transaction": ["txid", "block_height", "sapling_spend_count", "sapling_output_count", "orchard_action_count", "ironwood_action_count"]
  }
}
```

`shielded_pools` matches any listed pool. Separate `has_sapling`, `has_orchard` and `has_ironwood` predicates combine with AND when used together.

**Notes:**

- Counts describe public components and can include dummy actions; they are not payment counts.
- Private recipients, individual note values and memo text require [authorized local scanning](/docs/chef/shielded/local/).
- Early history may predate pool activation. Follow the [cursor](/docs/prep/continuation/) to finish the scan, or try the playground's verified sample.
