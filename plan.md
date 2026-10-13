# Zeer planning entry point

Updated: 2026-10-13 (Asia/Jakarta).

**Status: Prep full-data prototype and the first measured improvement batch completed on 2026-10-13. Target 28 October scope and evidence are recorded in the delivery contract. Chef remains deferred.**

Zeer is the umbrella brand and monorepo for two planned products: **Zeer Prep**, the Zcash data preparation and delivery engine prioritized first, and **Zeer Chef**, the later application-indexing framework. Accepted names, responsibilities and planning precedence are recorded in [the canonical plan](.omc/plans/zeer-v0.1.md#0-accepted-product-names-and-planning-order).

## Authoritative documents

- [Implementation plan and architecture](.omc/plans/zeer-v0.1.md): accepted product decisions, proposed technical contracts, scope, risks, gates, and acceptance criteria.
- [Prep engine contract](docs/PREP_ENGINE.md): implemented first slice, limits, commands and next engine gates; [execution evidence](benchmarks/results/reports/2026-10-13-prep.md).
- [Active 28 October delivery contract](docs/PREP_DELIVERY.md): full blocks/transactions required by the user, completed capabilities and exclusions; [full-data execution report](benchmarks/results/reports/2026-10-13-prep-full.md).
- [Prep HTTP query and client contract](docs/PREP_QUERY.md): supported fields, filters, cursor semantics and numeric precision.
- [Prep improvement report](benchmarks/results/reports/2026-10-13-prep-improvements.md): sequential range reads, bounded projection sizing, overlapping source reads, 4,096-block verification and before/after measurements.
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
- The first improvement batch passed 73 Rust tests, 13 SDK tests and four benchmark-oracle tests. All 4,096 early-mainnet blocks / 50,283 transactions passed independent source comparison. Six before/after workloads preserve exact output; the largest observed median reduction was 13.38% for full projection. These are warm shared-host read observations, not a universal speedup.

## Next implementation step

The user authorized improving Prep on 2026-10-13. This iteration keeps the existing API and archive contract and targets measured read-path and ingestion improvements:

- [x] Reuse sequential segment readers for payload queries and remove response-sized temporary serialization buffers used only for length checks; preserve pagination, exact numbers and response limits.
- [x] Overlap the two independent raw/decoded RPC reads for each block, with bounded concurrency and unchanged source validation.
- [x] Compare the previous release binary and the improved binary on the same immutable archive, including full payload and filtered transaction workloads; preserve every run and check output equality outside timing.
- [x] Run the Linux test/lint/build gates, separate code review, and publish the measured evidence with limitations.

Next evidence priorities: representative modern Sapling/Orchard full-data fixtures, sustained live follow with source outages and bounded retry policy, and actual-node reorg recovery. Larger-scale claims follow those correctness gates. The current batch does not claim those gates are complete.

A full public-mainnet deployment, broader performance claims and production readiness require additional evidence. Chef remains deferred. This iteration does not publish npm packages or public endpoints.

The plan does not authorize purchasing infrastructure, publishing packages, submitting the hackathon entry, or accessing third-party private wallet data. It records work to perform when implementation is requested.
