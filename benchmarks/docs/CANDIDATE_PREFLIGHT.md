# Candidate preflight

Checked 2026-10-13. This document records upstream source/artifact inspection, not successful startup or measured performance. Machine-readable pins are in [candidates.json](../manifests/candidates.json). Runtime image IDs, versions, config hashes, resource limits, and result files belong in each run's evidence.

Runtime evidence and subsequent outcomes are local-only. The deferred labels below are historical preflight findings for the original workload and resource cap.

## Initial comparison

Use **lightwalletd v0.5.5** and **Zaino 0.10.1** against the same frozen, generated Zebra regtest chain. Compare `CompactTxStreamer` reads and normalize common semantic fields before checking results. This is a small synthetic source-service workload. It does not benchmark real shielded wallet scanning, memo decryption, GraphQL, application persistence, or public-chain ingestion. Empty/coinbase-only fixtures must be labelled accordingly.

Run only one candidate at a time. The shared VPS authorization caps the complete benchmark workload at 2 vCPU, 4 GiB RAM and 10 GiB operational disk; ports are loopback-only. Runtime root owns enforcement and existing services must remain unchanged. Image compressed sizes are not disk consumption; count extracted image layers, node and candidate data, runner artifacts and logs.

## lightwalletd

- Source pin: `d16d48124e9ad4157ebc2324b5090c6ba201470c` (`v0.5.5`).
- Official publication workflow emits `electriccoinco/lightwalletd:v0.5.5`, also mirrored to `zodlinc/lightwalletd:v0.5.5`.
- The Docker Hub manifest was read successfully; digest pins are in the JSON catalog. No release binaries are attached to the GitHub release.
- Static Go binary in Debian slim; entrypoint `lightwalletd`. Cache volume ownership should accommodate UID 2002 if running as the supplied non-root user.
- CLI example below is configuration reference only; the benchmark runner must add limits, mounts and loopback publication.

```text
--rpchost zebra
--rpcport 18232
--rpcuser benchmark
--rpcpassword benchmark
--grpc-bind-addr 0.0.0.0:9067
--http-bind-addr 127.0.0.1:9068
--no-tls-very-insecure
--data-dir /data
--log-file /dev/stdout
```

All four RPC flags must be nonempty, otherwise startup also tries to load `zcash.conf`. The dummy credentials above are for an isolated regtest node with authentication disabled, not deployed credentials. Keep the cache enabled for a cached serving scenario. `--nocache` is a different profile and must not be silently substituted. The source now initializes compact block caching from height zero.

