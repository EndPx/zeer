# Four-provider frozen-mainnet profile

See [feasibility](../../docs/FOUR_CANDIDATE_FEASIBILITY.md) for pinned upstream research. This folder holds serving configurations and a bounded-sync recipe. Execution records remain local-only.

## Boundaries

- Aggregate authorization used: 3 CPU, 8 GiB process memory, 40 GiB incremental operational disk.
- One measured provider at a time: source 1 CPU/2 GiB, provider 1 CPU/4 GiB, client 1 CPU/512 MiB.
- Public mainnet prefix only; no wallet, signing or broadcast operation is invoked.
- Keep every service in a dedicated Docker network. Bootstrap needs P2P egress, but measured serving uses an `--internal` no-egress network. No gRPC/DB service needs a public host port.
- Existing application services and their databases must not be used or stopped.

## Source

Use `zakuracore/zakura@sha256:17894f48b51ee4249a6555692a07881a305085f25b5c7b0bed5887a73e2ad85a`.
The binary reports Zakura 1.5.0, source revision 7632c2e15a8f, state v29.

Mount the selected TOML at `/config/zakura.toml` and a dedicated writable state
directory at `/data`. Required environment:

```text
CONFIG_FILE_PATH=/config/zakura.toml
ZAKURA_STATE__CACHE_DIR=/data
ZAKURA_RPC__COOKIE_DIR=/data
ZAKURA_RPC__ENABLE_COOKIE_AUTH=false
```

Command: `zakurad start`. The entrypoint adds `--config` when CONFIG_FILE_PATH is
set; passing it a second time is an error. Check startup logs for the actual
configuration path before allowing sync. The cache environment variable prevents
the image entrypoint's default from overriding the configured state directory.

For a fresh reproduction, use `zakura-bootstrap.toml` and verify it exits at
height 6764. The initial measured bootstrap instead required a manual stop after
a missed config variable; its actual frozen head is preserved in the manifest.
Keep preparation time separate from serving measurements.

Restart the same state with `zakura-frozen.toml`, no peer seeds/cache, and an
internal Docker network. Give its network alias `zebra`. Check RPC identity:

```text
network: main
height: 6764
hash: 0000000160e11c9403141d7c2a16b07a2459919fc774795da3f687628c5ece54
```

The health endpoint at `http://zebra:18233/ready` uses the explicitly relaxed
historical-fixture policy in the TOML. Accept only its genuine HTTP 200 response;
do not replace it with a mock responder or change RPC verification progress.
This readiness configuration does not mean the source is synced to current mainnet.

## Candidate preparation

### lightwalletd and Zaino

Use the image digests in [candidate pins](../../manifests/candidates.json).
lightwalletd uses the same flags as the first experiment, with RPC host `zebra`
and port `8232`, independent data directory, gRPC port `9067`, and dummy fixture
RPC credentials because the isolated source has RPC auth disabled.

Zaino uses `zaino.toml`, its own UID-1000 data directory, and gRPC port `8137`.
Wait until logs show persistent finalized state and gRPC ready; do not time a
run while its finalized database is still being built.

### Zinder

Use the official native v0.6.0 archive and checksum in [the wrapper documentation](../zinder/README.md).
The completed run used an Ubuntu 24.04 runtime containing curl, Python 3,
libstdc++ and libssl; the recorded custom image ID is in environment evidence.
The wrapper's Debian 12 Dockerfile is an alternative packaging recipe, not the
exact image used for these samples.

Mount native binaries at `/opt/zinder-release`, this folder's `zinder/` TOMLs at
`/etc/zeer-zinder`, the supervisor at `/opt/zeer-zinder/supervisor.py`, and a private
state directory at `/var/lib/zinder`. Use ephemeral tmpfs for `/run/zeer-zinder`.
Run `python3 /opt/zeer-zinder/supervisor.py config-check`, then run the supervisor
without arguments. Wait for all four real readiness probes before measurement.
The entire group shares the one provider cgroup, not one allocation per process.

### CipherScan / zecblock-rust

Pinned source: `15d7f528f07a84d796ed89029de21bfb26a24d23`.
The measured artifact was downloaded from upstream CI run `38329349273`, named
`cipherscan-indexer-linux-x86_64-15d7f528f07a84d796ed89029de21bfb26a24d23`.
Its SHA-256 is `67932d9a4a2cf545ddeefefa785a007cc925b09884b8f18b703cb89598b2a735`.
The upstream retention is short; rebuild with its pinned Rust toolchain and
`cargo build --locked --release` if the artifact expires, and record the new hash.

Create a separate PostgreSQL 16 instance/database. `cipherscan-role.sql` creates
the disposable role expected by upstream's schema. Apply the unmodified
`schema/postgres.sql` from the pinned source with `ON_ERROR_STOP=1`. Never apply
it to an application database. The measured PostgreSQL image digest is
`postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777`.

Mount source state read-only and configure `NETWORK=mainnet`,
`ZEBRA_STATE_PATH=/node/state/v29/mainnet`, and a private `DATABASE_URL` for the
isolated database. Run `cipherscan-indexer backfill --from 1 --to 6764`.
Require clean completion and canonical block rows through 6764 before lookup
timing. Stop the indexer after completion; the measured serving path is the
PostgreSQL instance with the already materialized fields. Include both indexer
and DB in preparation resource accounting.

## Fixture and measurements

The committed [manifest](../../fixtures/mainnet-transactions-v1/manifest.json)
contains raw selected transactions, decoded expected values, full selected-block
membership, selection rule and hashes. To independently recreate it, run
`benchmarks/scripts/freeze_mainnet_transactions.py` with `ZEER_REFERENCE_RPC`
pointing to the frozen source and a new output path. The captured timestamp can
differ; compare record hashes and inclusion fields when regenerating.

Use the CLI in [transaction benchmark documentation](../../transactions/README.md),
with `--source-version Zakura1.5.0 --profile shared-vps-mainnet-prefix-v1` and the
committed manifest. Install the pinned gRPC dependencies and generate bindings
as in the benchmark README; add `benchmarks/transactions/requirements.txt` for
psycopg. Reuse one connection for each candidate, make one lookup per ID, run one
verified full warmup and five measurements. Store every raw report.

For three candidates use `--adapter grpc` with their internal gRPC endpoint.
For CipherScan use `--adapter postgres` with its isolated database DSN supplied
only through `ZEER_TX_ENDPOINT`. Never compare a batched SQL IN-query against
the sequential gRPC case without declaring a different scenario.

Stop all benchmark services when complete and retain evidence/state for review.
Do not run a global Docker prune or delete unrelated application data.
