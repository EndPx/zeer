# Local viewing-key setup

Requirements: Linux/WSL2, Node 24.14+, the repository's Rust 1.99.0 toolchain, protoc, PostgreSQL and a testnet UFVK containing Sapling and Orchard components.

## 1. Build

From the Zeer checkout:

```sh
npm ci
npm run build:chef
cargo build --release --locked -p zeer-scanner
```

## 2. Configure the key and environment

Store the UFVK outside the checkout in an owner-only file. Use 0400/0600 on Unix or an owner-only ACL on Windows. Never paste a seed or spending key.

```sh
target/release/zeer-scanner inspect-key --account inbox --key-file /protected/testnet.ufvk
cp examples/shielded-inbox/.env.example /protected/inbox.env
```

Edit the protected environment file:

| Variable | Value |
| --- | --- |
| `PREP_URL` | Compatible testnet Prep base URL |
| `DATABASE_URL` | Your PostgreSQL connection |
| `CHEF_API_TOKEN` | Private random token, at least 16 bytes |
| `ZEER_SCANNER_EXECUTABLE` | Absolute scanner executable path |
| `ZEER_VIEWING_KEY_FILE` | Absolute UFVK file path |
| `ZEER_KEY_FINGERPRINT` | Fingerprint from `inspect-key` |
| `ZEER_BIRTHDAY_HEIGHT` | Height at or before the first relevant receipt |

## 3. Index and serve

```sh
node --env-file=/protected/inbox.env packages/chef/dist/cli.js codegen --config examples/shielded-inbox/chef.config.ts
node --env-file=/protected/inbox.env packages/chef/dist/cli.js migrate --config examples/shielded-inbox/chef.config.ts
node --env-file=/protected/inbox.env packages/chef/dist/cli.js sync --config examples/shielded-inbox/chef.config.ts --follow
```

In another terminal:

```sh
node --env-file=/protected/inbox.env packages/chef/dist/cli.js serve --config examples/shielded-inbox/chef.config.ts --listen 127.0.0.1 --port 39375
```

**Notes:** Use a fresh project namespace and keep the key/database/token private. Changes to account, fingerprint, birthday or schema require [explicit evolution](/docs/chef/evolution/).

Next: [Read receipts & memos](/docs/chef/shielded/memos/). The [full example](https://github.com/EndPx/zeer/tree/main/examples/shielded-inbox) includes native test instructions.
