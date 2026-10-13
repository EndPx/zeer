# Zinder v0.6.0 bounded benchmark deployment draft

Status: the wrapper was subsequently executed successfully for the
[four-provider mainnet-prefix experiment](../../results/reports/2026-10-13-four.md),
using the separate [mainnet configurations](../mainnet-prefix/README.md), an
Ubuntu 24.04 runtime, and 1 CPU / 4 GiB for the four-process group. The Debian
Dockerfile and regtest Compose recipe below remain alternative, unexecuted
recipes. Their 1.5 CPU / 4 GiB ceiling is not Zinder's minimum requirement.

## Pinned upstream and native package

- Repository: https://github.com/ZcashFoundation/zinder
- Tag: `v0.6.0`
- Commit: `9b9e7040453f66e847302f186f95d95b297e6705`
- Archive: https://github.com/ZcashFoundation/zinder/releases/download/v0.6.0/zinder-0.6.0-x86_64-v3-unknown-linux-gnu.tar.gz
- Published compressed size: 39,341,366 bytes.
- Published SHA-256: `860c21198198c0df6f3c7de5e71ca8b8ea75758fad93f628e935eb502cf48ce8`.
- Checksum source: https://github.com/ZcashFoundation/zinder/releases/download/v0.6.0/SHA256SUMS

Native bundle requirements are x86-64-v3 CPU, glibc >= 2.34 and
`libstdc++.so.6` exporting `GLIBCXX_3.4.30`. Debian 12 Bookworm is the upstream
certified runtime baseline. Verify the VPS CPU v3 capabilities before launch;
a generic amd64 host label does not prove them. The bundle contains ingest,
projector, native query, and compatibility binaries. It does **not** contain the
optional explorer binary. The measured mainnet-prefix run downloaded the archive
and verified its SHA-256; no signature verification is claimed. The Dockerfile checks the pinned archive digest
when the operator builds it; published Sigstore/GitHub attestations can also be
verified and recorded separately.

This directory wraps four independent unmodified release executables in one
custom benchmark container to enforce one aggregate cgroup ceiling. Upstream's
released images use four containers with a shared filesystem/network namespace.
Our custom packaging is neither their official release image nor a production
certification. Numeric UID 1000 runs writers; UID 1001 runs readers. Checkpoint
secrets are readable only by writers through supplementary GID 1002. All storage
is disposable public benchmark state on one filesystem.

## Exact configuration and commands

The source config loader merges defaults -> TOML -> `ZINDER_*` environment ->
CLI. Environment section separators are double underscores. These overrides are
valid on v0.6.0:

```text
ZINDER_NETWORK__NAME=zcash-regtest
ZINDER_NODE__JSON_RPC_ADDR=http://zebra:18232
ZINDER_NODE__AUTH__METHOD=none
ZINDER_NODE__INDEXER_GRPC_ADDR=
ZINDER_PROJECTOR__BUILD_OWNER_HEX=0000000000000000000000000000ee01
```

The provided TOMLs omit the optional indexer gRPC address, which selects polling
from Zebra JSON-RPC without a Zaino sidecar. Ingest uses
`source="zebra-json-rpc"`, `coverage="wallet-serving"`, and transaction raw-byte
retention; every reader matches that retention and the 100-block reorg policy.
The TOML contains the projector owner, so no cross-service projector env override
is needed (unknown section env vars can be rejected by other binaries).

Supervisor startup order is:

```text
/opt/zinder-release/bin/zinder-ingest --config /etc/zeer-zinder/ingest.toml
# wait for http://127.0.0.1:9105/readyz == HTTP 200
/opt/zinder-release/bin/zinder-projector --config /etc/zeer-zinder/projector.toml
# wait for http://127.0.0.1:9110/readyz == HTTP 200
/opt/zinder-release/bin/zinder-query --config /etc/zeer-zinder/query.toml
# wait for http://127.0.0.1:9106/readyz == HTTP 200
/opt/zinder-release/bin/zinder-compat-lightwalletd --config /etc/zeer-zinder/compat-lightwalletd.toml
# wait for http://127.0.0.1:9107/readyz == HTTP 200
```

Each binary supports `--print-config`; validate all four before treating the
config as executable evidence. `python3 /opt/zeer-zinder/supervisor.py config-check`
prepares container-local paths/secrets and invokes that validation without
starting chain ingestion. With no argument it supervises startup and runtime.
`health` requires all four readiness probes. Any child exit stops the entire
candidate. Readiness timeout defaults to 600 seconds per phase for this regtest
experiment; it is not an upstream mainnet construction SLA.

The regular container entrypoint is the supervisor. Merge this fragment after
the existing benchmark compose file (only the parent may execute remotely):

