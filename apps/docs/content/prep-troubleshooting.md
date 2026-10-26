# Troubleshooting

| Problem | Check or action |
| --- | --- |
| Empty transaction page | Check `next_block` and `cursor`; continue if the cursor is non-null. |
| Invalid range | Compare the request with `/height` coverage. `to_block` is exclusive. |
| HTTP 400 | Check field names, duplicate selections, filter syntax and endpoint capabilities. |
| HTTP 409 `REORG` | A chain or physical-layout epoch changed. Discard the old cursor, recheck canonicality and reconcile before restarting. |
| Rate limited | Honor `Retry-After` and use bounded backoff. |
| Source unavailable | Check `/ready` and `/height`; process liveness alone is insufficient. |
| `catalog segment count` / `catalog_consolidation_required` | Run `build-info` on the exact writer executable used by the service. Use bounded lossless consolidation; preserve history and existing Chef projects. |
| Authentication rejected | Verify the intended endpoint and its bearer-token policy. |
| SDK timeout | Check request/stream deadlines and the caller's cancellation signal. |
| Transaction not found | Check the queried range; an archive miss does not imply pending. |
| No memo text in Prep | Use [Chef's local memo workflow](/docs/chef/shielded/local/) for authorized notes. |

Keep the HTTP status, error code and public request parameters when debugging. Redact credentials. See [the query contract](/docs/prep/query/) and [client options](/docs/prep/clients/) for details.

The [27 October catalog recovery report](https://github.com/EndPx/zeer/blob/main/docs/PREP_CATALOG_INCIDENT_20261027.md) records the 30,000-reference incident and its verification. Follow now publishes new blocks promptly and consolidates bounded historical groups. All replacement records are compared before atomic publication; retired source files remain for old reader snapshots. Compression-only repack does not reduce reference count. The [operator command](https://github.com/EndPx/zeer/blob/main/docs/PREP_ENGINE.md#bounded-catalog-consolidation) preserves history and performs no RPC; resume follow for genuine fresh readiness rather than editing timestamps.
