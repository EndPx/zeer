# Zeer

**Zcash data. Ready to build.**

Zeer is an open-source project for Zcash data tooling, with two product layers:

- **Zeer Prep** prepares and supplies complete Zcash blocks and transactions through a Rust archive, a range/filter HTTP API, and a typed client. Backfill, restart, source following and bounded reorg recovery are implemented.
- **Zeer Chef** processes public Prep data through TypeScript handlers into developer-owned PostgreSQL entities and authenticated GraphQL. The public-data prototype is implemented; authorized private scanning remains deferred.

Prep supplies the ingredients; Chef applies the developer's recipe. Applications may use Prep directly without Chef.

## Status

**Prep's full-data MVP and Chef's first public-data prototype are implemented and tested. Public production hosting, viewing-key scanning and npm publication remain out of scope.**

Prep supports bounded transaction-ID lookup, snapshot pinning, capability
discovery, immutable transaction indexes and direct metadata projection. See
the [query contract](docs/PREP_QUERY.md) and
[pinned CipherScan architecture review](docs/SL_CIPHERSCAN_RESEARCH.md).
Chef uses bounded write coalescing while preserving atomic block/checkpoint commits.
Developers can opt into bounded scalar equality indexes with field `@index`
declarations during explicit migration. Existing schemas retain their behavior;
see the [query-index contract](docs/CHEF_QUERY_INDEXES.md) and
[schema/handler evolution procedure](docs/SCHEMA_EVOLUTION.md) before changing a
running project's model.

Benchmark outputs, comparison tables and reports are retained locally under
`benchmarks/results/` and excluded from Git. The public repository keeps the
[harness and reproduction instructions](benchmarks/README.md), source pins and
input fixtures. No performance ranking is published here.

Whole-chain execution and production readiness remain unproven. Neither Prep
nor the current public Chef slice decrypts private notes or validates consensus.

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
- [Recovery and operator guide](docs/OPERATIONS.md)
- [Opt-in query indexes](docs/CHEF_QUERY_INDEXES.md)
- [Schema and handler evolution design](docs/SCHEMA_EVOLUTION.md)
- [Local package installation and verification](docs/PACKAGING.md)
- [Demo script and architecture](docs/DEMO.md)
- [Implementation plan and acceptance gates](.omc/plans/zeer-v0.1.md)
- [Benchmark methodology](docs/BENCHMARK_SPEC.md)
- [Envio / HyperIndex architecture research](docs/ENVIO_HYPERINDEX_RESEARCH.md)
- [Selected logo concept](assets/brand/zeer-logo-concept-v2.png)

The benchmark plan distinguishes external indexer comparisons, source-provider comparisons, and a direct-library scanner baseline. Claims will be tied to reproducible datasets, exact versions, correctness checks and actual measurements.

## Development

Start with the [public-data quickstart](examples/quickstart/README.md) for an
isolated complete-block fixture → Prep → Chef → PostgreSQL → GraphQL walkthrough.
It includes direct Prep reads and a restart/resume check; it is historical
fixture replay, not a live mainnet service.

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
