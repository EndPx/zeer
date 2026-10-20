# Transaction lookup & mempool

Use [Prep's transaction inspector](https://zeer.endpx.cloud/app/prep?view=transaction) or the optional live observation routes:

| Route | Input / output |
| --- | --- |
| `POST /transaction` | A body with `txid`: a 64-character lowercase hex ID |
| `GET /mempool` | Up to 20 metadata rows plus the observed source total |

| Status | Meaning |
| --- | --- |
| `pending` | Currently observed in the configured node's mempool |
| `mined` | Observed in a source block |
| `not_observed` | Not returned by that source lookup |

The inspector shows available overview, inputs/outputs and raw data. Coinbase classification uses the actual input marker. Public pool components remain distinct from private note data.

**Notes:** An archive miss does not imply pending. Live observations can change between requests and require a configured, available node source. See [the live contract](https://github.com/EndPx/zeer/blob/main/docs/PUBLIC_SHIELDED.md) for response details.
