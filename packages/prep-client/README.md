# @zeer/prep-client

Unpublished, dependency-free JavaScript ESM implementation with TypeScript
declarations. Requires Node 22.18+ and native `fetch`. This is an HTTP client for
the Prep full-block archive; it is not a wallet SDK or native Rust binding.

Use this package locally from the repository. No public npm publication is implied.

For large historical scans on a compatible server, inspect
`(await client.getCapabilities()).query.max_adaptive_scan_blocks`, then pass
`scan_mode: "adaptive"` and a `limit` up to 1,000,000 to `get` or `stream`.
The server returns bounded partial pages after its soft time slice or byte
ceiling; `stream` follows their cursors. This does not mean unlimited results or
that an empty first page proves absence over the entire range.
Keep the original query and its cursor together. Fixed queries retain the
1,000-block limit. See [the scan contract](../../docs/PREP_QUERY.md).

For one bounded lookup rather than paginating through a block range:

```ts
const capabilities = await client.getCapabilities();
const result = await client.getTransactions({
  from_block: 1,
  to_block: 2049,
  txids: transactionIds, // up to 128 entries
});
const next = await client.getTransactions({
  from_block: 1,
  to_block: 2049,
  txids: anotherIdSet,
  at: result.snapshot, // same canonical prefix; an append beyond it is allowed
});
```

The configured `client` is constructed below. `getTransactions` defaults to eight
public metadata fields, including canonical height/index. Optional `fields` must
include `txid`, `block_height`, and `index`. Limits are 10,000 blocks, 4,096 result
locations and 4 MiB. Every requested unique ID is accounted for by matching rows
or `missing_txids`; absence is scoped to that completed range. Duplicate input
IDs do not duplicate rows, while multiple canonical locations are preserved.
The client rejects partial/unrequested/unsorted responses and changed snapshots.
These methods use the existing auth, timeout, cancellation and typed errors.
They require a server implementing the new routes. Capabilities report supported
protocol features; `getHeight()` reports current readiness and archive coverage.

For compact public transaction metadata, select `size_bytes`,
`transparent_input_count`, and `transparent_output_count` alongside `txid`,
`block_height`, `version`, and `locktime`. These are bounded JSON integers and do
not require transferring full decoded input/output objects. They require a Prep
server with the transaction metadata extension; older servers reject unknown
selected fields. Unknown or duplicate selections are rejected by the client
before transport. Existing defaults and lossless decoded-number handling remain.

```ts
import { PrepClient, ReorgError } from "@zeer/prep-client";

const client = new PrepClient({
  url: "http://127.0.0.1:39368",
  token: process.env.PREP_API_TOKEN,
  timeoutMs: 30_000,
});

const height = await client.getHeight();
console.log(height.indexed_height, height.source_height, height.lag_blocks);

try {
  for await (const page of client.stream({
    from_block: 100,
    to_block: 200, // exclusive; omitting captures the head on the first page
    limit: 25,    // scanned blocks, not matching transactions
    field_selection: {
      block: ["height", "hash"],
      transaction: ["txid", "block_height", "index", "raw", "vout"],
    },
  }, { totalTimeoutMs: 120_000 })) {
    // Persist application effects and the continuation together if necessary.
    // Stream never restarts automatically or combines results from another epoch.
    console.log(page.next_block, page.data.transactions);
  }
} catch (error) {
  if (error instanceof ReorgError) {
    // Reconcile the application's prior effects against the current archive.
    // Blindly resuming or repeating financial side effects is not safe.
    throw error;
  }
  throw error;
}
```

`get(query)` fetches one page. Continue with the same original request plus its
cursor. `stream(query)` follows cursor pages to one finite captured end; it does
not follow the chain forever. Empty filtered pages still advance. New appended
blocks do not extend an in-flight stream. A changed epoch or HTTP 409 `REORG`
throws `ReorgError`, with no retry or implicit restart.

`getHeight()` returns nullable indexed/source heights, observed lag, source status,
and decimal-string epoch/revision. Readiness describes the configured source and
historical archive, not independent consensus or guaranteed live canonicality.

The default timeout is 30 seconds per request and 120 seconds for the whole
stream, including time the consumer spends between pages. Pass `signal` for caller
cancellation; abort/timeout exceptions preserve the native signal reason. A finite
`maxPages` guard defaults to 100,000. The client bounds response bodies to 32 MiB,
rejects malformed/nonadvancing continuations, and does not retry requests silently.

Every nested number in transaction `vin`/`vout`/`decoded` and whole-block `decoded`
is a **string**, preserving exact
node JSON monetary values before JavaScript parses them. The client rejects rich
decoded responses containing numeric tokens. Use exact decimals/integers rather
than `Number` for amounts. Top-level heights/indexes/versions are bounded integers.
The `raw` block/transaction fields contain complete serialized bytes encoded as hex.

Select block `decoded` to retrieve every stored source field, including nonce,
bits, roots, transaction objects, and additional source properties. This whole
object is returned even when the separate transaction selection is empty; its
nested transactions are not trimmed by transaction filters. Header-only requests
omit both block `raw` and `decoded` and use the cached header path.

Transparent output address filters support public `scriptPubKey` address strings
only. They cannot reveal shielded recipients or resolve input addresses. See the
[full API contract](../../docs/PREP_QUERY.md) for all fields, filter semantics, and
source trust limits.

Keep bearer tokens on a trusted backend and use HTTPS when crossing an untrusted
network. The package never accepts wallet keys. HTTP redirects are rejected so an
authorization header is not silently forwarded to another endpoint.

Run the offline and local HTTP client tests:

```sh
node --test packages/prep-client/test/client.test.js
```
