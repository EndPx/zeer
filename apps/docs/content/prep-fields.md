# Filters & field selection

## Field selection

```json
{
  "from_block": 0,
  "field_selection": {
    "block": ["height", "hash", "time"],
    "transaction": ["txid", "block_height", "version", "size_bytes"]
  }
}
```

| Block field | Value |
| --- | --- |
| `height` | Block height |
| `hash`, `previous_hash` | Block hashes |
| `time` | Unix timestamp in seconds |
| `raw`, `decoded` | Full serialized hex or stored node-decoded block |

| Transaction field | Value |
| --- | --- |
| `txid`, `block_height` | ID and containing height |
| `index` | Zero-based position within the block |
| `version`, `locktime`, `expiry_height` | Public format metadata |
| `size_bytes` | Serialized byte length |
| `transparent_input_count`, `transparent_output_count` | Input/output array lengths |
| `sapling_spend_count`, `sapling_output_count` | Public Sapling component counts |
| `orchard_action_count`, `ironwood_action_count` | Public action counts |
| `is_coinbase`, `transaction_type` | Block-reward flag and public classification |
| `vin`, `vout` | Decoded transparent inputs/outputs |
| `raw`, `decoded` | Full transaction hex or node-decoded object |

An empty selection array omits that collection. Selecting block `decoded` returns the full stored block, including its nested transactions.

## Filters

| Filter | Matches |
| --- | --- |
| `txids`, `versions` | Any listed ID or version |
| `transparent_output_addresses` | Any listed public output address |
| `has_sapling`, `has_orchard`, `has_ironwood` | Presence/absence of that pool's public components |
| `shielded_pools` | Any listed pool: `sapling`, `orchard`, `ironwood` |
| `is_coinbase` | The actual block-reward input marker |

Different filter properties combine with AND; values within a list combine with OR. An empty list matches nothing. Transaction filters do not remove selected block headers.

**Notes:** Nested numbers in decoded JSON are strings; preserve exact values. Pool component counts do not count payments. Unknown or duplicate selections are rejected. See [the full contract](https://github.com/EndPx/zeer/blob/main/docs/PREP_QUERY.md) for field and filter bounds.
