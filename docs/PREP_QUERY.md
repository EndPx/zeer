# Prep HTTP query contract

This is the first experimental full-block query API. Prep stores public chain data;
it does not decrypt shielded recipients, amounts or memos. It does not implement
EVM logs, wallet spending, or application GraphQL. The TypeScript application layer
is separate. This contract is original Zeer code, not copied HyperSync source.

## Transport and deployment

The HTTP server reads a `full-v1` archive. Compact-only archives cannot satisfy this
API and return `FULL_BLOCK_ARCHIVE_REQUIRED`. Legacy immutable-snapshot gRPC is a
separate transport with its own representation contract.

Local development is the intended deployment. Binding beyond loopback is an
explicit CLI choice. Set `PREP_API_TOKEN` to enable a deployment-wide bearer token;
all four routes require it when configured. Use TLS termination for remote access.
There is no browser CORS policy, account tenancy, billing, or public production
deployment claim. Never put a private deployment token into a public browser bundle.

| Method / route | Response |
| --- | --- |
| `GET /health` | Process liveness, independent of source freshness |
| `GET /ready` | Archive/source readiness; HTTP 503 when not ready |
| `GET /height` | Indexed coverage and latest available source-status metadata |
| `POST /query` | Bounded JSON field projection and continuation |

`POST /query.bin` is not implemented in this slice. SDK and examples use JSON.

## Height and source status

`/height` and `/ready` return:

```json
{
  "archive_height": 100,
  "indexed_height": 100,
  "start_block": 1,
  "source_height": 110,
  "lag_blocks": 10,
  "source_observed_at": 1700000000,
  "network": "mainnet",
  "epoch": "0",
  "revision": "4",
  "payload_kind": "full-v1",
  "ready": true,
  "source_mode": "historical_snapshot",
  "state": "FRESHNESS_UNKNOWN",
  "canonicality": "historical_snapshot_not_independently_consensus_validated"
}
```

Values above are illustrative. An empty archive has a null indexed height and is
not ready. Source height/lag/time are nullable when unknown. `source_observed_at`
is Unix seconds from a successful source-status publication, not a blockchain
timestamp or promise that the source remains current. A failed status does not
invent a fresh successful observation time. Epoch and revision are decimal strings
to preserve the storage's `u64` counters in JavaScript.

The server refreshes the immutable catalog before querying and before returning a
query. A status file that says `ready: false`, is malformed, has mismatched epoch,
revision or indexed height, or disappears after being observed makes queries fail
with HTTP 503. Catalog/status publication mismatch is retried once, then fails
closed. `/height` can still expose diagnostic coverage with `ready: false`.

For status `mode: "follow"`, an observation older than 120 seconds is stale. The
follower must publish more frequently than that. For `mode: "historical"`, age
does not disable completed historical queries. A nonempty manual archive without
a status file is also a historical snapshot with unknown source freshness. Neither
case asserts that its blocks are still canonical on today's chain. Source and
consensus trust remain explicit; status is operator-controlled metadata.

## Request

```json
{
  "from_block": 100,
  "to_block": 200,
  "limit": 25,
  "field_selection": {
    "block": ["height", "hash", "time"],
    "transaction": ["txid", "block_height", "index", "raw", "vout"]
  },
  "transaction_filter": {
    "transparent_output_addresses": ["tExampleAddress"]
  }
}
```

`tExampleAddress` is a placeholder, not a validated payment address.

- `from_block` is inclusive and required.
- `to_block` is exclusive. If omitted, the first page captures `archive_height + 1`.
  It must not exceed the indexed range. Empty intervals are valid when the archive
  is ready. A cursor retains the captured end even if the follower later appends.
- `limit` counts **scanned whole blocks**, not returned rows. Default 100; maximum
  1,000. Filters may return empty transaction arrays while `next_block` advances.
- Unknown request, filter, or field-selection properties are rejected. Unsupported
  selected field names and duplicates are rejected; there is no silent fallback.
- `field_selection.block` defaults to `height`, `hash`, `previous_hash`, `time`.
  `field_selection.transaction` defaults to `txid`, `block_height`, `index`,
  `version`, `locktime`. An explicit empty list suppresses that object collection.

