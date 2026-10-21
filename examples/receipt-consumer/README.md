# Standalone receipt consumer

This example watches a Chef receipt projection and keeps a private local
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

## Follow continuously

For immutable block-scoped observations such as readable notes, use continuous
mode. It processes history in bounded windows, then re-reads the entire visible
tail that Chef can still reconcile. It can cross more than 1,000 blocks and
10,000 total rows without making any single request unbounded.

```sh
npm run consume -- --mode continuous --follow --db private/inbox.sqlite \
  --project receipt_reference --from 4523000 --window-blocks 200 --page-size 100
```

Use a separate database from a range-mode run: mode and budgets are part of its
persisted identity. Ctrl+C/SIGTERM retains progress and exits 0. For a bounded
operation, add `--deadline-seconds 3600`; expiry reports `DEADLINE_EXCEEDED` and
exits 2, including when it interrupts a polling sleep. Without `--follow`, each
invocation still uses bounded rounds and the normal 300-second default deadline.

Continuous mode relies on Chef 0.2.0's `checkpoint.undoFloor`: the oldest retained
rollback ancestor. It seals processed rows only through that boundary, while
keeping the entire visible mutable tail replaceable. A shorter chain removes
orphaned tail rows; the same output ID may return with new block context. Window
promotion and progress are atomic, and interrupted pages remain staged.

This contract requires an immutable block location and payload once an
observation lies below Chef's recovery boundary. It is suitable for receipt and
block observations. It is **not** a feed for mutable account totals or arbitrary
entities that a later handler can rewrite at an old height. Such entities need
full-range reconciliation or a separate change-feed contract.

Defaults: at most 1,000 blocks and 10,000 rows per window, 25 rows per HTTP page,
and 100,000 stored rows overall. `--window-blocks`, `--max-rows`, `--page-size` and
`--max-total-rows` set explicit budgets. Total rows may be raised up to 1,000,000;
the example does not silently prune history. Provide filesystem/process limits
for long deployments. Use `count()` for metrics without loading all rows.

| Outcome | Operator action |
| --- | --- |
| `CURSOR_INVALIDATED` / `REVISION_CHANGED` | Automatically discard partial staging and retry the window |
| Source unavailable/stale or HTTP/transport wait | Preserve the last completed projection; wait for recovery |
| `RECOVERY_WINDOW_EXCEEDS_BUDGET` | Choose a window that covers the mutable tail; configuration changes require a new consumer database |
| `RECOVERY_HORIZON_REQUIRED` | Use a compatible API that reports its retained recovery boundary |
| Decreased/changed horizon, checkpoint below sealed history, changed project generation | Stop and plan an explicit rescan; keep the previous projection for inspection |
| `TOTAL_ROW_LIMIT` / `ROW_LIMIT` | Stop without promoting the offending window; provision an explicit budget or archive/rescan plan |

`state().complete` reports the processed prefix, sealed boundary and whether it
was caught up at that observation. Cached rows and a cached `caughtUp` flag are
not current source freshness or settlement authorization.

For another block-scoped model, supply `--entity`, `--height-field` and a comma-
separated `--fields` list, or instantiate `ContinuousConsumer` directly. The
chosen height field must support Chef's indexed range/order queries.

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

Set `ZEER_CONSUMER_MODE=continuous` for the same process checks plus a real
PostgreSQL-backed sealed-prefix test: advance through height 80, retain the
prefix through undo floor 70, replace the mutable branch with a shorter head at
78, re-include an existing output there, then restart and compare all IDs/context.
The optional phase adds three CLI runs. The default range-mode fixture remains
the twelve-run check.
