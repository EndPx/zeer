# Local viewing-key setup

Run a private testnet inbox with the published Chef package and a local scanner. Requirements: **Linux/WSL2 x64 with glibc**, Node 24.14+, pnpm, PostgreSQL and a testnet UFVK containing Sapling and Orchard components. The release is tested with Chef **0.2.0**. Your key stays on the machine running the scanner; public Prep receives chain-data requests only.

## 1. Install the scanner

Download the installer and checksums from the [scanner release](https://github.com/EndPx/zeer/releases/tag/scanner-v0.1.0-testnet.1):

```sh
mkdir zeer-inbox-setup
cd zeer-inbox-setup
curl -fLO https://github.com/EndPx/zeer/releases/download/scanner-v0.1.0-testnet.1/install-scanner.mjs
curl -fLO https://github.com/EndPx/zeer/releases/download/scanner-v0.1.0-testnet.1/SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS
node install-scanner.mjs
```

The installer verifies the native binary against its pinned SHA-256 before running keyless compatibility checks. It creates a versioned installation under `~/.local/share/zeer`; it does not read a key or install npm dependencies. Checksums rely on your trust in the release source and are not a separate signature.

## 2. Get the inbox starter

```sh
curl -fLO https://github.com/EndPx/zeer/releases/download/scanner-v0.1.0-testnet.1/shielded-inbox.tar.gz
sha256sum --check --ignore-missing SHA256SUMS
tar -xzf shielded-inbox.tar.gz
cd shielded-inbox
pnpm install --ignore-scripts
cp .env.example .env
chmod 600 .env
```

This starter installs Chef 0.2.0 from npm and includes the receipt schema, handler and SQLite consumer. No Zeer checkout or Rust build is needed for this supported release target.

## 3. Configure your local key

Keep the UFVK in an owner-only file outside the project. Use `0400` or `0600`; never supply a seed or spending key.

```sh
export ZEER_SCANNER_EXECUTABLE="$HOME/.local/share/zeer/scanner-v0.1.0-testnet.1/zeer-scanner"
"$ZEER_SCANNER_EXECUTABLE" inspect-key --account inbox --key-file /protected/testnet.ufvk
```

Set these values in `.env`:

| Variable | Value |
| --- | --- |
| `PREP_URL` | Compatible full-data testnet Prep; the starter uses the public endpoint |
| `DATABASE_URL` | Your PostgreSQL database; the role must own its project schemas |
| `CHEF_API_TOKEN` | A private random token of at least 16 bytes |
| `ZEER_PROJECT` | Project name, such as `receipt_reference` |
| `ZEER_ACCOUNT_ID` | The account name used above, such as `inbox` |
| `ZEER_SCANNER_EXECUTABLE` | Absolute installed scanner path |
| `ZEER_VIEWING_KEY_FILE` | Absolute protected UFVK file path |
| `ZEER_KEY_FINGERPRINT` | Fingerprint returned by `inspect-key` |
| `ZEER_BIRTHDAY_HEIGHT` | Height at or before the first note you want to read |

Choose the birthday deliberately: starting later misses older notes, while starting at genesis replays unnecessary history. Keep `.env` and the SQLite database private; the local database contains plaintext receipt observations.

## 4. Index, serve and consume

```sh
pnpm run chef codegen --config chef.config.mjs
pnpm run chef migrate --config chef.config.mjs
pnpm run chef sync --config chef.config.mjs --follow
```

In a second terminal:

```sh
pnpm run chef serve --config chef.config.mjs
```

In a third terminal, replace the height with your chosen birthday:

```sh
pnpm run consume --mode continuous --follow --db private/inbox.sqlite \
  --project receipt_reference --from 4523000 --window-blocks 200 --page-size 100
```

The consumer processes history in windows and reconciles the mutable tail using Chef's retained recovery boundary. Restart the same command to resume. It preserves the last completed projection while the source is unavailable; that cached projection is not current authorization to act. Read the [consumer contract and recovery outcomes](https://github.com/EndPx/zeer/tree/main/examples/receipt-consumer#follow-continuously) before using another entity model.

With npm, use `npm install --ignore-scripts` and `npm run chef -- ...` / `npm run consume -- ...` for the same scripts.

## Build from source

Other platforms retain the source path. From a checkout with the pinned Rust 1.99.0 toolchain:

```sh
cargo build --release --locked -p zeer-scanner
target/release/zeer-scanner capabilities
```

Use the resulting absolute executable path in the same configuration. A source build on a platform is not release-binary support for that platform. Changes to account, fingerprint, birthday or schema require [explicit project evolution](/docs/chef/evolution/).

Next: [Read receipts and memos](/docs/chef/shielded/memos/).
