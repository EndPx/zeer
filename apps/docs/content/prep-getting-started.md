# Getting started with Prep

The [Quickstart](/docs/prep/quickstart/) gets one request working. This guide explains the decisions that turn that request into a repeatable application integration.

## 1. Choose your connection

Use `https://zeer.endpx.cloud/api/prep` for the shared public testnet preview, or your own compatible Prep endpoint for operator-controlled workloads. Read [API access & tokens](/docs/prep/tokens/) before connecting to a protected deployment.

Plain HTTP is enough for a first integration. The [JavaScript/TypeScript client](/docs/prep/clients/) adds typed declarations, protocol validation, bounded response handling and cursor-based streaming.

## 2. Inspect the source

`GET /height` reports available archive coverage and readiness. Check `start_block`, a non-null `indexed_height` and `ready` before selecting a range. The network identity must match your application.

`GET /capabilities` describes compiled features and bounds. Feature support is separate from current source readiness. An optional live node source can be configured and still become unavailable.

## 3. Choose the records and fields

Start with block headers or transaction metadata. Select raw or decoded payloads only when needed. Use public transaction filters to reduce irrelevant data; encrypted recipients and memo text are not public predicates.

For example, this is a header-only request:

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

The end is exclusive. See [Filters & field selection](/docs/prep/fields/) and the full [Query & response](/docs/prep/query/) contract.

## 4. Plan for continuation

Keep the original request and returned cursor together. A non-null cursor means there is more of the captured range to scan, including when no transactions matched this page. Omitting a fixed scan size does not remove server time/byte bounds.

`stream()` follows one finite captured range. It does not automatically become an ongoing chain follower. A snapshot change needs an explicit reconciliation policy, not concatenation of incompatible results.

## 5. Handle operational outcomes

Use backoff for shared-preview overload and source-recovery responses. Keep timeouts, cancellation and application persistence explicit. Preserve exact integer/decimal values and distinguish a source error from an empty successful response.

For a database projection with ordered handlers and checkpoints, use [Zeer Chef](/docs/chef/overview/). For a direct integration, continue with [Clients](/docs/prep/clients/), [cURL examples](/docs/prep/curl/) and [Troubleshooting](/docs/prep/troubleshooting/).
