# Public testnet demo walkthrough

Open [the console](https://zeer.endpx.cloud/app). Its two meters have different
denominators: Prep reports its observed archive coverage against the source;
Chef reports only the fixed **4,510,000–4,519,999** demonstration range in
namespace `hackathon_testnet_20261020`. A stored checkpoint supplies Chef's
progress. Source freshness and gaps remain visible separately.

## 1. Search public data from genesis

Open [Find a transaction from block 0](https://zeer.endpx.cloud/app/prep?example=ids&from=0).
Keep the supplied real testnet transaction ID and press **Run query**. It belongs
to block 1000. The response must come from the live API; the input sample is
never used as a response fixture. Check `block_height`, `txid` and the scanned
range. **Next page** continues when a response budget ends before the target.
The TypeScript example uses `client.stream()` to handle continuations.

For another data shape, choose **Explore Orchard activity**, then **Use verified
testnet sample** and **Run query**. This fills a known modern range starting at
4,515,166; the response includes actual public Orchard components. It does not
reveal shielded recipients, values or memo plaintext.

To inspect an empty scan, run Orchard from 0. A successful page with no matches
before activation is valid, and is not a claim that the entire chain has no
Orchard activity. Check the scanned interval and continuation. Cancel a scan or
continue; do not silently substitute a later range or a recorded response.

## 2. Read application entities

Open [Chef Playground](https://zeer.endpx.cloud/app/chef) and run the default
GraphQL query. Its notice states the namespace and inclusive bounds. Inspect
the returned heights, hashes, transaction counts and `_meta.height`.
Use **Next example page** to continue the built-in list without editing its
cursor manually. **Restore example** fills the original query again without
running it. A custom query retains its own paging behavior. A field typo in the
hosted demo names the invalid field and suggests a supported spelling when possible.

For a direct comparison, query an existing block in the demo range:

```graphql
query {
  BlockSummaryById(id: "4515166") {
    id height hash time transactionCount
  }
  _meta { height hash status }
}
```

Open Prep's block history starting at that height and compare its header hash
and timestamp. Transaction count is computed by the metadata handler for all
transactions in that block. It is not a count of decrypted shielded payments.
Clicking a latest-block tile on Overview pins Prep to that single block. Its
linked range is visible; **Continue to latest** removes the end bound. Shared
links preserve that range and response-field selection on the current app.

The flow is **Prep → Chef → PostgreSQL → GraphQL**: Prep reads archived public
chain data; deterministic TypeScript handlers shape it; PostgreSQL persists
entities and a checkpoint atomically; GraphQL reads the committed state.
During indexing, `_meta.height` is a committed prefix. A completed hosted demo
does not continuously replay merely to animate the meter.

## 3. Reproduce live reads and restart locally

Use the [bounded Chef example](../examples/chef-hackathon/README.md) and
[developer quickstart](CHEF_QUICKSTART.md). Start the API **before** sync and run
GraphQL while the checkpoint advances. Interrupt only the writer, preserve the
database, and restart with the identical project identity. Compare the saved
checkpoint before restart and the final 10,000 entities against Prep. Repeating
sync to the same target must not change the entity digest or checkpoint.

The hosted service is shared testnet infrastructure, with response budgets,
cursors and ingress quotas. Completion times depend on source, handlers and
database; this example makes no seconds-for-all-history or production SLA claim.
