# Zeer

**Zcash data. Ready to build.**

Zeer is an open-source project for Zcash data tooling, with two product layers:

- **Zeer Prep** prepares and supplies complete Zcash blocks and transactions through a Rust archive, a range/filter HTTP API, and a typed client. Backfill, restart, source following and bounded reorg recovery are implemented.
- **Zeer Chef** processes public Prep data through TypeScript handlers into developer-owned PostgreSQL entities and authenticated GraphQL. The public-data prototype is implemented; authorized private scanning remains deferred.

Prep supplies the ingredients; Chef applies the developer's recipe. Applications may use Prep directly without Chef.

## Status

**Prep's full-data MVP and Chef's first public-data prototype are implemented and tested. Public production hosting, viewing-key scanning and npm publication remain out of scope.**

The [Prep index/metadata update](benchmarks/results/reports/2026-10-14-prep-index.md)
adds bounded immutable transaction-ID indexes and direct size/input/output counts
without changing the archive format. On the same early-mainnet workload, the
128-ID query falls from 437.477 ms to 42.940 ms with identical decoded fields,
or 16.612 ms using direct metadata. All 45 measured projections match their
independent oracle. Admission, memory, fallback and scale limits are documented.

The [Chef writer optimization](benchmarks/results/reports/2026-10-14-chef-optimized.md)
passes 38 tests with real PostgreSQL. Five alternating runs per build reduced
median durable indexing time from 40.311 s to 13.295 s on the unchanged
2,048-block / 16,962-transaction public example, with every persisted entity
verified. This measures ingestion; the read-side GraphQL path is unchanged.

The [Chef report](benchmarks/results/reports/2026-10-14-chef.md) records 31 tests
with real PostgreSQL, a live CLI/GraphQL round trip, and five fresh indexing runs
for each of Prep and direct RPC: 2,048 blocks / 16,962 transactions, every entity
verified independently. Whole-chain indexing was not run; source retrieval,
application indexing and supplemental external-provider lookups are kept separate.

The first external-provider experiment ran lightwalletd and Zaino on an isolated synthetic regtest chain. See [the harness](benchmarks/README.md) and [measured results](benchmarks/results/reports/2026-10-13.md). This is compact-block/header serving evidence, not shielded decryption or application-ingestion performance.

A second [historical transaction-lookup experiment](benchmarks/results/reports/2026-10-13-four.md) successfully included lightwalletd, Zaino, Zinder and CipherScan on the same 128 public mainnet transactions. It compares disclosed native read paths, not isolated engine or ingestion speed.

The [full-data report](benchmarks/results/reports/2026-10-13-prep-full.md) verifies 1,024 complete mainnet blocks and 13,817 transactions, real isolated-Regtest following, 64 Rust tests and 13 SDK tests. A narrow header-query comparison is published with its source/preparation boundaries; it is not a millions-of-block or general indexing-speed claim.

The [first improvement report](benchmarks/results/reports/2026-10-13-prep-improvements.md) expands verification to **4,096 blocks / 50,283 transactions**, adds sequential range reads and bounded projection sizing, and overlaps raw/decoded source requests. It records 73 Rust tests, 13 SDK tests, four oracle tests and six before/after read workloads, with every run and the shared-host limitations retained.

The [proof follow-up](benchmarks/results/reports/2026-10-13-prep-proof.md) adds a genuine NU5 full-data fixture with Sapling and Orchard, a ten-minute real Regtest follow test through two source outages, and a real Zebra branch replacement with cursor rejection. Follow mode now has bounded retries for classified transient source failures. The follow-up passes 78 Rust tests and 13 Python fixture/guard tests; its fixture replay, Regtest and production boundaries are recorded separately.

The earlier [compact snapshot experiment](benchmarks/results/reports/2026-10-13-prep.md) remains supported separately. Neither path decrypts private notes or independently validates consensus.

This is the core Zeer monorepo. See [accepted product responsibilities and planning order](.omc/plans/zeer-v0.1.md#0-accepted-product-names-and-planning-order).

## Chef public developer experience

- One local unpublished package with CLI, TypeScript handlers and generated types.
- Self-hosted operation with developer-owned PostgreSQL.
- Historical processing followed by live block tracking.
- Public chain facts from Prep; viewing-key scanning and webhooks are deferred.
- Typed entity operations and authenticated read-only GraphQL.
- Explicit checkpoint, replay and reorg behavior.

Zeer does not require spending keys. Viewing keys and decoded private data remain sensitive and belong in the operator's protected environment. Shielded receipt discovery does not reveal every sender or private transaction in the network.

## Implemented Prep layout

```text
crates/prep/              Rust full-node source, follower, HTTP queries, compact API
crates/prep-store/        Immutable segments, atomic archive catalog, header index
crates/prep-proto/        Pinned upstream protocol and experimental Prep API
packages/prep-client/     Typed native-fetch client; unpublished local npm package
packages/chef/            Public TS handlers, PostgreSQL runtime, GraphQL and CLI
examples/prep-client/     Runnable client example
examples/chef-public/     Runnable public-data application schema and handlers
benchmarks/prep/          Independent reference capture and round-trip verifier
```

## Earlier Chef layout proposal

The following is the earlier full framework proposal. The active public-only
slice is consolidated in `packages/chef`; these additional modules remain planned:

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
- [28 October delivery scope](docs/PREP_DELIVERY.md)
- [Query and SDK contract](docs/PREP_QUERY.md)
- [Chef public-data contract](docs/CHEF_PUBLIC_MVP.md)
- [Chef example and commands](examples/chef-public/README.md)
- [Implementation plan and acceptance gates](.omc/plans/zeer-v0.1.md)
- [Benchmark methodology](docs/BENCHMARK_SPEC.md)
- [Envio / HyperIndex architecture research](docs/ENVIO_HYPERINDEX_RESEARCH.md)
- [Selected logo concept](assets/brand/zeer-logo-concept-v2.png)

The benchmark plan distinguishes external indexer comparisons, source-provider comparisons, and a direct-library scanner baseline. Claims will be tied to reproducible datasets, exact versions, correctness checks and actual measurements.

## Development

On Linux/WSL, use the pinned Rust 1.99.0 toolchain and committed lockfile:

```sh
cargo test --workspace --locked
cargo build --release -p prep --locked
target/release/prep --help
node --test packages/prep-client/test/*.test.js
```

Use `sync`, `archive-inspect` and `serve-http` for full data, with `--follow` for source tracking. See [the engine commands](docs/PREP_ENGINE.md#commands). `import`, `inspect` and `serve` retain the earlier compact snapshot workflow. HTTP defaults to loopback; non-loopback access requires explicit opt-in and a deployment token. This is not an audited public-service deployment. Chef commands are available through the local package; see [the public example](examples/chef-public/README.md).

The tested target is Linux x86_64; Windows development uses WSL2. Snapshot writes require Unix filesystem durability operations. Dependency versions are recorded in `Cargo.lock`.

## License

[MIT](LICENSE) for Zeer's original project materials and future original source. Referenced projects retain their own licenses. Downloaded upstream research code is local-only and is not part of this repository's implementation.
