# Four-candidate public-chain feasibility

Research date: 2026-10-13. This is a source-grounded deployment proposal, not evidence that four candidates have completed a benchmark. The expanded run authorization is aggregate **3 vCPU / 8 GiB RAM / 40 GiB operational disk** on the existing shared VPS; no paid upgrade or unrelated application changes. Root owns deployment and actual measurements.

This document preserves candidate research and admission methodology. Runtime results are retained locally under `benchmarks/results/`.

## Selected practical route

Use the current pinned CipherScan code, now hosted under **Kenbak/zecblock-rust**, with its explicitly aligned node **Zakura v1.5.0**. Bootstrap only a short public Mainnet prefix, freeze it, then run one candidate at a time. Use a **public transaction lookup projection** as the common four-candidate operation:

- lightwalletd / Zaino / Zinder: `CompactTxStreamer/GetTransaction(txid)`, followed by the same client decoder.
- CipherScan: parameterized PostgreSQL lookup of the fields already materialized by its native backfill.

This measures **native lookup paths plus normalization**, not identical ingestion work or engine-only performance. Raw transaction decoding happens at query time for the first three and during ingestion for CipherScan. Report that asymmetry prominently, along with transport, response bytes, setup time, indexed footprint and warm/cold conditions. Do not call the fastest result the fastest Zcash indexer generally.

No public snapshot below approximately 30 GiB was verified. A fresh prefix avoids trusting or downloading a full public-chain snapshot. Its resulting size must be measured and guarded, not assumed from the small height.

## Node and source pins

