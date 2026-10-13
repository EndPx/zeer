# Zeer planning entry point

Updated: 2026-10-13 (Asia/Jakarta).

**Status: Prep full-data prototype implemented and tested on 2026-10-13. Target 28 October scope and evidence are recorded in the delivery contract. Chef remains deferred.**

Zeer is the umbrella brand and monorepo for two planned products: **Zeer Prep**, the Zcash data preparation and delivery engine prioritized first, and **Zeer Chef**, the later application-indexing framework. Accepted names, responsibilities and planning precedence are recorded in [the canonical plan](.omc/plans/zeer-v0.1.md#0-accepted-product-names-and-planning-order).

## Authoritative documents

- [Implementation plan and architecture](.omc/plans/zeer-v0.1.md): accepted product decisions, proposed technical contracts, scope, risks, gates, and acceptance criteria.
- [Prep engine contract](docs/PREP_ENGINE.md): implemented first slice, limits, commands and next engine gates; [execution evidence](benchmarks/results/reports/2026-10-13-prep.md).
- [Active 28 October delivery contract](docs/PREP_DELIVERY.md): full blocks/transactions required by the user, completed capabilities and exclusions; [full-data execution report](benchmarks/results/reports/2026-10-13-prep-full.md).
- [Prep HTTP query and client contract](docs/PREP_QUERY.md): supported fields, filters, cursor semantics and numeric precision.
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
- Benchmark-first work and later Prep engine implementation were authorized on 2026-10-13. The user subsequently required complete blocks/transactions, following, queries and a client. A typed client package exists locally; no registry publication or Chef framework exists.
- The first Prep slice passed 24 Linux Rust tests and round-tripped 256 real mainnet compact blocks, including 417 Sapling outputs and 81 Orchard actions, against a separately captured provider reference. This does not prove shielded decryption, consensus or performance superiority.
- lightwalletd and Zaino both passed five measured reads in each of two separately reported resource profiles. This proves the declared synthetic compact header/projection case, not nonempty shielded scanning or application indexing.
- The public-mainnet follow-up includes Zinder and CipherScan as well: all four passed five runs of 128 transaction lookups. Workload/transport differences and the historical-source health policy are documented; this does not complete the broader scanning/ingestion benchmark requirements.
- The full-data Prep prototype passed 64 Rust tests and 13 SDK tests, verified 1,024 complete mainnet blocks / 13,817 transactions, resumed multi-segment ingestion, and followed two newly mined blocks on an isolated real Regtest node. Reorg recovery is fault-fixture evidence; modern mainnet production behavior and million-block scale remain unproven.

## Next implementation step

Freeze the demonstrated Prep contract for the 28 October delivery. Use the runnable client and reproduction instructions for the demo; prioritize fixes, documentation and larger representative measurements rather than adding new product families. A full public-mainnet deployment, broader performance claims and production readiness require additional evidence. Chef's earlier G0/G1 gates are separate and remain deferred.

The plan does not authorize purchasing infrastructure, publishing packages, submitting the hackathon entry, or accessing third-party private wallet data. It records work to perform when implementation is requested.
