# Filtered indexing from genesis

This testnet example starts at block 0 and stores only transactions containing
public Orchard actions. Prep applies the predicate before transferring transaction
records. Chef requests identity/version metadata, without downloading decoded
transaction bodies or running transaction handlers for nonmatching records.
It does not decrypt recipients, amounts or memos.

From the repository root, install dependencies with `npm ci` and build Chef with
`npm run build:chef`. Supply `PREP_URL`, `DATABASE_URL`, and optionally
`PREP_API_TOKEN` in a private environment file. The Prep archive must cover genesis
on testnet. Use your own PostgreSQL database and a new project namespace.

```sh
node --env-file=.env packages/chef/dist/cli.js migrate --config examples/chef-filtered/chef.config.ts
node --env-file=.env packages/chef/dist/cli.js sync --config examples/chef-filtered/chef.config.ts --follow
node --env-file=.env packages/chef/dist/cli.js status --config examples/chef-filtered/chef.config.ts
# Set CHEF_API_TOKEN (at least 16 bytes) before starting the read API:
node --env-file=.env packages/chef/dist/cli.js serve --config examples/chef-filtered/chef.config.ts
```

```graphql
query {
  OrchardTransactionList(first: 10) {
    items { id height version transactionIndex }
    nextCursor
  }
  _meta { height hash status }
}
```

The configuration scans up to 1,000 blocks per request and commits groups of 32.
Both limits are bounded; they do not mean "return 1,000 matches". Empty ranges
still advance the verified checkpoint. All block headers are fetched and linked;
Chef does not yet jump across millions of blocks using a sparse range proof.
Before Orchard activation, the entity list will be empty while the checkpoint
continues advancing. No data is substituted to make the example look populated.

The default `transaction` handler receives decoded data. Use it instead of
`transactionMetadata` when your handler needs public transaction structure.
The two transaction handler modes are mutually exclusive. An optional `block`
handler runs on every scanned block, including blocks without a matching
transaction.

Each batch is atomic. A failed batch rolls back, and a restart replays that
batch. Handlers must be deterministic and restrict effects to the entity API.
The database retains per-block undo, so a reorg may roll back to an ancestor
inside an earlier committed batch.

Changing predicates changes which historical entities should exist. Follow the
[Chef identity and rebuild contract](../../packages/chef/README.md) instead of
reusing an incompatible checkpoint. There is no promise of a whole-chain sync
duration; source speed, selected data, handlers, database and hardware matter.
