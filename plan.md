# Zeer planning entry point

Updated: 2026-10-13 (Asia/Jakarta).

**Status: planning baseline; technical design pending approval for implementation.**

Zeer is an open-source, self-hosted indexing framework for Zcash applications. Developers write TypeScript handlers, supply their own PostgreSQL database, and query indexed application data through GraphQL. A Rust component handles Zcash integration and authorized shielded scanning.

## Authoritative documents

- [Implementation plan and architecture](.omc/plans/zeer-v0.1.md): accepted product decisions, proposed technical contracts, scope, risks, gates, and acceptance criteria.
- [Benchmark specification](docs/BENCHMARK_SPEC.md): comparison eligibility, scenarios, metrics, fixtures, and publication rules.
- [Envio / HyperIndex package research](docs/ENVIO_HYPERINDEX_RESEARCH.md): pinned npm/source findings and the ReScript/Rust boundary; recommendations do not override the implementation plan.
- [Selected logo concept](assets/brand/zeer-logo-concept-v2.png): approved raster concept sheet, not an SVG asset pack.

Technical contracts live in the implementation plan. Benchmark methodology lives in the benchmark specification; do not maintain competing copies.

## Present evidence

- Name and revised logo concept selected in conversation.
- Product direction agreed: HyperIndex-style framework, TypeScript developer experience, GraphQL, self-hosting, developer-owned database, open source.
- Benchmarking against other indexers explicitly requested.
- Repository direction accepted on 2026-10-13: one core monorepo under the user's personal GitHub account, rather than separate repositories for the engine, SDK and CLI.
- Implementation priority clarified: engine, correctness/recovery tests and early benchmarks first; polished public SDK/CLI packaging follows.
- Workspace inspected on 2026-10-12: logo asset only before these planning documents; no application source or Git repository.
- No scanner, CLI, package publication, live integration, or benchmark result exists in this workspace yet.

## Next implementation step

Start **G0: feasibility and comparison preflight**, then **G1: shielded read-path and recovery proof**, as defined in the implementation plan. Use minimal internal runners and early benchmark baselines before public CLI/SDK polish. Full chain-to-GraphQL benchmarks follow when those layers are connected. Do not start a dashboard or optimize throughput before the read-path and data-correctness gates pass.

The plan does not authorize purchasing infrastructure, publishing packages, submitting the hackathon entry, or accessing third-party private wallet data. It records work to perform when implementation is requested.