Supported block fields:

| Field | Meaning |
| --- | --- |
| `height` | Indexed block height, JSON integer |
| `hash`, `previous_hash` | Conventional RPC display-order lowercase hex |
| `time` | Source block timestamp, integer seconds |
| `raw` | Entire serialized consensus block as lowercase hex |
| `decoded` | Entire stored node-decoded block object, including nonce, bits, roots, transactions and additional source fields; all nested numbers are strings |

Supported transaction fields:

| Field | Meaning |
| --- | --- |
| `txid` | Public transaction ID, lowercase RPC display hex |
| `block_height` | Containing block's indexed height |
| `index` | Zero-based transaction position within that block |
| `version`, `locktime` | Bounded decoded integer metadata |
| `size_bytes` | Serialized transaction length derived from validated raw hex; checked against optional node size |
| `transparent_input_count`, `transparent_output_count` | Array lengths; the coinbase input counts as one input |
| `raw` | Entire serialized transaction as lowercase hex, including encrypted components |
| `vin`, `vout` | Node-decoded transparent input/output JSON; all nested numbers are strings |
| `decoded` | Entire node-decoded transaction object; all nested numbers are strings |

`raw` is complete consensus serialization, whereas `decoded` is the pinned node's
interpretation of it. Prep does not independently certify that interpretation.
Every nested number in transaction `vin`/`vout`/`decoded` and block `decoded` is converted from its exact JSON
number token to a string, including amounts, indexes, versions and counts. Example:
`{"value":"0.123456789123456789","n":"0"}`. Use a decimal library or integer
conversion appropriate to the source field's units; do not convert amounts to
JavaScript floating point. Top-level Prep height/version/index fields remain
bounded numeric integers. Raw hex remains available for independent decoding.

The three count/size fields are also bounded numeric integers. Request them
directly when full `decoded`, `vin` and `vout` objects are unnecessary. Existing
default field selections and old field names are unchanged.

## Optional transaction indexes

During full-segment integrity admission, Prep derives an immutable in-memory
transaction-ID index and public metadata projection. Compatible old archives use
this path without migration or new files. A restart rebuilds the derived index;
it is not a persisted disk index. Catalog refresh reuses unchanged segment
caches and removes replaced segments from the new snapshot's lookup scope.

Metadata-only queries can avoid payload reads. Exact-ID filters locate all
matching block positions, including repeated IDs, before fetching requested
payloads. Raw/decoded block selections still return every scanned block, even
when its transactions do not match. Header-only block selections remain available
without reading full payloads. Cursor and epoch rules are unchanged: `limit`
counts the logical whole-block window, including positions skipped by an index,
and does not become a limit on matching transactions.

Index allocation is capped at 16 MiB per segment and 64 MiB per archive snapshot,
accounting for vector capacities and index/Arc structures. This does not cap total
process RSS: payload buffers, responses, allocator overhead, and older retained
snapshots can coexist. Malformed, unsupported or over-budget metadata disables
the optional index for that entire segment. Queries then use checked payload
reads; an incomplete index never proves that a transaction is absent.

The cache has the same immutable-admission trust boundary as the existing header
index. Fresh admission verifies segment bytes; a cached fast path does not reread
all payload bytes to detect later out-of-band modification. Operators must keep
published segments immutable. Reorgs use catalog replacement and epochs, rather
than modifying published segment files in place.

## Transaction filters

Supported properties of the single `transaction_filter` object:

| Filter | Semantics |
| --- | --- |
| `txids` | Exact transaction IDs; OR within a list, at most 128 |
| `versions` | Exact decoded transaction versions; OR within a list, at most 128 |
| `has_sapling` | Whether public decoded Sapling spend/output arrays are nonempty |
| `has_orchard` | Whether public decoded Orchard actions are nonempty |
| `transparent_output_addresses` | Match `vout[].scriptPubKey.addresses[]` or `.address`; OR within a list, at most 64 strings of 128 ASCII characters |

Different properties combine with AND. An empty list matches no transactions.
Address filters accept bounded strings beginning with `t`; this is string matching,
not address checksum/network validation. Nonstandard scripts without an address
projection do not match. Input-address resolution, shielded recipient lookup,
memo filtering and Unified Address decoding are unsupported.

