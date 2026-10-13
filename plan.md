# Zeer planning entry point

Updated: 2026-10-13 (Asia/Jakarta).

**Status: planning baseline; technical design pending approval for implementation.**

Zeer is the umbrella brand and monorepo for two planned products: **Zeer Prep**, the Zcash data preparation and delivery engine prioritized first, and **Zeer Chef**, the later application-indexing framework. Accepted names, responsibilities and planning precedence are recorded in [the canonical plan](.omc/plans/zeer-v0.1.md#0-accepted-product-names-and-planning-order).

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
- Product names accepted: Zeer Prep and Zeer Chef. Prep becomes the first data-engine priority; the earlier TypeScript/GraphQL framework proposal remains the later Chef phase. Both are unimplemented.
- Benchmarking against other indexers explicitly requested.
- Repository direction accepted on 2026-10-13: one core monorepo under the user's personal GitHub account, rather than separate repositories for the engine, SDK and CLI.
- Implementation priority clarified: engine, correctness/recovery tests and early benchmarks first; polished public SDK/CLI packaging follows.
- Workspace inspected on 2026-10-12: logo asset only before these planning documents; no application source or Git repository.
- Benchmark-first implementation authorized on 2026-10-13. The harness and a limited provider-serving comparison now exist; Zeer engine, developer SDK/CLI and package publication do not.
- lightwalletd and Zaino both passed five measured reads in each of two separately reported resource profiles. This proves the declared synthetic compact header/projection case, not nonempty shielded scanning or application indexing.
- The public-mainnet follow-up includes Zinder and CipherScan as well: all four passed five runs of 128 transaction lookups. Workload/transport differences and the historical-source health policy are documented; this does not complete the broader scanning/ingestion benchmark requirements.

## Next implementation step

Continue benchmark-first work by defining an equivalent-output bulk historical retrieval workload, including modern shielded data. Separate fetch/transfer, decoding, scanning and persistence costs before selecting Prep's architecture. Prep's detailed design and acceptance gates remain pending; the existing framework G0/G1 gates belong to the Chef proposal. The small provider-serving baseline does not complete the broader benchmark specification. Full chain-to-GraphQL comparisons belong to the later Chef phase.

The plan does not authorize purchasing infrastructure, publishing packages, submitting the hackathon entry, or accessing third-party private wallet data. It records work to perform when implementation is requested.
