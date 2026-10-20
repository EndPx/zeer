# Coverage, access & preview limits

Base URL: `https://zeer.endpx.cloud/api/prep`

| Check | Route |
| --- | --- |
| Process liveness | `GET /health` |
| Source/archive readiness | `GET /ready` |
| Network and available block range | `GET /height` |
| Supported protocol features | `GET /capabilities` |

## Hosted preview limits

| Limit | Value |
| --- | --- |
| Authentication | No personal token required |
| Shared ingress | 2 requests/second, burst 8 |
| Active upstream requests | 2, shared with console traffic |
| Request body / ingress response | 16,128 bytes / 8 MiB |
| Ingress deadline | 15 seconds |
| Adaptive scan | Up to 1,000,000 blocks, 500 ms soft work slice, 512 KiB target, 4 MiB hard response cap |
| Transaction-ID lookup | Up to 1,000 blocks and 128 IDs |

**Notes:** These are shared preview limits. Check readiness and available coverage before querying. Omitted scan limits still produce bounded responses; follow the returned cursor. The [full preview contract](https://github.com/EndPx/zeer/blob/main/docs/PUBLIC_API.md) documents operational details.
