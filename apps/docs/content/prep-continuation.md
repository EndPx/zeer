# Continuation & historical scans

Keep the original query unchanged and add the returned cursor for each next page:

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

The [client's](/docs/prep/clients/) `stream()` method handles these cursor pages through one finite captured range.

**Notes:**

- `cursor: null` completes the captured range. Empty transaction results do not end a scan by themselves.
- Do not change fields, filters or the original start while retaining a cursor.
- After `REORG`, reconcile persisted results before starting a new scan.

The same 409 code also covers physical-layout invalidation during lossless catalog consolidation. That event can preserve every block and still invalidate a captured cursor. Re-observe the source and canonical headers; do not infer an actual chain fork solely from the error name.
