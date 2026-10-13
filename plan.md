# Zeer planning entry point

Updated: 2026-10-14 (Asia/Jakarta).

**Status: Prep held at its tested MVP. Chef's public writer now has bounded per-block caching and batched SQL, verified by 38 tests with real PostgreSQL and five alternating fresh runs per build. Median durable indexing fell from 40.311 s to 13.295 s on the same bounded workload. Private viewing-key scanning, whole-chain execution and public deployment remain deferred. Scope: [CHEF_PUBLIC_MVP.md](docs/CHEF_PUBLIC_MVP.md); latest writer evidence: [optimization report](benchmarks/results/reports/2026-10-14-chef-optimized.md).**

Zeer is the umbrella brand and monorepo for two planned products: **Zeer Prep**, the Zcash data preparation and delivery engine prioritized first, and **Zeer Chef**, the later application-indexing framework. Accepted names, responsibilities and planning precedence are recorded in [the canonical plan](.omc/plans/zeer-v0.1.md#0-accepted-product-names-and-planning-order).

## Authoritative documents

- [Prep native retrieval comparison](benchmarks/results/reports/2026-10-14-prep-retrieval.md): full-range header/metadata and sparse-ID measurements; Prep beats the tested RPC path on full-range reads but needs further sparse-lookup work. Engine unchanged in this comparison.
- [Chef writer optimization](benchmarks/results/reports/2026-10-14-chef-optimized.md): bounded ordered cache, coalesced SQL, unchanged atomic block/checkpoint guarantees, actual database regression tests and alternating before/after indexing.
- [Five-candidate lookup session](benchmarks/results/reports/2026-10-14-lookup-session.md): 25 verified visits with rotated order and equal aggregate resource ceilings. This is prepared serving, separate from fresh ingestion.
- [Active Chef public-data contract](docs/CHEF_PUBLIC_MVP.md): public Prep source, TypeScript handlers, developer PostgreSQL, GraphQL, recovery and separate indexing/retrieval benchmarks.
- [Chef indexing benchmark and validation](benchmarks/results/reports/2026-10-14-chef.md): identical handlers/schema over Prep and direct RPC, independent all-row verification, native CipherScan ingestion with different explorer outputs, and supplementary external-provider lookup.
- [Implementation plan and architecture](.omc/plans/zeer-v0.1.md): accepted product decisions, proposed technical contracts, scope, risks, gates, and acceptance criteria.
- [Prep engine contract](docs/PREP_ENGINE.md): implemented first slice, limits, commands and next engine gates; [execution evidence](benchmarks/results/reports/2026-10-13-prep.md).
- [Active 28 October delivery contract](docs/PREP_DELIVERY.md): full blocks/transactions required by the user, completed capabilities and exclusions; [full-data execution report](benchmarks/results/reports/2026-10-13-prep-full.md).
- [Prep HTTP query and client contract](docs/PREP_QUERY.md): supported fields, filters, cursor semantics and numeric precision.
- [Prep improvement report](benchmarks/results/reports/2026-10-13-prep-improvements.md): sequential range reads, bounded projection sizing, overlapping source reads, 4,096-block verification and before/after measurements.
- [Modern-data, outage and reorg proof](benchmarks/results/reports/2026-10-13-prep-proof.md): genuine NU5 fixture replay, automatic recovery through two actual source outages, and real Zebra canonical branch replacement.
- [Benchmark specification](docs/BENCHMARK_SPEC.md): comparison eligibility, scenarios, metrics, fixtures, and publication rules.
- [Envio / HyperIndex package research](docs/ENVIO_HYPERINDEX_RESEARCH.md): pinned npm/source findings and the ReScript/Rust boundary; recommendations do not override the implementation plan.
- [Benchmark harness](benchmarks/README.md) and [first measured results](benchmarks/results/reports/2026-10-13.md): two external providers tested on a frozen synthetic regtest fixture before engine implementation.
- [Four-candidate measured follow-up](benchmarks/results/reports/2026-10-13-four.md): all four completed the same historical transaction-lookup projection under a disclosed expanded resource profile.
- [Selected logo concept](assets/brand/zeer-logo-concept-v2.png): approved raster concept sheet, not an SVG asset pack.

Technical contracts live in the implementation plan. Benchmark methodology lives in the benchmark specification; do not maintain competing copies.

Positioning check (14 October 2026): [Bitquery documents a Zcash GraphQL API in its V1 catalog](https://docs.bitquery.io/v1/docs/Examples/Zcash/address-api). Do not claim that Chef is Zcash's first or only GraphQL offering. Chef's implemented focus is self-hosted application indexing with developer-defined TypeScript handlers, scalar entity schemas, operator-owned PostgreSQL and generated GraphQL. Bitquery endpoint availability/performance has not been authenticated or benchmarked in this project.

## Present evidence

- Name and revised logo concept selected in conversation.
- Product names accepted: Zeer Prep and Zeer Chef. Prep is the first data-engine priority; the earlier TypeScript/GraphQL framework proposal remains the later Chef phase.
- Benchmarking against other indexers explicitly requested.
- Repository direction accepted on 2026-10-13: one core monorepo under the user's personal GitHub account, rather than separate repositories for the engine, SDK and CLI.
- Implementation priority clarified: engine, correctness/recovery tests and early benchmarks first; polished public SDK/CLI packaging follows.
- Workspace inspected on 2026-10-12: logo asset only before these planning documents; no application source or Git repository.
- Benchmark-first work and later Prep engine implementation were authorized on 2026-10-13. The user subsequently required complete blocks/transactions, following, queries and a client. A typed Prep client and the first public Chef framework now exist locally; neither package is published to a registry.
- The first Prep slice passed 24 Linux Rust tests and round-tripped 256 real mainnet compact blocks, including 417 Sapling outputs and 81 Orchard actions, against a separately captured provider reference. This does not prove shielded decryption, consensus or performance superiority.
- lightwalletd and Zaino both passed five measured reads in each of two separately reported resource profiles. This proves the declared synthetic compact header/projection case, not nonempty shielded scanning or application indexing.
- The public-mainnet follow-up includes Zinder and CipherScan as well: all four passed five runs of 128 transaction lookups. Workload/transport differences and the historical-source health policy are documented; this does not complete the broader scanning/ingestion benchmark requirements.
- The full-data Prep prototype passed 64 Rust tests and 13 SDK tests, verified 1,024 complete mainnet blocks / 13,817 transactions, resumed multi-segment ingestion, and followed two newly mined blocks on an isolated real Regtest node. Reorg recovery is fault-fixture evidence; modern mainnet production behavior and million-block scale remain unproven.
- The first improvement batch passed 73 Rust tests, 13 SDK tests and four benchmark-oracle tests. All 4,096 early-mainnet blocks / 50,283 transactions passed independent source comparison. Six before/after workloads preserve exact output; the largest observed median reduction was 13.38% for full projection. These are warm shared-host read observations, not a universal speedup.
- The proof follow-up passed 78 Rust tests and 13 Python fixture/guard tests. Three genuine NU5 blocks / 17 transactions passed full-data replay and pool filters. A real Zebra Regtest follower ran for 600.613 seconds, recovered from two source outages without restart, and followed 18 new blocks. A subsequent real-node two-block branch replacement advanced epoch 0 to 1 and rejected the old cursor. This does not establish long-term production operation or natural P2P reorg behavior.

## Next implementation step

The user authorized improving Prep on 2026-10-13. This iteration keeps the existing API and archive contract and targets measured read-path and ingestion improvements:

- [x] Reuse sequential segment readers for payload queries and remove response-sized temporary serialization buffers used only for length checks; preserve pagination, exact numbers and response limits.
- [x] Overlap the two independent raw/decoded RPC reads for each block, with bounded concurrency and unchanged source validation.
- [x] Compare the previous release binary and the improved binary on the same immutable archive, including full payload and filtered transaction workloads; preserve every run and check output equality outside timing.
- [x] Run the Linux test/lint/build gates, separate code review, and publish the measured evidence with limitations.

The first performance batch left modern Sapling/Orchard full-data fixtures,
follow/source-outage recovery and actual-node reorg evidence open. The bounded
proof follow-up below now closes its specified acceptance criteria.

### Proof follow-up authorized on 2026-10-13

The user asked to prove the three remaining gates before proceeding. This batch
has explicit, bounded acceptance criteria:

- [x] Capture complete genuine modern mainnet blocks with nonempty Sapling and
  Orchard activity; retain pinned provenance and verify raw/decoded query output
  and pool filters. If captured data is replayed through a fixture RPC, label it
  as replay, not a live modern full-node or consensus proof.
- [x] Reproduce the current exit-on-source-outage behavior, implement bounded
  retries for classified transient failures only, and run a 10-minute Regtest
  follow rehearsal with actual node outages/restarts, status checks, new blocks
  and exact output verification. A 10-minute rehearsal is not a production soak.
- [x] Trigger a canonical branch replacement using a real, isolated Zebra
  Regtest node, then verify Prep rollback, new epoch, old-cursor rejection and
  exact replacement-block output. Distinguish explicit invalidate/generate from
  a naturally occurring peer-to-peer reorg.
- [x] Review independently, run applicable checks, retain failures and successful
  evidence, stop experiments and confirm existing applications remain active.

Use disposable copies of the frozen Regtest state and the existing 3 CPU / 8 GiB
/ 40 GiB experiment envelope. No private viewing keys or public-chain writes are
needed for these proofs.

A full public-mainnet deployment, broader performance claims and production readiness require additional evidence. Chef's public-only slice is now implemented under its separate contract; private scanning remains deferred. No npm package or public endpoint was published.

The plan does not authorize purchasing infrastructure, publishing packages, submitting the hackathon entry, or accessing third-party private wallet data. It records work to perform when implementation is requested.
