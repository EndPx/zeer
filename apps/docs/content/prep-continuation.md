# Continuation & historical scans

Prep responses are bounded. A large requested history can span multiple responses even when no explicit `limit` is supplied.

## A cursor pins the scan

The first request captures the scan's available end when `to_block` is omitted. Continue with **the same original request plus the returned cursor**. Keep the original `from_block`, fields and filters. Do not replace `from_block` with `next_block` while retaining that cursor.

`next_block` reports scan progress. A non-null `cursor` means the captured range still has work; `cursor: null` means that range has completed.

## An empty page can still make progress

A transaction filter may match nothing in early history or in a quiet range. Empty `data.transactions` is not evidence that the whole history has no matches. Check the scanned range and cursor.

## Fetch pages in JavaScript

This plain HTTP example keeps the original query intact. Use Node's built-in `fetch` or a compatible browser environment. The public preview has shared request quotas, so it pauses between continuation requests.

```js
const query = {
  from_block: 0,
  to_block: 2,
  field_selection: { block: ["height", "hash", "time"], transaction: [] },
};
let cursor;
do {
  const response = await fetch("https://zeer.endpx.cloud/api/prep/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...query, ...(cursor ? { cursor } : {}) }),
  });
  if (!response.ok) throw new Error(`Prep returned HTTP ${response.status}`);
  const page = await response.json();
  console.log(page.data.blocks);
  cursor = page.cursor;
  if (cursor) await new Promise(resolve => setTimeout(resolve, 1000));
} while (cursor);
```

Use a bounded range first. After installing the unpublished client through the documented local-tarball workflow, `PrepClient.stream()` can handle continuation over a fixed available range. See the [public API example](/docs/prep/public-api/).

## Snapshot changes and failures

An epoch change or invalidated pinned snapshot can return HTTP 409 with `REORG`. Discard the old cursor, re-read coverage, and restart or reconcile the scan according to your application's persistence policy. Do not append a restarted scan blindly to already stored rows without stable identities and reconciliation.

Respect rate-limit and source-recovery responses with backoff. The raw query contract specifies the [transport bounds and error codes](/docs/prep/query/).
