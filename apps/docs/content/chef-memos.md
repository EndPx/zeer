# Reading receipts & memos

Chef's local shielded inbox turns notes readable with your viewing key into queryable entities. Complete [local viewing-key setup](/docs/chef/shielded/local/) first. This is an experimental testnet workflow for Sapling, Orchard and Ironwood, using a separately built local scanner.

## Query your local inbox

After migrating, syncing and serving the example, run:

```sh
node --env-file=/protected/inbox.env examples/shielded-inbox/query.mjs
```

The included client targets a loopback Chef endpoint and reads its bearer token from your local environment. It refuses remote endpoints and redirects. The result is private note data; keep it in your environment.

```graphql
query ReadShieldedMemos {
  ReadableNoteList(first: 10) {
    items { txid pool blockHeight valueZat memoKind memoText }
    nextCursor
  }
  _meta { height status }
}
```

Add `where: { txid: "YOUR_64_HEX_TX_ID" }` to `ReadableNoteList` for a known transaction. Pass `nextCursor` as `after` to continue the list. Replace the placeholder with an actual testnet transaction ID before running it.

## Understand the fields

| Field | Meaning |
| --- | --- |
| `txid`, `pool`, `outputIndex` | Public transaction and receipt location |
| `valueZat` | Actual decrypted note value, returned as an exact decimal string |
| `receiver` | Receiver reconstructed by the authorized scanner |
| `memoHex` | Original full 512-byte memo value as hex |
| `memoKind`, `memoText` | Conservative display classification and optional readable text |
| `scope`, `origin`, `coinbase` | Receipt context that helps avoid treating every note as a payment |

`memoKind` distinguishes `text`, `empty_text`, `no_memo`, `non_text`, `invalid_utf8` and `text_with_nul`. Non-text and invalid encodings are not guessed as text. Add `memoHex` to the query when you need the original bytes.

## Interpret empty results

No returned notes can mean no readable notes in the scanned range, an unrelated viewing key, a birthday that skips earlier receipts, or a narrower query filter. Check `_meta.height`, configuration and the known transaction before drawing conclusions.

## Use receipts in your application

The example provides received-note observations. It does not track a spendable wallet balance or decide that an order is paid. An application must validate the actual value, receiver, intended reference, confirmation policy and its own idempotent state. A valid-looking memo alone is insufficient.

The public Prep and Chef playgrounds do not accept viewing keys and do not expose this private entity. Keep this feature inside your own Chef deployment.
