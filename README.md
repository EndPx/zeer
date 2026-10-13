# Zeer

**Zcash data. Ready to build.**

Zeer is an open-source project for Zcash data tooling, with two product layers:

- **Zeer Prep** prepares and supplies chain data to applications. Its first Rust prototype imports bounded historical compact-block snapshots and serves subranges through a native gRPC batch API.
- **Zeer Chef** turns chain observations and authorized shielded receipts into application entities through TypeScript handlers, developer-owned PostgreSQL and GraphQL. This is the later framework phase.

Prep supplies the ingredients; Chef applies the developer's recipe. Applications may use Prep directly without Chef.

## Status

**Prep's first immutable-snapshot engine and benchmark harness are implemented. Chef, live following, production serving and npm packages are not implemented.**

The first external-provider experiment ran lightwalletd and Zaino on an isolated synthetic regtest chain. See [the harness](benchmarks/README.md) and [measured results](benchmarks/results/reports/2026-10-13.md). This is compact-block/header serving evidence, not shielded decryption or application-ingestion performance.

A second [historical transaction-lookup experiment](benchmarks/results/reports/2026-10-13-four.md) successfully included lightwalletd, Zaino, Zinder and CipherScan on the same 128 public mainnet transactions. It compares disclosed native read paths, not isolated engine or ingestion speed.

The [first Prep slice](docs/PREP_ENGINE.md) has Linux storage/integration tests and a [256-block mainnet capture/round-trip](benchmarks/results/reports/2026-10-13-prep.md), including nonempty Sapling and Orchard data. It preserves represented compact fields; it does not decrypt notes, validate consensus, or prove wallet compatibility. No comparative Prep speedup is claimed.

This is the core Zeer monorepo. See [accepted product responsibilities and planning order](.omc/plans/zeer-v0.1.md#0-accepted-product-names-and-planning-order).

## Planned Chef developer experience

- One user-facing npm package with a CLI and TypeScript SDK.
- Self-hosted operation with developer-owned PostgreSQL and local scanner state.
- Historical processing followed by live block tracking.
- Public chain facts and shielded receipts for accounts the operator is authorized to read.
- Typed entity operations, authenticated GraphQL, and optional signed webhooks.
- Explicit checkpoint, replay and reorg behavior.

Zeer does not require spending keys. Viewing keys and decoded private data remain sensitive and belong in the operator's protected environment. Shielded receipt discovery does not reveal every sender or private transaction in the network.

## Implemented Prep layout

```text
crates/prep/              Rust importer, native gRPC server, internal CLI
crates/prep-store/        Immutable bounded segment storage and integrity checks
crates/prep-proto/        Pinned upstream protocol and experimental Prep API
benchmarks/prep/          Independent reference capture and round-trip verifier
```

## Earlier Chef layout proposal

The following is the earlier framework layout proposal. It is separate from the implemented Prep slice; folders will be introduced as their components are implemented:

```text
crates/zeer-scanner/        Rust Zcash integration and scanning
packages/runtime/          TypeScript processing and persistence
packages/sdk/              Developer API and types
packages/cli/              CLI and process lifecycle
packages/graphql/          Read-only query API
examples/                  Standalone public-data and invoice examples
benchmarks/                Reproducible comparison and correctness harness
docs/                      Public plans, research and specifications
assets/brand/              Zeer identity assets
```

Internal modules do not imply separate npm publications. The initial target is one public package, with native distribution details handled internally.

## Planning and research

- [Start here: project plan](plan.md)
- [Prep engine contract and commands](docs/PREP_ENGINE.md)
- [Implementation plan and acceptance gates](.omc/plans/zeer-v0.1.md)
- [Benchmark methodology](docs/BENCHMARK_SPEC.md)
- [Envio / HyperIndex architecture research](docs/ENVIO_HYPERINDEX_RESEARCH.md)
- [Selected logo concept](assets/brand/zeer-logo-concept-v2.png)

The benchmark plan distinguishes external indexer comparisons, source-provider comparisons, and a direct-library scanner baseline. Claims will be tied to reproducible datasets, exact versions, correctness checks and actual measurements.

## Development

On Linux/WSL, use the pinned Rust 1.99.0 toolchain and committed lockfile:

```sh
cargo test --workspace --locked
cargo build -p prep --locked
target/debug/prep --help
```

Prep provides internal `import`, `inspect` and `serve` commands. See [the bounded snapshot workflow](docs/PREP_ENGINE.md#developer-commands). Serving defaults to loopback. The API is experimental and has no public-service authentication. Chef commands remain design examples.

The tested target is Linux x86_64; Windows development uses WSL2. Snapshot writes require Unix filesystem durability operations. Dependency versions are recorded in `Cargo.lock`.

## License

[MIT](LICENSE) for Zeer's original project materials and future original source. Referenced projects retain their own licenses. Downloaded upstream research code is local-only and is not part of this repository's implementation.
