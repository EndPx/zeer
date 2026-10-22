# Transaction breakdown

This example requires **Chef 0.6.0**. Install the published dependency with npm or pnpm; Chef 0.5.0 does not include these helpers or relations. It indexes transparent transaction inputs and outputs as related entities, retaining exact per-output amounts in zatoshis. Shielded plaintext remains the responsibility of an authorized local receipt scanner.

Start at block 0 and replay in canonical order. Each output is saved under `txid:outputIndex`. A later transaction resolves its input against that durable output index inside the same Chef database transaction. In-block dependencies work because earlier transaction writes are visible. Output records are retained after spending: this is a historical observation index, not a wallet spendable-balance calculation. Reorg rollback restores the output/input entities together with their checkpoint.

Starting later or filtering out funding transactions leaves some previous outputs unavailable. Those inputs have `resolution: "unresolved"`, `valueZat: null`, `addresses: null` and `previousOutput: null`. Coinbase has its own status and does not look up a previous output. No unknown amount is converted to zero; no sender identity is inferred from an output address.

From the repository, build Chef and generate the example types:

```sh
npm run build -w @zeer-dev/chef
cd examples/transaction-breakdown
node ../../packages/chef/dist/cli.js codegen
```

Configure the normal protected Chef environment (`PREP_URL`, `DATABASE_URL`, `CHEF_API_TOKEN`) and use the source CLI to migrate, sync and serve. A complete genesis replay is a deliberate backfill; it does not run as part of codegen or the tests. See [the developer quickstart](../../docs/CHEF_QUICKSTART.md) for environment and service setup. Use a fresh project namespace for this schema.

Run [query.graphql](query.graphql) with your indexed transaction ID. Inverse lists accept `first: 1..100`, default 25. If more children exist, Chef returns `RELATION_LIMIT_EXCEEDED` with `QUERY_CHILD_LIST`; continue through root `TransactionInputList` / `TransactionOutputList` using `where: { transaction: $txid }`, `first`, `nextCursor` and `after`. Lists never silently omit excess children. Required missing forward targets follow GraphQL non-null semantics; use nullable references for optional enrichment.

For a bounded historical prefetch outside the DB handler, `lookupTransparentOutputs(client, { txids, fromBlock, toBlock, at? }, { signal? })` uses Prep's snapshot-aware batch lookup. It accepts at most 128 TX IDs over at most 10,000 blocks and returns output records, missing IDs and the source snapshot. Missing means absent from that range, not absent from all history. Propagate source/reorg failures and revalidate the canonical boundary before committing imported observations. The example uses its canonical database index and makes no network request inside the handler.

The [0.6.0 acceptance record](../../docs/CHEF_060_ACCEPTANCE.md) includes a verified five-block testnet example, resolved input value and partial-history behavior.
