# Shielded inbox

A generic self-hosted Chef example that stores readable Sapling, Orchard and
Ironwood note observations in the developer's PostgreSQL database and exposes
authenticated GraphQL. There are no invoices, orders, wallet sends or payouts.
Read [the receipt contract and trust boundaries](../../docs/SHIELDED_RECEIPTS.md)
before configuring keys. This is an experimental testnet-only profile.

## Build and configure

From the repository root, with Rust 1.99+, Node 24.14+ and protoc available
(the validated Rust toolchain is 1.99.0):

```sh
npm ci
npm run build:chef
cargo build --release --locked -p zeer-scanner
npx tsc -p examples/shielded-inbox/tsconfig.json
node --experimental-strip-types --test examples/shielded-inbox/memo.test.mjs
```

Export a UFVK from an operator-owned **testnet** wallet to an absolute protected
file outside the checkout. It must contain Sapling and Orchard viewing components.
Do not paste a seed or spending key. On Unix use 0400/0600; on Windows configure
an owner-only ACL. Record a birthday height at or before the first relevant
payment. The scanner does not need a spending key.

For an isolated test account only, an explicit offline utility is available:

```sh
cargo run --locked -p zeer-scanner --example create_test_account -- /protected/new-test-account
```

The directory must not exist. The utility writes an OS-random testnet seed,
UFVK and account metadata to protected files; it starts no wallet service and
does not send transactions. Keep the seed offline for recovery. Windows users
must first protect the parent directory ACL. Never use the public fixture UFVK
or example seed values for funds. Requesting a testnet faucet drip is a separate
operator action; it is not performed by Chef or the scanner.

Inspect the key with the account ID used in this example:

```sh
target/release/zeer-scanner inspect-key --account inbox --key-file /protected/testnet.ufvk
```

Copy `.env.example` to a private file outside the checkout and fill its values.
`ZEER_KEY_FINGERPRINT` is the inspected fingerprint, `ZEER_BIRTHDAY_HEIGHT` is
the wallet birthday, and `DATABASE_URL` points to developer-owned PostgreSQL.
`CHEF_API_TOKEN` must be a private random token of at least 16 bytes. Set the
scanner executable and key file to absolute paths. Do not point the database
configuration at another application's schema or reuse its project identity.

The example reads public full transactions through Prep and decrypts them locally.
Its pool predicate selects these three pools only, not every future protocol.
For other intentional transaction filters, state the narrower coverage explicitly.
Whole-history scanning is unnecessary for a wallet created recently.

## Run from this checkout

Replace `/protected/inbox.env` below with the private environment file. Keep the
same configuration for migration, sync and serving:

```sh
node --env-file=/protected/inbox.env packages/chef/dist/cli.js codegen --config examples/shielded-inbox/chef.config.ts
node --env-file=/protected/inbox.env packages/chef/dist/cli.js migrate --config examples/shielded-inbox/chef.config.ts
node --env-file=/protected/inbox.env packages/chef/dist/cli.js sync --config examples/shielded-inbox/chef.config.ts --follow
```

In a separate terminal:

```sh
node --env-file=/protected/inbox.env packages/chef/dist/cli.js serve --config examples/shielded-inbox/chef.config.ts --listen 127.0.0.1 --port 39375
```

For a bounded verification instead of following, use `sync --to HEIGHT` with an
**inclusive** available end. Restart the same command to resume its checkpoint.
Changing schema, handler behavior, account, key fingerprint or birthday requires
the explicit [evolution procedure](../../docs/SCHEMA_EVOLUTION.md).
This memo-enabled example uses the fresh `shielded_inbox_memos` namespace and
`readable-memos-v1` handler generation. Preserve an existing `shielded_inbox`
projection; do not reset it or reuse its identity for this changed schema.

## Read shielded memos

Run the included authenticated, loopback-only query client:

```sh
node --env-file=/protected/inbox.env examples/shielded-inbox/query.mjs
```

It runs [query.graphql](query.graphql) against `CHEF_LOCAL_URL`, defaulting to
`http://127.0.0.1:39375/graphql`. Its token stays in the local environment; it
refuses remote endpoints and redirects. The output contains private received
note data. Keep it on your machine and do not upload it to the public playground.

