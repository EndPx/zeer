# Public testnet demo walkthrough

Visitor check: on 23 October 2026, a fresh Chrome session with no cookies or
developer token completed the public Prep/Chef examples and quickstart navigation.
See the [judge preflight record](JUDGE_PREFLIGHT_20261023.md) for the checked path
and its scope.

Open [the console](https://zeer.endpx.cloud/app). Prep reports its observed archive
coverage against the source. Chef indexes public BlockSummary entities from
**block 0 through the latest available Prep block**, using namespace
`hosted_genesis_testnet_v2`. Both ranges and their gaps come from actual observed
heights. `_meta.height` is Chef's committed checkpoint; it can trail Prep while
indexing catches up.

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
GraphQL query. Its notice states the namespace, following mode and observed indexed range. Inspect
the returned heights, hashes, transaction counts and `_meta.height`.
Use **Next example page** to continue the built-in list without editing its
cursor manually. **Restore example** fills the original query again without
running it. A custom query retains its own paging behavior. A field typo in the
hosted demo names the invalid field and suggests a supported spelling when possible.

Use the built-in **Browse block entities**, **Genesis block**, **Filter by block
height**, **Compare two heights**, **Indexer checkpoint**, and **Latest indexed
block** examples. Select one to fill the editor, then Run query. The latest-block
example captures a real checkpoint when selected; Restore example captures a new
one. It never overwrites an edited query as the chain advances. Lists use entity
ID order, rather than promising numeric block order.

For a direct comparison, query a stored modern block:

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
During indexing, `_meta.height` is a committed prefix. The public Chef follows new
Prep blocks; the local bounded example remains a finite restart/replay exercise.

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

## Inspect public shielded structure and pending transactions

Open [Shielded pool activity](https://zeer.endpx.cloud/app/prep?example=shielded&from=0).
The default scan starts at genesis and uses server-selected response boundaries.
An empty early page can predate pool activation; continue its cursor, or select
Use verified testnet sample for a known modern start. Sapling, Orchard and
Ironwood have separate component counts; these are not decrypted payment counts.

Select a transaction ID to open its inspector. The real block-reward example
recognizes coinbase from its input marker. Overview, Inputs / outputs and Raw
show public metadata, exact zatoshis and encrypted shielded data. The mempool
view observes the configured testnet node and refreshes while visible. A pending
row can be mined or disappear between observations; no pending fixture is forced.
See [field and privacy boundaries](PUBLIC_SHIELDED.md).

## Read the published shielded memo

In Chef Playground, select **Read shielded memos** under **Try an example**, then
press **Run query**. The selected public demo receipt returns **Hello from Zeer
Chef**, **100,000 zatoshi**, pool `ironwood`, block `4523289` and `origin: unknown`.
The query uses transaction
`b9444bea5e092925ddfa52dbfbd8d1075c62b8b234260df3d9b9179f0a8d2d6e`.

No account, visitor viewing key or wallet connection is required. Zeer's local
scanner previously decrypted this selected note and Chef indexed its projection;
the public query reads that deliberately disclosed receipt. It does not decrypt
arbitrary wallets or accept viewing keys. Use **Inspect transaction** to view its
public chain context in Prep.

## Read shielded memos on your own machine

In Chef Playground, expand **Read shielded memos locally** for a copyable
ReadableNote query and the [local inbox quickstart](../examples/shielded-inbox/README.md).
It decrypts account-owned notes with a testnet UFVK in a protected local file,
then exposes `memoText`, `memoKind` and original `memoHex` through authenticated
loopback GraphQL. The public BlockSummary service does not accept viewing keys
or expose these private receipt entities. Run this example locally with your own
wallet birthday, key fingerprint and database namespace.
