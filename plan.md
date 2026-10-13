# Zeer planning entry point

Updated: 2026-10-13 (Asia/Jakarta).

**Status: Prep implementation authorized on 2026-10-13; first bounded historical-snapshot slice implemented. Chef remains a later proposal.**

Zeer is the umbrella brand and monorepo for two planned products: **Zeer Prep**, the Zcash data preparation and delivery engine prioritized first, and **Zeer Chef**, the later application-indexing framework. Accepted names, responsibilities and planning precedence are recorded in [the canonical plan](.omc/plans/zeer-v0.1.md#0-accepted-product-names-and-planning-order).

## Authoritative documents

- [Implementation plan and architecture](.omc/plans/zeer-v0.1.md): accepted product decisions, proposed technical contracts, scope, risks, gates, and acceptance criteria.
- [Prep engine contract](docs/PREP_ENGINE.md): implemented first slice, limits, commands and next engine gates; [execution evidence](benchmarks/results/reports/2026-10-13-prep.md).
- [Benchmark specification](docs/BENCHMARK_SPEC.md): comparison eligibility, scenarios, metrics, fixtures, and publication rules.
- [Envio / HyperIndex package research](docs/ENVIO_HYPERINDEX_RESEARCH.md): pinned npm/source findings and the ReScript/Rust boundary; recommendations do not override the implementation plan.
- [Benchmark harness](benchmarks/README.md) and [first measured results](benchmarks/results/reports/2026-10-13.md): two external providers tested on a frozen synthetic regtest fixture before engine implementation.
- [Four-candidate measured follow-up](benchmarks/results/reports/2026-10-13-four.md): all four completed the same historical transaction-lookup projection under a disclosed expanded resource profile.
- [Selected logo concept](assets/brand/zeer-logo-concept-v2.png): approved raster concept sheet, not an SVG asset pack.

Technical contracts live in the implementation plan. Benchmark methodology lives in the benchmark specification; do not maintain competing copies.

## Present evidence

- Name and revised logo concept selected in conversation.
- Product names accepted: Zeer Prep and Zeer Chef. Prep is the first data-engine priority; the earlier TypeScript/GraphQL framework proposal remains the later Chef phase.
- Benchmarking against other indexers explicitly requested.
- Repository direction accepted on 2026-10-13: one core monorepo under the user's personal GitHub account, rather than separate repositories for the engine, SDK and CLI.
- Implementation priority clarified: engine, correctness/recovery tests and early benchmarks first; polished public SDK/CLI packaging follows.
- Workspace inspected on 2026-10-12: logo asset only before these planning documents; no application source or Git repository.
- Benchmark-first work and later Prep engine implementation were authorized on 2026-10-13. A Rust historical-snapshot engine and internal CLI now exist; no developer npm SDK, Chef framework or package publication exists.
- The first Prep slice passed 24 Linux Rust tests and round-tripped 256 real mainnet compact blocks, including 417 Sapling outputs and 81 Orchard actions, against a separately captured provider reference. This does not prove shielded decryption, consensus or performance superiority.
- lightwalletd and Zaino both passed five measured reads in each of two separately reported resource profiles. This proves the declared synthetic compact header/projection case, not nonempty shielded scanning or application indexing.
- The public-mainnet follow-up includes Zinder and CipherScan as well: all four passed five runs of 128 transaction lookups. Workload/transport differences and the historical-source health policy are documented; this does not complete the broader scanning/ingestion benchmark requirements.

## Next implementation step

Extend the first Prep slice with an equivalent-output bulk historical retrieval comparison, including modern shielded data. Separate fetch/transfer, decoding, scanning and persistence costs before optimizing storage or transport. Follow Prep's next gates in its engine contract; the existing framework G0/G1 gates belong to Chef. Live following and reorg-aware publication remain outstanding. The small provider-serving baseline and snapshot smoke do not complete the broader benchmark specification.

The plan does not authorize purchasing infrastructure, publishing packages, submitting the hackathon entry, or accessing third-party private wallet data. It records work to perform when implementation is requested.
