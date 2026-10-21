# Standalone receipt consumer

This example watches a bounded Chef receipt projection and keeps a private local
SQLite copy. It uses the published **Chef 0.2.0** package for the indexer/API and
ordinary authenticated HTTP for the consumer. No source imports or workspace
links are needed after copying this directory outside the Zeer checkout.

## Set up

Use Node 24.14+, PostgreSQL, a full-data Zcash Testnet Prep source and a local
`zeer-scanner` executable. Copy this directory into your own project directory,
then install from npm:

```sh
npm install
cp .env.example .env
```

Set your database connection, a random API token, project name, account identity,
key fingerprint and the first relevant testnet height. Configure protected local
paths for your viewing key and scanner. Never put a seed or viewing-key contents
in the config, send them to public Prep or commit `.env`/SQLite files. The SQLite
database contains plaintext observations; it is not encrypted by this example.
Remote consumer endpoints require HTTPS; plain HTTP is accepted only on loopback
(use an SSH tunnel if the private API runs on another machine).

Initialize the new Chef project:

```sh
npm run chef -- codegen --config chef.config.mjs
npm run chef -- migrate --config chef.config.mjs
npm run chef -- sync --config chef.config.mjs --follow
```

In another terminal, serve it:

```sh
npm run chef -- serve --config chef.config.mjs
```

The schema intentionally includes `blockHash` from the handler's block context
and an indexed required `blockHeight`. Use a new namespace if adopting this schema
from an older example. Reading notes does not track whether they remain unspent.

## Consume and resume

Use the same project name and first relevant height:

```sh
npm run consume -- --db private/receipts.sqlite --project receipt_reference \
  --from 4523000 --rounds 30 --deadline-seconds 300
```

Replace the height with your own starting block. By default each sweep covers
that start through Chef's current checkpoint. The maximum watched interval is
**1,000 blocks** and **10,000 rows**, so this example is suitable for a bounded
inbox study. Use `--to HEIGHT` for a fixed range; Chef must have reached it. It is
not an unbounded historical indexer or a durable change feed.

To stop after one page and inspect restart behavior:

```sh
npm run consume -- --db private/receipts.sqlite --project receipt_reference \
  --from 4523000 --max-pages 1
```

Run the normal command again to resume. A bounded invocation exits with code 2
when its last round is incomplete/waiting, and 0 after a complete or unchanged
round. Errors are fixed codes; the CLI does not print note payloads or credentials.

## Recovery behavior

- Pages and their continuation cursor are staged in one SQLite transaction.
  Staged rows are not exposed by `rows()`. Abrupt termination retains the last
  committed page; repeating a completed sweep does not duplicate entity IDs.
- A 409 `CURSOR_INVALIDATED` discards staging and restarts the complete watched
  range. A successful final page atomically replaces that range, including
  deletions. Deduplicating IDs alone would retain orphaned receipts.
- When the canonical checkpoint becomes shorter, the next dynamic sweep still
  covers the previous ending height so removed rows can be reconciled. A partial
  sweep never deletes visible data. PostgreSQL's reconciliation gate remains
  authoritative for whether entity reads are available.
- Source observations must be available and recent at the start and before
  promotion. 503, stale/unknown status or transport failure preserves the previous
  complete projection and cursor. Existing rows then describe the last complete
  observation, not current permission to act.
- A changed project generation or consumer configuration requires operator
  recovery with an explicitly chosen new database. Existing unmarked SQLite files
  are refused. Run one consumer per file; local version fencing also rejects
  commits fetched against another process's superseded progress.

`RangeConsumer` in `consumer.mjs` accepts a collection name, height field and
selected scalar fields for other bounded entity projections. Use `state()` to
read the revision/checkpoint associated with the last complete observation.
All note values remain exact decimal strings. The unique local entity ID is a
projection invariant; it is not an exactly-once guarantee for external actions.

```sh
npm test
```

Tests cover staging/reopening, invalidation, orphan removal, unavailable sources,
row limits and local fencing. Live scanner, PostgreSQL, process-restart and
testnet timing evidence must be recorded separately. No payout, spending API or
ZeeSwap-specific state is included.

For process termination and controlled PostgreSQL reorg checks, use a disposable
database role that may create/drop its own schemas, then run
`npm run verify:recovery`. It creates only a new `ref_` namespace and removes that
namespace after success. It records twelve actual consumer invocations, including
termination after an atomic staged page, cursor rejection, orphan removal and
re-inclusion of the same output identity at a new block. These are synthetic
regtest branches; no viewing key is loaded and they are not live shielded timings.
The additional runs interrupt the HTTP connection and simulate a PostgreSQL
wire disconnect for this owned API, then verify recovery without changing the
shared database service. Both retain the last complete local projection.