```text
docker compose -f benchmarks/infra/compose.yaml -f benchmarks/infra/zinder/compose.fragment.yaml --profile zinder config
docker compose -f benchmarks/infra/compose.yaml -f benchmarks/infra/zinder/compose.fragment.yaml build zinder
docker compose -f benchmarks/infra/compose.yaml -f benchmarks/infra/zinder/compose.fragment.yaml --profile zinder run --rm --no-deps zinder config-check
docker compose -f benchmarks/infra/compose.yaml -f benchmarks/infra/zinder/compose.fragment.yaml --profile zinder up -d --no-deps zinder
```

`ZEER_BENCH_DEBIAN_IMAGE` must be a verified Debian 12 image digest;
`ZEER_BENCH_STATE` must identify the isolated benchmark state directory. The
fragment's paths are relative to the first compose file, as required by Compose.
Stop other provider profiles first. Root must account for build activity too;
service CPU/memory limits do not automatically cap Docker build steps.

Compatibility gRPC is available as `zinder:9067` on the isolated Docker network
and `127.0.0.1:39267` on the host. Native WalletQuery and all ops/control ports
remain container-loopback-only. No explorer, Grafana, Prometheus, or public
ingress is included. The 4 GiB hard limit includes all four processes plus
tmpfs; two bounded CPU executors per process limit accidental thread fan-out.
Explicit small RocksDB budgets prevent each process allocating a fraction of
the shared cgroup ceiling as though it owned the entire container. The ceiling
still governs actual use; these knobs are not an RSS proof.

## Common API and comparison limits

`zinder-compat-lightwalletd` implements
`cash.z.wallet.sdk.rpc.CompactTxStreamer` including `GetLightdInfo`,
`GetLatestBlock`, `GetBlockRange` and `GetTransaction`. Source-level method
presence is not runtime parity evidence. For `GetTransaction`, request txid bytes
in the protocol's internal order and compare returned raw bytes/height against
the same frozen independent reference as other candidates. Ingest retention
`transactions` is required for these raw-transaction reads.

For `GetBlockRange`, use the separately declared `shielded_compact` identity
projection and verify its byte-order conversion. Hold Zebra at a fixed fixture
tip while comparing candidates. Finish ingestion, check all four ready endpoints,
run the same declared warmup, and then measure serving reads separately from
fresh ingestion. Keep cache state and topology in the result. Record any
readiness or incompatibility failure without turning it into zero throughput.

The optional `zinder-explorer` serves native ExplorerQuery. It is built separately
from source, is outside this four-binary release package, and requires its own
materialized-view topology. It is unnecessary for the shared lightwalletd API
workload and is not started by this draft. Raw transaction compatibility already
provides a possible common transaction-byte workload without an explorer server.

## Public network and disk boundary

Wallet-serving construction starts at height **1**, with genesis as its
authenticated predecessor. It cannot simply start at the recent range selected
for a benchmark: the global transparent projection needs the earlier outputs.
An explicit checkpoint is a different scope and requires valid predecessor tree
state; it does not carry transparent prefix state and can fail on older prevouts.
Do not relabel that reduced construction as full wallet-serving support.

Mainnet/testnet construction requires the source node to serve the entire needed
history and upgrade metadata. The current draft does not certify Zebra 6.2.3
against Zinder 0.6.0; that pairing must pass source admission and real readiness
checks on the operator's run. A 40 GiB aggregate disk envelope is **not proven**
to fit a full public node plus canonical and wallet stores, temporary construction
data, compaction, and safety reserve. Capacity observation must stop before the
authorized threshold, with no automatic deletion or enlargement. A shared public
RPC endpoint may also rate-limit or lack required methods; this is a separate
source-mode experiment, not equivalent to local regtest.

## Primary source evidence

All links below are frozen at the source commit above:

- [Native bundle/runtime topology](https://github.com/ZcashFoundation/zinder/blob/9b9e7040453f66e847302f186f95d95b297e6705/docs/runbooks/deploying-on-a-vm.md)
- [Upstream regtest overrides](https://github.com/ZcashFoundation/zinder/blob/9b9e7040453f66e847302f186f95d95b297e6705/deploy/.env.regtest)
- [Official four-container Compose](https://github.com/ZcashFoundation/zinder/blob/9b9e7040453f66e847302f186f95d95b297e6705/deploy/docker-compose.yml)
- [Initial sync, coverage and readiness](https://github.com/ZcashFoundation/zinder/blob/9b9e7040453f66e847302f186f95d95b297e6705/docs/runbooks/initial-sync.md)
- [Resource tuning controls](https://github.com/ZcashFoundation/zinder/blob/9b9e7040453f66e847302f186f95d95b297e6705/docs/runbooks/bulk-catchup-resource-tuning.md)
- [Exact RocksDB config fields](https://github.com/ZcashFoundation/zinder/blob/9b9e7040453f66e847302f186f95d95b297e6705/crates/zinder-runtime/src/sections/storage.rs)
- [Lightwalletd RPC implementations](https://github.com/ZcashFoundation/zinder/blob/9b9e7040453f66e847302f186f95d95b297e6705/services/zinder-compat-lightwalletd/src/grpc.rs)
