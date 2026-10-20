# Query & response

Send a JSON request to `POST /query` relative to your Prep base URL.

## Request

```json
{
  "from_block": 0,
  "to_block": 2,
  "field_selection": {
    "block": ["height", "hash", "time"],
    "transaction": []
  }
}
```

| Property | Meaning |
| --- | --- |
| `from_block` | Required inclusive start |
| `to_block` | Optional exclusive end; omitted captures the available end |
| `field_selection` | Requested block/transaction field arrays |
| `transaction_filter` | Public transaction predicates |
| `cursor` | Opaque continuation returned by the previous page |
| `limit` | Optional scanned-block ceiling, not a matching-row count |
| `scan_mode` | Optional `adaptive` mode for an explicit limit |

Omitting `limit` uses adaptive scanning. Responses remain time/byte bounded. See [fields and filters](/docs/prep/fields/) for available selections and [preview limits](/docs/prep/public-api/) for the hosted endpoint.

## Response

| Property | Meaning |
| --- | --- |
| `network` | Source network identifier |
| `archive_height` | Available archive height |
| `epoch`, `revision` | Archive snapshot identifiers, as decimal strings |
| `from_block`, `to_block` | Query bounds |
| `next_block` | Scan progress |
| `cursor` | Continuation, or `null` when the captured range is complete |
| `canonicality` | Source canonicality description |
| `data.blocks` | Selected block records |
| `data.transactions` | Selected matching transactions |

Continue with the **same original request plus the returned cursor**. Do not replace `from_block` with `next_block` while retaining that cursor. Empty matches can still advance the scan.

**Notes:** A changed snapshot can return HTTP 409 `REORG`. Reconcile before restarting. HTTP 413 can require a smaller field selection. The [full HTTP contract](https://github.com/EndPx/zeer/blob/main/docs/PREP_QUERY.md) contains protocol bounds and detailed error behavior.