```graphql
query ReadShieldedMemos {
  ReadableNoteList(first: 10) {
    items { txid pool blockHeight valueZat memoKind memoText }
    nextCursor
  }
  _meta { height status }
}
```

Only notes decryptable with the configured account's viewing key appear. For a
known TX ID, add `where: { txid: "YOUR_64_HEX_TX_ID" }` to the list. To continue,
pass the returned `nextCursor` as `after`. An empty result can mean no readable
notes in the scanned range, an unrelated viewing key, or no matching filter;
inspect `_meta.height` and your wallet birthday before drawing conclusions.

The display projection follows [ZIP 302](https://zips.z.cash/zip-0302): text
removes trailing zero padding and uses strict UTF-8. `memoKind` distinguishes
`text`, `empty_text`, `no_memo`, `non_text`, `invalid_utf8` and `text_with_nul`.
Binary/reserved formats are not guessed as text. Invalid UTF-8 is reported by
kind, while the original `memoHex` remains intact. PostgreSQL text cannot store
embedded U+0000, so that case also retains only its raw hex plus explicit kind.
Add `memoHex` to the query when you need the complete 512-byte value.

```graphql
{
  _meta { height status }
  ReadableNoteList(first: 20) {
    items { id txid pool outputIndex blockHeight valueZat scope origin coinbase }
    nextCursor
  }
}
```

Send this query to the loopback `/graphql` endpoint with
`Authorization: Bearer $CHEF_API_TOKEN`. Receiver and full memo fields are also
available to authorized readers; do not expose the endpoint or token publicly.
This example stores internal notes and coinbase flags without treating them as
payments. It does not calculate a spendable balance or mark a business order paid.

## Independent consumer

For a relayer that already knows a transaction ID, Chef also provides a single
transaction read helper. It observes the transaction through Prep, fetches its
mined bytes and header, decrypts with the local scanner, then rechecks its mined
block identity before returning. The viewing key is read only by the local child.
This does not scan a wallet's full history or track spent notes.

With Chef **0.1.1 or later**, use the same protected environment as the inbox:

```sh
node --env-file=/protected/inbox.env examples/shielded-inbox/read-transaction.mjs YOUR_64_HEX_TX_ID
```

`ZEER_ACCOUNT_ID` defaults to `inbox`; it must match the configured scanner
identity and fingerprint. The result contains the live source observation,
per-note receipts and memo display fields. Pending or unobserved transactions
return no mined receipts. A missing archive payload or changed block fails;
neither is converted into a successful empty deposit. Handle retries in your
application and keep output logs private.

Both external and internal scopes retain `origin: unknown`. Scope does not
identify the sender or establish change/self-transfer. Match receivers by the
decoded pool receiver component and amounts with integer zatoshis. Recheck
confirmations and source-relative canonicality near settlement; enforce output
deduplication and payout idempotency in your own database. Zeer observes notes;
your application validates orders and authorizes payments.

Install `@zeer-dev/prep-client` and `@zeer-dev/chef` from npm, or use the
[local tarball workflow](../../docs/PACKAGING.md) for a source-built candidate. Copy this example's
config, schema and package metadata into your project. Run the installed
`zeer-chef` executable. The native scanner is a separately built local executable;
its absolute path is selected through `ZEER_SCANNER_EXECUTABLE`.

The verified registry versions are:

```sh
npm install @zeer-dev/chef@0.1.1 @zeer-dev/prep-client@0.1.0
```

## Verify the native boundary

After building the native scanner and Chef, set `ZEER_SCANNER_TEST_EXECUTABLE`
to its absolute path. For PostgreSQL integration, also set
`CHEF_TEST_DATABASE_URL` to an isolated Zeer test database:

```sh
cargo test --locked -p zeer-scanner
node --test packages/chef/test/receipts.test.mjs packages/chef/test/receipts.integration.test.mjs
```

The PostgreSQL test owns only its generated `t_` namespace and removes that test
namespace afterward. Without the explicit binary/database variables, the native
integration cases are skipped; a skipped test is not acceptance evidence.