| Component | Pin | Evidence |
|---|---|---|
| CipherScan / zecblock-rust | `15d7f528f07a84d796ed89029de21bfb26a24d23` | [Cargo manifest](https://github.com/Kenbak/zecblock-rust/blob/15d7f528f07a84d796ed89029de21bfb26a24d23/Cargo.toml) pins `zakura-chain` at `v1.5.0` |
| Zakura node | `v1.5.0`, commit `7632c2e15a8f46fb1485f44dd290c7b7ee08afed` | [release](https://github.com/zakura-core/zakura/releases/tag/v1.5.0) |
| Node Docker image | `zakuracore/zakura:1.5.0` | [official Compose source](https://github.com/zakura-core/zakura/blob/7632c2e15a8f46fb1485f44dd290c7b7ee08afed/docker/docker-compose.yml), [Docker Hub tag](https://hub.docker.com/v2/repositories/zakuracore/zakura/tags/1.5.0) |
| Image root digest | `sha256:17894f48b51ee4249a6555692a07881a305085f25b5c7b0bed5887a73e2ad85a` | Registry response inspected |
| Linux amd64 image | `sha256:8d5680bf1eb3bccbed4e4303980a5f737fea3ae9abacdf48f17eb3e31b7e27ba` | 170,315,887 compressed bytes; extracted disk use differs |

The Docker tag is `1.5.0`, **not** `v1.5.0`. The release also provides [a Linux x86-64 tarball](https://github.com/zakura-core/zakura/releases/download/v1.5.0/zakurad-v1.5.0-linux-x86_64.tar.gz), 111,484,498 bytes, plus signed `SHA256SUMS.txt`. Native assets were discovered but not downloaded/verified by this preflight. Capture actual binary version, OCI revision and digest when deployed.

CipherScan's RocksDB reader opens a secondary and reads `hash_by_height`, `block_header_by_height`, `tx_by_loc`, `hash_by_tx_loc`, and `tx_loc_by_hash`. The block height key is 3-byte big-endian and transaction location adds a 2-byte big-endian transaction index. It uses the chain library for header/transaction parsing and a unique PID-based secondary path under the process temporary directory. Preserve the entire node state directory and manage temporary secondary data within the disk envelope. [Reader source](https://github.com/Kenbak/zecblock-rust/blob/15d7f528f07a84d796ed89029de21bfb26a24d23/src/db/rocks.rs).

## Bounded bootstrap and frozen RPC service

The exact supported cap is **`[state] debug_stop_at_height`**. It commits finalized blocks through the configured height, flushes and exits; it does not continue serving RPC after hitting the cap. The comparison uses `>=` after each successful finalized commit, so 2048 need not itself be a checkpoint. Verification/download queues may fetch beyond the cap before the corresponding finalized commits. Restarting with this same cap exits immediately when the stored tip is already there. [State configuration](https://github.com/zakura-core/zakura/blob/7632c2e15a8f46fb1485f44dd290c7b7ee08afed/crates/zakura-state/src/config.rs), [stop implementation](https://github.com/zakura-core/zakura/blob/7632c2e15a8f46fb1485f44dd290c7b7ee08afed/crates/zakura-state/src/service/finalized_state.rs).

Proposed bootstrap configuration:

```toml
[network]
network = "Mainnet"
p2p_stack = "legacy"
listen_addr = "127.0.0.1:8233"
cache_dir = false

[state]
cache_dir = "/data"
debug_stop_at_height = 2048
delete_old_database = false

[rpc]
listen_addr = "0.0.0.0:8232"
enable_cookie_auth = false

[tracing]
use_color = false
```

Keep the upstream peer seed defaults for bootstrap. The deployment must bind any host RPC publication to loopback only, and the bootstrap P2P listener is not published. Unauthenticated RPC above is restricted to this isolated benchmark network, not a production recommendation.

Official container settings:

```yaml
image: zakuracore/zakura@sha256:17894f48b51ee4249a6555692a07881a305085f25b5c7b0bed5887a73e2ad85a
environment:
  CONFIG_FILE_PATH: /config/zakura.toml
  ZAKURA_STATE__CACHE_DIR: /data
  ZAKURA_RPC__COOKIE_DIR: /data
command: ["zakurad", "start"]
```

This is a fragment, not a ready deployment: add explicit resource limits, local-only publication, storage and config mounts. Entrypoint always exports `ZAKURA_STATE__CACHE_DIR`, defaulting to `/home/zebra/.cache/zakura`, so explicitly set `/data` to prevent environment precedence overriding TOML. Entrypoint begins as root for directory ownership then drops to UID/GID 10001. It recursively changes ownership only within supplied directories; mount a dedicated benchmark directory, never an unrelated application's data. [Entrypoint](https://github.com/zakura-core/zakura/blob/7632c2e15a8f46fb1485f44dd290c7b7ee08afed/docker/entrypoint.sh), [Dockerfile](https://github.com/zakura-core/zakura/blob/7632c2e15a8f46fb1485f44dd290c7b7ee08afed/docker/Dockerfile).

After bootstrap exits:

1. Record the exact tip hash, state format, disk footprint and clean stop evidence. Preserve a dedicated snapshot if disk permits.
2. Remove `debug_stop_at_height` from the serving configuration.
3. Set `initial_mainnet_peers = []`, `initial_testnet_peers = []`, keep network `cache_dir = false` and `p2p_stack = "legacy"`.
4. Run on a separate internal Docker network without external egress; retain the loopback P2P bind. No host-global firewall changes are required.
5. Verify RPC becomes available and the tip stays fixed before and after every run. The source returns immediately with an empty seed list rather than waiting in DNS retry, but RPC serving and each candidate's readiness on a stale prefix still require actual acceptance tests.

The peer settings are an official configuration choice, not a patch to node consensus or peer logic. Network isolation is the enforcement boundary. [Peer configuration source](https://github.com/zakura-core/zakura/blob/7632c2e15a8f46fb1485f44dd290c7b7ee08afed/crates/zakura-network/src/config.rs).

## Common dataset and normalized query

The initial proposed target was node prefix 0..2048 and queries within 1..1024. **Runtime correction reported by the deployment agent:** the first launch omitted `CONFIG_FILE_PATH`, logged that no config file was provided, and therefore passed the intended cap. The node was manually stopped and isolated at the actual validated head **6764**, hash **`0000000160e11c9403141d7c2a16b07a2459919fc774795da3f687628c5ece54`**. Preserve this real boundary in evidence instead of claiming the cap was applied. Mounting the file alone does not activate it. Set `CONFIG_FILE_PATH` explicitly and use command `["zakurad", "start"]`; do not add a duplicate `--config` when the entrypoint is already passing it.

The current fixture target is **128 heights `1 + floor(i*2047/127)` for i=0..127**, each choosing the earliest V1 non-coinbase transaction in block order, or the earliest V1 coinbase if none exists. Genesis is excluded from transaction selection; prefix head 6764 supplies a finality-window margin. The read-only [fixture capture script](../scripts/freeze_mainnet_transactions.py) requires that exact frozen head before and after capture, archives full ordered transaction IDs for selected blocks, and obtains expected fields from verbose node RPC rather than the timed decoder. A manifest is acquired evidence only after the script completes successfully against the real source. Original 2048 bootstrap configuration above remains a source-grounded future recipe, not the configuration successfully exercised by this first run.

Use one query per known txid, deterministic shuffled order, identical concurrency and repetition counts. Do not benchmark missing IDs as successful reads. Begin with this shared projection:

```json
{
  "txid": "display-order hexadecimal",
  "minedHeight": 123,
  "version": 1,
  "lockTime": 0,
  "sizeBytes": 100,
  "transparentInputCount": 1,
  "transparentOutputCount": 2
}
```

For the three compatible gRPC services, pass the txid in protocol-internal byte order, decode returned transaction bytes, and use returned mined height. For early V1/V2 transactions, independently verify txid via the appropriate transaction hash calculation. A narrow early-format decoder must reject unsupported formats and malformed/trailing data rather than report plausible values. Do not treat later V5+ identifiers as SHA256d hashes of whole serialized transactions.

CipherScan native projection:

```sql
SELECT txid,
       block_height AS "minedHeight",
       version,
       locktime AS "lockTime",
       size AS "sizeBytes",
       vin_count AS "transparentInputCount",
       vout_count AS "transparentOutputCount"
FROM public.transactions
WHERE txid = $1;
```

Its schema contains these fields but **does not contain raw transaction bytes**. Do not add a fake raw-transaction API and attribute its performance to upstream. Use its native backfill to populate the database from the same prefix, then query with persistent client connections. Keep backfill/setup timing distinct. Coinbases count as one transparent input in the inspected parser. [Current schema](https://github.com/Kenbak/zecblock-rust/blob/15d7f528f07a84d796ed89029de21bfb26a24d23/schema/postgres.sql), [parser](https://github.com/Kenbak/zecblock-rust/blob/15d7f528f07a84d796ed89029de21bfb26a24d23/src/indexer/transactions.rs).

### Why pre-Sapling transaction lookup is a viable route

lightwalletd `GetTransaction` checks the 32-byte txid, reverses internal to display byte order, calls `getrawtransaction(txid, 1)`, and parses the result; there is no Sapling activation-height guard in that handler. This is a different path from compact-block range serving. [lightwalletd handler](https://github.com/zcash/lightwalletd/blob/d16d48124e9ad4157ebc2324b5090c6ba201470c/frontend/service.go).

Zaino declares the same GetTransaction method on its gRPC service. Zinder's compatibility handler decodes the transaction ID, pins the chain epoch, queries its native transaction API and returns retained raw bytes with mined height; its handler likewise has no Sapling-height gate. End-to-end startup and retrieval from the chosen prefix remain required. [Zaino gRPC declaration](https://github.com/zingolabs/zaino/blob/3244a74bb09fa6a09a4b2deeb6be53bab0890747/packages/zaino-serve/src/rpc/grpc/service.rs), [Zinder handler](https://github.com/ZcashFoundation/zinder/blob/9b9e7040453f66e847302f186f95d95b297e6705/services/zinder-compat-lightwalletd/src/grpc.rs).

An early Mainnet prefix is public-chain evidence but is not representative of modern Sapling/Orchard traffic, memo extraction, or shielded trial decryption. Record the actual transaction-version mix and coinbase proportion. A later modern-era workload needs a larger validated state or suitable verified snapshot.

## Readiness and resource prerequisites

- Zakura source alignment covers CipherScan's parser and direct-state path; it does not prove Zaino/Zinder accept every current Zakura RPC response. Validate each candidate against the same immutable tip.
- A frozen historical prefix is intentionally far from network tip. Candidate upstream-health/readiness rules may refuse it; distinguish a supported explicit historical-serving configuration from altering health evidence. Do not fake synchronization or peer counts.
- Zinder needs canonical ingestion, wallet projection and compatibility readers. Preserve raw transaction retention (`raw_blob_policy = "transactions"`) and required projection coverage. The expanded memory envelope may fit sequential runs with tuned limits, but no actual consumption is established here.
- Building CipherScan with Rust 1.97.1 and native RocksDB dependencies may use substantial disk. Include toolchain, build artifacts and extracted images in the 40 GiB envelope; prefer bounded build jobs. A successful compile is not indexing success.
- Record all failures and unsupported cases instead of omitting candidates from a chart without explanation.

## Historical alternative, not selected

If current Zakura integration blocks progress, an unmodified historical CipherScan pin exists: **`115c40a8d84766e5e7d99f0803bb47d5875aff97`**, dated **2026-09-12**, immediately before the September 20 Zakura migration. It is MIT and pins `zebra-chain` at `v6.0.0`. Both Zebra v6.0.0 and existing v6.2.3 declare state format **28.0.0**; its direct reader uses the same core column families. This is a plausible compatibility route to validate, not proof of all-version interoperability. It must be labelled as an older candidate and cannot silently replace current `15d7f5`.

Sources: [historical manifest](https://github.com/Kenbak/zecblock-rust/blob/115c40a8d84766e5e7d99f0803bb47d5875aff97/Cargo.toml), [Zebra v6.0.0 format](https://github.com/ZcashFoundation/zebra/blob/v6.0.0/zebra-state/src/constants.rs), [Zebra v6.2.3 format](https://github.com/ZcashFoundation/zebra/blob/v6.2.3/zebra-state/src/constants.rs).

## License observations

At the inspected pins, lightwalletd, Zinder and CipherScan have MIT licenses; Zaino is Apache-2.0; Zakura's workspace declares MIT OR Apache-2.0 with both license files. Preserve notices if redistributing code/binaries and keep benchmark adapters distinguishable from upstream implementations. Dependencies can have additional notices; this is a source-license inventory rather than a complete dependency audit.

Sources: [lightwalletd](https://github.com/zcash/lightwalletd/blob/d16d48124e9ad4157ebc2324b5090c6ba201470c/LICENSE), [Zaino](https://github.com/zingolabs/zaino/blob/3244a74bb09fa6a09a4b2deeb6be53bab0890747/LICENSE), [Zinder](https://github.com/ZcashFoundation/zinder/blob/9b9e7040453f66e847302f186f95d95b297e6705/LICENSE), [CipherScan](https://github.com/Kenbak/zecblock-rust/blob/15d7f528f07a84d796ed89029de21bfb26a24d23/LICENSE), [Zakura manifest](https://github.com/zakura-core/zakura/blob/7632c2e15a8f46fb1485f44dd290c7b7ee08afed/Cargo.toml).