Sources: [release workflow](https://github.com/zcash/lightwalletd/blob/d16d48124e9ad4157ebc2324b5090c6ba201470c/.github/workflows/CI.yaml), [CLI source](https://github.com/zcash/lightwalletd/blob/d16d48124e9ad4157ebc2324b5090c6ba201470c/cmd/root.go), [Dockerfile](https://github.com/zcash/lightwalletd/blob/d16d48124e9ad4157ebc2324b5090c6ba201470c/Dockerfile).

## Zaino

- Source pin: `3244a74bb09fa6a09a4b2deeb6be53bab0890747` (`0.10.1`).
- Release notes name official `zingodevops/zaino:0.10.1` and `:0.10.1-no-tls` images. Only use the no-TLS image within the isolated private benchmark network.
- Docker Hub's no-TLS tag timestamp predates release publication by three days. Record image digest and embedded binary version/revision. Do not infer image-to-source identity merely from the version-shaped tag.
- Container entrypoint refuses root; supplied user has UID/GID 1000. Mount config at `/app/config/zainod.toml`, data at `/app/data`; default subcommand is `start`.
- Canonical backend value is `rpc`; `fetch` is accepted as a legacy alias. Regtest activation heights are adopted from the validator's `getblockchaininfo.upgrades`.

Minimal proposed persistent-state configuration (requires runtime validation):

```toml
backend = "rpc"
network = "Regtest"
ephemeral_finalised_state = false

[grpc_settings]
listen_address = "0.0.0.0:8137"

[validator_settings]
validator_jsonrpc_listen_address = "zebra:18232"
validator_grpc_listen_address = "zebra:18230"
validator_user = "benchmark"
validator_password = "benchmark"

[service]
timeout = 30
channel_size = 32

[storage.cache]
capacity = 1000
shard_power = 4

[storage.database]
path = "/app/data"
size = 2
sync_write_batch_size = 1
accumulator_rebuild_memory_size = 1
sync_checkpoint_interval = 5
```

Database and batch/rebuild sizes are integer **GiB**, not bytes. Source default database map size is 384 GiB although the example config says 128; both are unsuitable defaults under this run's disk budget. Batch default is 8 GiB and the pipeline can hold two batches simultaneously, so even a 1 GiB budget is not a 1 GiB process cap. This proposed config is only appropriate for the small bounded fixture and must be guarded by a process/cgroup memory limit. Large-chain resource fitness is not established.

`ephemeral_finalised_state=true` disables persistent finalized storage and routes finalized reads to the validator; this is an explicitly different benchmark profile. If startup requires changing mode, record that choice and avoid presenting it as persisted indexing throughput. Validator secret fields are rejected in environment variables and must be supplied via TOML.

Sources: [release](https://github.com/zingolabs/zaino/releases/tag/0.10.1), [daemon config](https://github.com/zingolabs/zaino/blob/3244a74bb09fa6a09a4b2deeb6be53bab0890747/packages/zainod/src/config.rs), [storage types](https://github.com/zingolabs/zaino/blob/3244a74bb09fa6a09a4b2deeb6be53bab0890747/packages/zaino-common/src/config/storage.rs), [network type](https://github.com/zingolabs/zaino/blob/3244a74bb09fa6a09a4b2deeb6be53bab0890747/packages/zaino-common/src/config/network.rs), [container guide](https://github.com/zingolabs/zaino/blob/3244a74bb09fa6a09a4b2deeb6be53bab0890747/docs/docker.md).

## Zinder: deferred resource-fit validation

Source pin `9b9e7040453f66e847302f186f95d95b297e6705` (`v0.6.0`). An official native archive exists for x86-64-v3 Linux, 39,341,366 compressed bytes, with SHA256SUMS and provenance artifacts. It requires glibc >= 2.34 and `GLIBCXX_3.4.30`; Debian 12 is its documented baseline. The serving topology includes ingest, projector, query and a separate lightwalletd compatibility process sharing one filesystem.

Upstream regtest Compose assigns 2 + 2 + 1 + 1 GiB memory ceilings to these four processes, before Zebra and optional monitoring. Those are ceilings, not measured minimum RAM, but running unchanged exceeds the authorized aggregate budget. A separately validated constrained deployment is needed. Mark **deferred**, not performance failure. The single-volume serving target omits the lightwalletd compatibility process and cannot replace the common-protocol candidate.

Pinned release workflow derives GHCR namespace from the repository owner. The repository has moved, and the VM guide still refers to `gustavovalverde/zinder`; resolve the published namespace/digest before relying on an image name. Native release asset URLs in the catalog were confirmed through the GitHub API, but no asset has been downloaded or checksum-verified by this preflight.

Sources: [regtest environment](https://github.com/ZcashFoundation/zinder/blob/9b9e7040453f66e847302f186f95d95b297e6705/deploy/.env.regtest), [VM guide](https://github.com/ZcashFoundation/zinder/blob/9b9e7040453f66e847302f186f95d95b297e6705/docs/runbooks/deploying-on-a-vm.md), [release](https://github.com/ZcashFoundation/zinder/releases/tag/v0.6.0).

## CipherScan: later application-indexing workload

Source pin `15d7f528f07a84d796ed89029de21bfb26a24d23`. This candidate reads compatible Zebra/Zakura RocksDB state directly and writes application entities to PostgreSQL. It does not serve the common lightwalletd protocol. Current source pins a Zakura chain dependency, documents state v29, Rust 1.97.1 and PostgreSQL 14+.

Its `Network` enum supports only Mainnet/Testnet. `NETWORK=regtest` silently selects Mainnet, so do not treat an unmodified run on the synthetic regtest fixture as a supported comparison. A later comparison requires a bounded public-chain state snapshot compatible with the reader, database schema, matched entity workload, and a build artifact. The README's approximately 50 GB full indexed database estimate also lies outside this run's disk envelope; that does not prove a bounded sample would exceed it. README speed claims are not measured results.

Sources: [config source](https://github.com/Kenbak/cipherscan-rust/blob/15d7f528f07a84d796ed89029de21bfb26a24d23/src/config.rs), [README](https://github.com/Kenbak/cipherscan-rust/blob/15d7f528f07a84d796ed89029de21bfb26a24d23/README.md).
