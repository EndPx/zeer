# Troubleshooting

| Problem | Check or action |
| --- | --- |
| Empty transaction page | Check `next_block` and `cursor`; continue if the cursor is non-null. |
| Invalid range | Compare the request with `/height` coverage. `to_block` is exclusive. |
| HTTP 400 | Check field names, duplicate selections, filter syntax and endpoint capabilities. |
| HTTP 409 `REORG` | Discard the old cursor and reconcile stored results before restarting. |
| Rate limited | Honor `Retry-After` and use bounded backoff. |
| Source unavailable | Check `/ready` and `/height`; process liveness alone is insufficient. |
| Authentication rejected | Verify the intended endpoint and its bearer-token policy. |
| SDK timeout | Check request/stream deadlines and the caller's cancellation signal. |
| Transaction not found | Check the queried range; an archive miss does not imply pending. |
| No memo text in Prep | Use [Chef's local memo workflow](/docs/chef/shielded/local/) for authorized notes. |

Keep the HTTP status, error code and public request parameters when debugging. Redact credentials. See [the query contract](/docs/prep/query/) and [client options](/docs/prep/clients/) for details.
