# Filters & field selection

Field selection controls returned data. Filters control which public transactions match. They are independent parts of a Prep query.

## Start with a small projection

```json
{
  "from_block": 0,
  "field_selection": {
    "block": ["height", "hash", "time"],
    "transaction": ["txid", "block_height", "version", "size_bytes"]
  }
}
```

| Field | Meaning |
| --- | --- |
| Block `height`, `hash`, `previous_hash`, `time` | Block identity, linkage and source timestamp |
| Transaction `txid`, `block_height` | Transaction identity and containing block |
| `index` | Zero-based position within its block; the first transaction has position 0 |
| `version`, `locktime` | Public transaction metadata |
| `size_bytes` | Validated serialized transaction length |
| `vin`, `vout` | Public decoded transparent inputs and outputs |
| `raw`, `decoded` | Complete stored serialization or node-decoded structure |

Use `block: []` or `transaction: []` to suppress a collection. Direct count fields avoid downloading entire decoded transactions. See [the complete field tables](/docs/prep/query/) and [shielded structure reference](/docs/prep/shielded/) for the supported projection names.

## Combine predicates deliberately

```json
{
  "from_block": 0,
  "field_selection": {"block": [], "transaction": ["txid", "block_height"]},
  "transaction_filter": {"has_orchard": true, "versions": [5, 6]}
}
```

Properties within `transaction_filter` combine with **AND**. The version array above matches either selected version. An empty predicate array matches nothing.

Use `shielded_pools: ["sapling", "orchard", "ironwood"]` for a union of the named pools. Setting separate `has_sapling` and `has_orchard` booleans to true instead requires both predicates. Keep pool names and boolean presence predicates distinct.

Other public filters include transaction IDs and transparent output addresses. A transparent output match is not universal sender history. Encrypted recipient addresses and memo text are not public filter fields.

## Preserve exact values

Top-level bounded metadata fields are JSON numbers. Numbers nested inside decoded objects are strings to preserve their source representation. Keep zatoshis as integer values and use appropriate decimal handling when interpreting source amounts; avoid floating-point accounting.

Full decoded and raw payloads can be large. Select only fields needed by your application and honor continuation and response errors.
