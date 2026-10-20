# Troubleshooting

Keep the request, HTTP status, scan progress and source metadata together when diagnosing a Prep integration. Log public context such as the range and error code; redact tokens and private application data.

## A query returns zero transactions

Check `cursor` and `next_block`. An empty filtered page may have scanned a range with no matches while more history remains. Before pool activation, public shielded filters can legitimately match nothing. Use a verified sample in the playground for a populated modern example.

If the captured scan completes without a match, absence is scoped to that range and filter. It does not prove wallet ownership, global absence or pending status.

## HTTP 400 or an unsupported field

Inspect the exact request against [Query & response](/docs/prep/query/). Unknown properties, duplicate selections, invalid ranges and unsupported filter/field names are rejected. `/capabilities` describes the endpoint's supported protocol features.

Do not copy EVM `from`/`to` or memo-text filters into a Zcash query. Transparent outputs and encrypted note recipients have different visibility.

## HTTP 409 with REORG

The archive snapshot or pinned boundary changed. Discard the invalid cursor, re-read source coverage, and reconcile any persisted application results before restarting. Do not join records from incompatible snapshots or replace `from_block` while retaining an old cursor.

See [Continuation & historical scans](/docs/prep/continuation/).

## Rate limiting or unavailable source

Shared-preview overload and source failure are distinct from an empty successful result. Honor `Retry-After` where supplied and retry recoverable failures with bounded backoff. Avoid parallelizing many retries into a shared endpoint.

`/health` reports process liveness. `/ready` and `/height` describe source/archive usability. A configured optional live source can still be unavailable. For the current status codes and bounds, use [the transport error table](/docs/prep/query/).

## Authentication fails

The public preview requires no personal token. A private server may require its operator-issued bearer token. Verify which endpoint you intended, then review [API access & tokens](/docs/prep/tokens/). Do not print or paste a credential while debugging it.

## The SDK fails, aborts or times out

The client validates protocol responses and exposes typed errors, timeout/cancellation behavior and finite stream bounds. It does not silently retry or restart. Keep the consuming code inside its time budget and inspect [Clients](/docs/prep/clients/) and the actual package declarations.

## A transaction is missing or a memo is unreadable

An archive query only covers its requested stored range. For an optional live node observation, use [Transaction lookup & mempool](/docs/prep/transactions/); an archive miss does not mean pending.

Prep does not decrypt memo text. For authorized receipts, use the developer-operated [Chef local inbox](/docs/chef/shielded/local/) and check its viewing-key identity, birthday and committed checkpoint.
