# Zeer

**Zcash data. Ready to build.**

Zeer is a planned open-source indexing framework for Zcash. Developers will define TypeScript handlers, supply their own PostgreSQL database, and query indexed application data through GraphQL. A Rust scanner will handle Zcash integration and authorized shielded receipt discovery.

## Status

**Benchmark harness implemented; Zeer engine and npm package not implemented yet.**

The first external-provider experiment ran lightwalletd and Zaino on an isolated synthetic regtest chain. See [the harness](benchmarks/README.md) and [measured results](benchmarks/results/reports/2026-10-13.md). This is compact-block/header serving evidence, not shielded decryption or application-ingestion performance.

A second [historical transaction-lookup experiment](benchmarks/results/reports/2026-10-13-four.md) successfully included lightwalletd, Zaino, Zinder and CipherScan on the same 128 public mainnet transactions. It compares disclosed native read paths, not isolated engine or ingestion speed.

This is the core Zeer monorepo. Implementation proceeds engine-first: prove scanning and persistence, test recovery, establish benchmarks, then finish the developer-facing SDK and CLI. Minimal handler contracts and internal runners are defined early to support that work.

## Planned developer experience

- One user-facing npm package with a CLI and TypeScript SDK.
- Self-hosted operation with developer-owned PostgreSQL and local scanner state.
- Historical processing followed by live block tracking.
- Public chain facts and shielded receipts for accounts the operator is authorized to read.
- Typed entity operations, authenticated GraphQL, and optional signed webhooks.
- Explicit checkpoint, replay and reorg behavior.

Zeer does not require spending keys. Viewing keys and decoded private data remain sensitive and belong in the operator's protected environment. Shielded receipt discovery does not reveal every sender or private transaction in the network.

## Planned monorepo layout

Folders will be introduced as their components are implemented:

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
- [Implementation plan and acceptance gates](.omc/plans/zeer-v0.1.md)
- [Benchmark methodology](docs/BENCHMARK_SPEC.md)
- [Envio / HyperIndex architecture research](docs/ENVIO_HYPERINDEX_RESEARCH.md)
- [Selected logo concept](assets/brand/zeer-logo-concept-v2.png)

The benchmark plan distinguishes external indexer comparisons, source-provider comparisons, and a direct-library scanner baseline. Claims will be tied to reproducible datasets, exact versions, correctness checks and actual measurements.

## Development

There are no Zeer engine/SDK/CLI commands yet. The [benchmark tooling](benchmarks/README.md) has executable tests and reproduction instructions. Proposed Zeer commands and APIs in the planning documents remain design examples. Benchmark-first work precedes the Zeer scanner/recovery proof.

The intended initial deployment target is Linux x86_64; Windows development uses WSL2. Runtime/toolchain versions will be pinned when validated.

## License

[MIT](LICENSE) for Zeer's original project materials and future original source. Referenced projects retain their own licenses. Downloaded upstream research code is local-only and is not part of this repository's implementation.
