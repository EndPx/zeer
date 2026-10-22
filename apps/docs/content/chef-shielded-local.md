# Local viewing-key setup

Create a private testnet payment inbox with Chef's shielded starter. You get a `ReadableNote` schema, a receipt handler, memo queries and a restartable SQLite consumer. Your UFVK stays on the machine running the scanner; public Prep receives public chain-data requests only.

Requirements: **Linux/WSL2 x64 with glibc**, Node **24.14+**, pnpm and PostgreSQL. The scanner needs a testnet UFVK containing Sapling and Orchard components. Never use a seed or spending key.

## 1. Create the inbox

```sh
pnpx @zeer-dev/cli init
```

Choose `3` / `shielded`, then a project name such as `payment_inbox` and folder `payment-inbox`. Select your Prep endpoint and enter an explicit numeric wallet birthday: a block at or before the first note you need to read. There is no `latest` default for this starter, because it could skip earlier payments.

For unattended setup, replace the example height with your wallet's birthday:

```sh
pnpx @zeer-dev/cli init --template shielded \
  --dir payment-inbox --project payment_inbox --start-height 4523000 --json
cd payment-inbox
pnpm install --ignore-scripts
pnpm run scanner:install
```

The installer downloads the pinned [testnet scanner release](https://github.com/EndPx/zeer/releases/tag/scanner-v0.1.0-testnet.1), verifies its SHA-256 before execution and checks its protocol without loading a key. It prints the absolute installed executable path. Checksums rely on your trust in the release source; they are not a separate signature. No Zeer checkout or Rust compilation is needed on the supported release target.

Init only creates files and local development credentials. It never reads your key, installs dependencies or starts services. Retain the generated lockfile.

## 2. Configure your local key

Keep the UFVK in an owner-only file **outside the project**, with mode `0400` or `0600`. Run the installed executable to inspect its fingerprint:

```sh
"$HOME/.local/share/zeer/scanner-v0.1.0-testnet.1/zeer-scanner" \
  inspect-key --account inbox --key-file /protected/testnet.ufvk
```

Set these values in the generated `.env`:

| Variable | Value |
| --- | --- |
| `PREP_URL` | Compatible full-data testnet Prep; init records your selected endpoint |
| `DATABASE_URL` | Your PostgreSQL database, or the generated local Compose connection |
| `CHEF_API_TOKEN` | The generated private token, or your own random token of at least 16 bytes |
| `ZEER_ACCOUNT_ID` | The account name used above, such as `inbox` |
| `ZEER_SCANNER_EXECUTABLE` | Absolute installed scanner path |
| `ZEER_VIEWING_KEY_FILE` | Absolute protected UFVK file path |
| `ZEER_KEY_FINGERPRINT` | Fingerprint returned by `inspect-key` |
| `CHEF_URL` | Private Chef origin; the starter uses `http://127.0.0.1:39370` |

The project name and numeric start height are already written to `chef.config.ts`; `ZEER_PROJECT` and `ZEER_BIRTHDAY_HEIGHT` in `.env` record the same choices for reference. Editing those environment values alone does not change the config. Account, fingerprint, birthday or schema changes require [explicit project evolution](/docs/chef/evolution/).

Never paste key contents into a command, chat, public API or source file. Keep `.env`, PostgreSQL data and the consumer's SQLite file private: receipts contain plaintext note observations.

## 3. Prepare the database and types

Use your PostgreSQL database, or start the generated loopback database with Docker Engine and Compose v2:

```sh
pnpm run db:up
```

Port `39472` must be free. If you change it, update both `compose.yaml` and `DATABASE_URL`. Then:

```sh
pnpm run codegen
pnpm run typecheck
pnpm run migrate
```

The generated codegen script loads the account identity from `.env`. Migration initializes the project's namespace; it does not create the PostgreSQL server.

## 4. Follow, query and consume

In terminal A:

```sh
pnpm run follow
```

In terminal B:

```sh
pnpm run serve
```

In terminal C:

```sh
pnpm run query
```

The query returns readable notes with pool, block height, exact `valueZat`, memo kind and memo text. The full schema also records receiver components, output identity, block hash, scope, origin and coinbase status. A note's `internal` or `external` scope does not prove who sent it; `origin` remains `unknown`. A valid memo alone does not establish a received payment.

Start the consumer in another terminal, using your chosen project and birthday:

```sh
pnpm run consume --mode continuous --follow --db private/inbox.sqlite \
  --project payment_inbox --from 4523000 --window-blocks 200 --page-size 100
```

Restart the same command to resume. It processes history in windows and reconciles the mutable tail against Chef's retained recovery boundary. During a source outage it preserves the last complete projection; cached results are not current authorization to act. The generated `CONSUMER.md` explains storage budgets and explicit recovery errors. Use this project's scripts for setup rather than that reference document's checkout commands.

For a known transaction, replace `TX_ID` with its lowercase 64-character ID:

```sh
pnpm run read:transaction TX_ID
```

With npm, use `npm install --ignore-scripts` and `npm run SCRIPT -- ...` when forwarding arguments. Stop processes with Ctrl+C. `pnpm run db:stop` retains the database volume.

## Alternative installation

The [scanner release](https://github.com/EndPx/zeer/releases/tag/scanner-v0.1.0-testnet.1) also includes a standalone `shielded-inbox.tar.gz` tested with Chef 0.2.0. It has its own README and `chef.config.mjs`; follow its commands rather than mixing them with the generated 0.3.0 project's scripts.

Other platforms retain the source-build path. From a checkout with the pinned Rust 1.99.0 toolchain:

```sh
cargo build --release --locked -p zeer-scanner
target/release/zeer-scanner capabilities
```

Use the resulting absolute executable path in local configuration. A source build on a platform does not establish release-binary support for that platform.

These are note observations, not a spendable balance or settlement permission. Your application must validate its order, receiver, amount, deadline, confirmations and canonicality before external actions. No signer or payout code is included.

Next: [Read receipts and memos](/docs/chef/shielded/memos/).