Transaction filters do not remove the independent block projection. Select
`block: []` for transaction-only results.

Header-only queries (`transaction: []`, with neither block `raw` nor `decoded`) use the
archive's verified header metadata. They do not read or decode full transaction
JSON. Cursor boundary anchoring uses the same header lookup. The full-block/raw
and transaction paths remain separate; performance results must identify which
projection was requested.

Selecting block `decoded` returns the whole stored source object even with
`transaction: []`; the separate transaction projection and its filters do not
trim the transactions nested inside that complete block object. Unknown source
JSON properties are retained. This is the node-decoded projection preserved at
ingestion, not a new independent interpretation of consensus bytes.

## Response, cursor and rollback

```json
{
  "archive_height": 250,
  "network": "mainnet",
  "epoch": "0",
  "revision": "5",
  "from_block": 100,
  "to_block": 200,
  "next_block": 125,
  "cursor": "opaque-hex-in-real-response",
  "canonicality": "historical_snapshot_not_independently_consensus_validated",
  "data": {"blocks": [], "transactions": []}
}
```

The cursor text above is explanatory; real cursors are bounded hex-encoded JSON.
Continue with the **same original request** plus the returned cursor. Do not change
`from_block` to `next_block` while retaining that cursor. Supplying the captured
`to_block` explicitly is allowed. Keep limit, fields, and filters unchanged.

A cursor binds the network, archive start, epoch, original bounds, field/filter/
limit fingerprint, next height, and captured end-block hash. Appending changes
revision without invalidating the cursor. A rollback changes epoch and returns
HTTP 409 `REORG`. A rebuilt archive with a reused epoch but a different captured
end-block hash also invalidates the cursor. Cursors are consistency checks, not
signed capabilities or authorization tokens. Treat them as opaque client state.

The server advances only after a whole block's selected output fits the response.
If adding another block exceeds the cap, it returns completed blocks and a cursor
for the unprocessed block. If the first block alone exceeds the cap, HTTP 413 asks
the client to reduce field selection. No transaction within that block is silently
skipped. `cursor: null` means the captured interval is complete.

## Bounds and errors

The prototype limits requests to 64 KiB, scanning to 1,000 blocks per call, and the
serialized JSON response to 32 MiB. Two queries/retained response byte allocations
share admission permits. These are wire/work limits, **not peak-RSS guarantees**:
protobuf decoding, exact-number JSON trees, serialization, and network buffers
also consume memory. Deployment cgroup limits remain necessary.

Blocking archive work runs off the async event loop. Queries have a 30-second
budget, checked between blocks/transactions; cancellation does not interrupt an
already running filesystem system call. HTTP shutdown allows two seconds to drain.
This private development service is not hardened against arbitrary hostile traffic.

When follow mode is backing off after a temporary source failure, `/height`
reports not ready and data queries return503 `SOURCE_NOT_READY`. The process
retains its committed archive and writer lock. A successful source check restores
readiness; an ordinary outage/append does not itself invalidate historical
cursors. This source retry policy does not add automatic retry to the client SDK.

Errors use `{"error":{"code":"SYMBOLIC_CODE"}}` without source URLs, query
contents, database credentials, or raw internal error messages.

| HTTP status | Examples |
| --- | --- |
| 400 | Invalid JSON, unsupported filters/fields, invalid cursor/range syntax |
| 401 | Missing or invalid configured bearer token |
| 408 | Query cancelled or exceeded its work budget |
| 409 | `REORG`, `CURSOR_QUERY_MISMATCH`, `FULL_BLOCK_ARCHIVE_REQUIRED` |
| 413 | Request too large or one selected block cannot fit the response cap |
| 416 | Requested interval not contained in indexed archive |
| 429 | Both admission slots are occupied |
| 503 | Source not ready, inconsistent status/catalog, corrupt/unavailable archive |

The current implementation is a public-data query engine. Successful query or
payload round-trip evidence does not establish wallet interoperability, private
note scanning, current full-node synchronization, or a performance win.
