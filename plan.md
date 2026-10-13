# Zeer planning entry point

Updated: 2026-10-13 (Asia/Jakarta).

**Status: planning baseline; technical design pending approval for implementation.**

Zeer is an open-source, self-hosted indexing framework for Zcash applications. Developers write TypeScript handlers, supply their own PostgreSQL database, and query indexed application data through GraphQL. A Rust component handles Zcash integration and authorized shielded scanning.

## Authoritative documents

- [Implementation plan and architecture](.omc/plans/zeer-v0.1.md): accepted product decisions, proposed technical contracts, scope, risks, gates, and acceptance criteria.
- [Benchmark specification](docs/BENCHMARK_SPEC.md): comparison eligibility, scenarios, metrics, fixtures, and publication rules.
- [Envio / HyperIndex package research](docs/ENVIO_HYPERINDEX_RESEARCH.md): pinned npm/source findings and the ReScript/Rust boundary; recommendations do not override the implementation plan.
- [Benchmark harness](benchmarks/README.md) and [first measured results](benchmarks/results/reports/2026-10-13.md): two external providers tested on a frozen synthetic regtest fixture before engine implementation.
- [Four-candidate measured follow-up](benchmarks/results/reports/2026-10-13-four.md): all four completed the same historical transaction-lookup projection under a disclosed expanded resource profile.
- [Selected logo concept](assets/brand/zeer-logo-concept-v2.png): approved raster concept sheet, not an SVG asset pack.

Technical contracts live in the implementation plan. Benchmark methodology lives in the benchmark specification; do not maintain competing copies.

## Present evidence

- Name and revised logo concept selected in conversation.
- Product direction agreed: HyperIndex-style framework, TypeScript developer experience, GraphQL, self-hosting, developer-owned database, open source.
- Benchmarking against other indexers explicitly requested.
- Repository direction accepted on 2026-10-13: one core monorepo under the user's personal GitHub account, rather than separate repositories for the engine, SDK and CLI.
- Implementation priority clarified: engine, correctness/recovery tests and early benchmarks first; polished public SDK/CLI packaging follows.
- Workspace inspected on 2026-10-12: logo asset only before these planning documents; no application source or Git repository.
- Benchmark-first implementation authorized on 2026-10-13. The harness and a limited provider-serving comparison now exist; Zeer engine, developer SDK/CLI and package publication do not.
- lightwalletd and Zaino both passed five measured reads in each of two separately reported resource profiles. This proves the declared synthetic compact header/projection case, not nonempty shielded scanning or application indexing.
- The public-mainnet follow-up includes Zinder and CipherScan as well: all four passed five runs of 128 transaction lookups. Workload/transport differences and the historical-source health policy are documented; this does not complete the broader scanning/ingestion benchmark requirements.

## Next implementation step

Continue benchmark-first work with nonempty shielded fixtures and a suitable application-indexing comparison. The current small provider-serving baseline is a first experiment, not completion of the benchmark specification or all of G0. Zeer engine work remains separate: G0 feasibility, then G1 scanner/recovery proof. Full chain-to-GraphQL benchmarks follow when those layers are connected.

The plan does not authorize purchasing infrastructure, publishing packages, submitting the hackathon entry, or accessing third-party private wallet data. It records work to perform when implementation is requested.
