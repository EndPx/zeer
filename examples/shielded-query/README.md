# Public shielded-activity query

Query public Sapling/Orchard/Ironwood component counts from Prep with the packaged client.
No viewing keys, wallet, private recipient lookup or memo decryption is involved.
The example starts at block 0 unless `FROM_BLOCK` is set and follows the server's
continuation cursors. Empty early-history pages remain visible in its JSONL output.

From a checkout after `npm ci`, run a small modern **testnet** range:

```sh
FROM_BLOCK=4515166 TO_BLOCK=4515266 node examples/shielded-query/query.mjs
```

`TO_BLOCK` is exclusive and optional. `SHIELDED_POOL` is `all` (default),
`sapling`, `orchard` or `ironwood`. The query omits a transport `limit`; Prep chooses its
bounded response size. A successful final page has `range_complete: true`.
Errors or cancellation do not become a successful complete-range response.
The shared public endpoint may return an explicit busy/rate-limit error.

For an independent consumer, pack the client from the checkout with
`npm pack ./packages/prep-client --pack-destination /absolute/artifacts`, then
install that tarball in an empty Node 24.14+ project, copy `query.mjs` there and
run it with the same environment variables. The example imports the installed
`@zeer-dev/prep-client`; it does not import Zeer's internal source paths.

Override `PREP_URL` and, if required, `PREP_API_TOKEN` for your own Prep service.
Keep tokens in the environment. The script checks advertised capabilities and
the returned testnet identity before printing rows.

Counts refer to public Spend descriptions, Output descriptions and Actions;
dummy components can be present. They are not counts of payments, users or
decrypted notes. See the [query semantics](../../docs/PUBLIC_SHIELDED.md).
