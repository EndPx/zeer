# Reading receipts & memos

After [local setup](/docs/chef/shielded/local/), run the included authenticated query client:

```sh
node --env-file=/protected/inbox.env examples/shielded-inbox/query.mjs
```

```graphql
query ReadShieldedMemos {
  ReadableNoteList(first: 10) {
    items { txid pool blockHeight valueZat memoKind memoText }
    nextCursor
  }
  _meta { height status }
}
```

| Field | Meaning |
| --- | --- |
| `txid`, `pool`, `outputIndex` | Transaction and note location |
| `valueZat` | Exact received note value as a decimal string |
| `receiver` | Authorized receiver component |
| `memoHex` | Original 512-byte memo |
| `memoKind`, `memoText` | Format classification and optional text |
| `scope`, `origin`, `coinbase` | Note context |

`memoKind` distinguishes `text`, `empty_text`, `no_memo`, `non_text`, `invalid_utf8` and `text_with_nul`. Add `memoHex` when you need original bytes. Use `where: {txid: "YOUR_64_HEX_TX_ID"}` for a known ID and `after: nextCursor` for another page.

**Notes:** Keep results local. If the list is empty, check the key, birthday, filter and `_meta.height`. Memo text alone does not establish a received payment.
