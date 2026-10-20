# Limited public testnet API

The developer preview serves actual Zcash testnet public data through:

```text
https://zeer.endpx.cloud/api/prep
```

Always read `/height` first. `start_block` and `indexed_height` describe available
coverage, not the whole chain by implication. The hosted archive follows confirmed
testnet blocks from genesis; Chef indexing progresses separately.
`ready` means that the available snapshot can be read; it does not mean that
every chain block has already been imported. Historical source mode does not
provide a fresh network-tip observation.

The hosted testnet follower uses `--confirmations 1 --poll-seconds 2`: its target
is the observed Zebra tip, so the expected source-to-Prep gap after catch-up is
zero. A new block, source recovery or processing delay can briefly produce a
nonzero gap; the API reports the measured heights rather than hiding it. This
policy admits recent blocks that can still be replaced by a reorganization.
Clients must handle `409 REORG` and restart invalidated cursor queries.

## Query

```sh
curl https://zeer.endpx.cloud/api/prep/height

curl https://zeer.endpx.cloud/api/prep/query \
  -H 'Content-Type: application/json' \
  -d '{"from_block":0,"to_block":2,"field_selection":{"block":["height","hash","time"],"transaction":[]}}'
```

Supported routes are `GET /height`, `/health`, `/ready`, `/capabilities`, and
`GET /mempool` and `POST /query`, `/transactions`, `/transaction`. Public Prep reads support CORS. The website's
console adapters retain their own origin checks; they are not the SDK base URL.
No viewing key, spending key or wallet connection is required or accepted.

The existing client works against this base URL after installation from the
[local package tarball](PACKAGING.md); it is not published on npm yet:

```ts
import { PrepClient } from "@zeer/prep-client";

const client = new PrepClient({ url: "https://zeer.endpx.cloud/api/prep" });
const coverage = await client.getHeight();
if (!coverage.ready || coverage.indexed_height === null) {
  throw new Error("Prep is not ready; retry after source recovery.");
}
const page = await client.get({
  from_block: coverage.start_block,
  to_block: Math.min(coverage.indexed_height + 1, coverage.start_block + 3),
  field_selection: { block: ["height", "hash", "time"], transaction: [] },
});
console.log(page.data.blocks);
```

Check `coverage.ready` and a non-null indexed height before constructing a query.
`stream()` supports paging through a fixed available range. A response cursor
means more pages exist; a single page is not full-history completion. A snapshot
change returns `409` with the `REORG` code so the client can restart safely.

## Playground examples

The [Prep playground](https://zeer.endpx.cloud/app/prep) starts at genesis with
no end-height input. Prep captures the current archive end on the first request;
subsequent cursor pages retain that snapshot. It offers transparent output payments,
transaction IDs, Sapling/Orchard/Ironwood activity and pool unions, block history, transaction metadata,
version filters and raw serialized transactions. Each has a verified public
testnet sample. **Use verified testnet sample** fills inputs only; **Run query**
still calls the actual API. No captured response replaces that request.

A range such as `from_block: 0, to_block: 1000000` is accepted when covered by
the archive. `limit` is the number of blocks scanned per page, not the total
range or the number of matching transactions. Use **Next page** to continue
the same cursor-bound query. Editing inputs invalidates that continuation.
An empty filtered page does not imply that later pages contain no matches.
The playground's transaction-ID example uses `/query` with
`transaction_filter.txids`, so it can also page through a large range; the
separate `/transactions` endpoint keeps its bounded lookup contract below.

JSON, cURL, fetch and TypeScript examples share the same query parameters.
The share control copies a public URL containing those parameters, not a token.
Chef GraphQL lists retain a 100-item maximum per response and return
`nextCursor` for continuation through `after`.

The playground's **Response fields** control selects existing API fields and
keeps the snippets and share URL in sync. Defaults are specific to each example:

| Example | Filter | Default result focus |
| --- | --- | --- |
| Payments to an address | Transparent output address | Public output addresses/scripts and values |
| Find a transaction | Transaction IDs | Version, lock time, inputs and outputs |
| Sapling activity | Sapling bundle presence | Direct public spend/output component counts |
| Orchard activity | Orchard action presence | Direct public action count |
| Block history | None | Headers only, without transaction records |
| Transaction sizes & inputs | None | Version, bytes and transparent input/output entry counts |
| Filter by version | Exact format version | Matching versions and serialized sizes |
| Raw transaction bytes | None | Actual serialized hex; one block per page by default |

Component counts are not payment counts and do not expose shielded recipients,
individual values or memo plaintext. Full raw/decoded payloads can be larger;
select fewer fields or smaller pages when needed. The table joins timestamps
by block height. When inputs are selected, coinbase type comes from the actual
coinbase input, never from the transaction position alone.
`index` remains the zero-based position inside a block; it is available as
**Position in block** but is not selected by default. Output addresses and values
come only from transparent `vout` entries. Input references are not resolved into
a universal sender address, and shielded recipients are not inferred. Full hashes,
input/output data and all output entries remain available in the JSON response.

## Preview bounds

- No personal API token is needed for this public-data preview.
- VPS ingress: two requests/second globally with a burst of eight. The web
  adapter allows two active upstream requests, shared with console traffic.
  This is not a dedicated throughput allocation.
- Input: 16,128 bytes. Response: 8 MiB. Request deadline: 15 seconds.
- Omit `limit` for automatic scan sizing. The query service targets 500 ms work
  slices and 512 KiB responses, with up to 1,000,000 scanned blocks and a hard
  4 MiB response ceiling. Continue through the returned cursor or use SDK
  `stream()`; a partial response is not the full query result. Explicit fixed
  limits remain supported for compatibility. Transaction-ID lookups cover at most 1,000 blocks
  and 128 IDs per request.
- Overload, unavailable sources and invalid ranges return errors, never samples
  or fabricated empty success. Retry rate-limit/source failures with backoff.

The operator keeps node RPC, database ports and source credentials private.
This preview does not provide an uptime or production-capacity commitment.
Self-hosted deployments can connect the client directly to their own Prep API
and use the server's advertised limits.

## Live transaction inspector

`POST /transaction` accepts only `{ "txid": "64-character-lowercase-hex" }`.
`GET /mempool` returns at most 20 metadata rows plus the observed source total.
These optional testnet node observations distinguish `pending`, `mined` and
`not_observed`; they do not turn an archive miss into pending. Check
`capabilities.live.configured` for configuration presence, then handle source
unavailability and mempool races visibly. No viewing key or broadcast is exposed.
See [public shielded and live contracts](PUBLIC_SHIELDED.md).
