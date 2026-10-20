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

## Try a published example

Open the [Chef playground](https://zeer.endpx.cloud/app/chef), select **Read shielded memos**, then press **Run query**. The example reads one deliberately published receipt from Zeer's testnet demo wallet. Its memo is **Hello from Zeer Chef**, with a note value of **100,000 zatoshi (0.001 TAZ)**.

[Inspect the Ironwood transaction](https://zeer.endpx.cloud/app/prep?view=transaction&txid=b9444bea5e092925ddfa52dbfbd8d1075c62b8b234260df3d9b9179f0a8d2d6e). The scanner ran locally with Zeer's viewing key; the hosted reader receives only the selected projection. Your own viewing key and decrypted results stay in your environment.

## Read a known transaction locally

The [single-transaction example](https://github.com/EndPx/zeer/blob/main/examples/shielded-inbox/read-transaction.mjs) uses the Chef 0.1.1 candidate's local read helper. Until that release is published, use a [source-built package](https://github.com/EndPx/zeer/blob/main/docs/PACKAGING.md). The helper fetches public bytes from Prep and decrypts locally, then checks that the source still reports the same mined block. An archive gap or changed block is an error, not a confirmed empty deposit.

Match the exact per-note amount, decoded pool receiver and your application reference. External/internal scope leaves `origin: unknown`. The application remains responsible for deduplication, order validation and a fresh confirmation/canonicality check before settlement.
