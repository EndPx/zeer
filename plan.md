# Zeer planning entry point

Updated: 2026-10-14 (Asia/Jakarta).

**Status: Prep supports admitted transaction-ID indexes, direct metadata, bounded batch lookup and compiled capabilities. Chef implements a public-data writer and GraphQL API. Viewing-key scanning, whole-chain execution and public deployment remain deferred. All benchmark results and reports are local-only under `benchmarks/results/`; source, methodology and fixtures remain public.**

Zeer is the umbrella brand and monorepo for **Zeer Prep**, the Zcash data preparation and delivery engine, and **Zeer Chef**, the application-indexing framework. Both have bounded public-data implementations. Accepted names and original architecture decisions are recorded in [the framework proposal](.omc/plans/zeer-v0.1.md#0-accepted-product-names-and-planning-order).

## Active roadmap: public-data MVP to 28 October

This section is the single source of truth for upcoming work. It supersedes the
older scanner-first sequence and completed tasks below. The dates are internal
planning targets in Asia/Jakarta, not verified organizer submission cutoffs or
promises that unfinished gates will pass. This update plans the work; it does
not start implementation, deployments, new experiments or package publication.

**Release objective:** a developer can obtain Zeer from a clean checkout, run a
bounded public-data source through Prep and Chef, query their own PostgreSQL
projection through GraphQL, and understand and recover from supported failures.
Prep must also remain usable directly through its API/client without Chef.

### Scope and operating rules

- Retain complete raw blocks/transactions and supported public projections.
  Shielded ciphertext remains encrypted; no viewing keys or private memo scanning.
- Support Linux x86_64 and the documented WSL2 development route first. Do not
  imply native Windows support or add another platform during release hardening.
- Use developer-owned PostgreSQL and operator-managed source access. A verified
  isolated fixture workflow must not require our retained VPS state, personal
  credentials, ignored results or a hosted Zeer service.
- All benchmark results, logs, comparison tables and execution reports remain
  local under `benchmarks/results/`. Public code, methodology and input fixtures
  remain reproducible; no speed ranking or unverified latency slogan in release copy.
- Keep the existing experimental resource ceiling until explicitly changed.
  Inspect host health before a run, isolate experiment resources, retain failures,
  and stop only experiment services afterwards. Local-only results do not mean
  the user requested moving execution from the VPS to the laptop.
- Work in bounded increments: inspect the relevant contract, implement one slice,
  run applicable checks, review the diff, commit and push. Completion requires the
  acceptance evidence below; a checklist alone is not evidence.

### Delivery sequence

| ID | Target window | Work | Depends on | Completion gate |
| --- | --- | --- | --- | --- |
| M1 | 14–16 October | Reproducible developer quickstart | Existing public Prep/Chef contracts | Clean checkout reaches verified GraphQL output and resumes after restart without local-only artifacts |
| M2 | 17–20 October | Recovery across node, Prep, Chef and GraphQL | M1 | Real isolated Regtest branch change, source outage and restart preserve canonical application state |
| M3 | 21–22 October | Clear CLI status and failure guidance | M1; use M2 state transitions | Human-readable progress is accurate; automation retains structured output and nonzero failures |
| M4 | 23–24 October | Installable local release packages | M1–M3 | Packed packages work in a separate consumer project without monorepo resolution or registry publication |
| M5 | 25–26 October | Demo, documentation and release candidate | M2–M4 | Complete public-data demo and documented limits match the frozen candidate |
| M6 | 27–28 October | Final verification and delivery buffer | M5 | Fresh installation and critical recovery checks pass; outstanding limitations are explicit |

### M1 — Reproducible developer quickstart

- [ ] Provide one documented startup path covering the full-node source or clearly
  labelled fixture source, Prep ingestion/API, developer PostgreSQL and Chef.
  A compact-only source cannot satisfy full-data ingestion.
- [ ] Supply bounded isolated runtime configuration, environment examples and
  explicit migration/start/stop instructions. Reuse existing fixture tooling and
  CLI commands; do not create a new launcher framework just for this flow.
- [ ] Demonstrate direct Prep queries as well as the existing public Chef example:
  block/transaction handlers, generated types, committed entities and authenticated
  GraphQL. Verify expected identities and fields independently of displayed counts.
- [ ] Stop/restart the example and confirm checkpoint continuation without
  duplicate entity effects. Reject unavailable ranges and explain the required
  source/Prep coverage instead of silently returning incomplete output.
- [ ] Reproduce from a fresh checkout with no ignored results, existing database,
  workspace node_modules, machine-specific helper scripts or retained node state.

Acceptance record: exact setup commands, pinned input identity/range, generated
entity checks, GraphQL response checks and restart checkpoint. Retain the run
record locally; publish the setup instructions and reusable fixture inputs.
The first bounded task after this planning update is M1.

### M2 — Recovery across the full pipeline

Existing Prep real-node checks and Chef source-fixture/PostgreSQL tests do not
by themselves prove recovery of the connected pipeline. Exercise one isolated
real Regtest node feeding Prep, Chef, PostgreSQL and the GraphQL reader together.

- [ ] Backfill to a known head, follow new blocks, and independently compare
  application entities/checkpoint to the canonical source.
- [ ] Interrupt the source and then Prep separately. Verify the configured
  detection/polling behavior, unavailable-state handling and recovery; do not
  promise instantaneous outage detection or uninterrupted reads.
- [ ] Interrupt/restart Chef at controlled ingestion boundaries. Confirm atomic
  entity/checkpoint commits and correct continuation after an ambiguous interruption.
- [ ] Replace a branch within the supported recovery window using isolated
  Regtest controls. Verify Prep epoch/cursor behavior, Chef undo/replay, removal
  of orphaned effects and GraphQL results from the replacement branch.
- [ ] Exercise a branch change beyond the safe window. Confirm explicit blocking
  and a documented operator recovery path, with no destructive automatic reset.
- [ ] Check query availability during reconciliation and ensure a single response
  does not combine incompatible application states. Retain failed attempts and
  classify controlled reorg evidence separately from natural P2P behavior.

Acceptance record: source hashes, epochs, checkpoints, independent canonical
entity comparison and expected failure/recovery transitions. If a correctness
gate fails, fix that failure before CLI polish or release packaging.

### M3 — Developer-facing CLI status

- [ ] Expose source/Prep availability, Prep indexed height, Chef checkpoint and
  observed lag, plus backfill/follow/reconciliation/blocked states where known.
  Do not invent a source tip when the upstream source is unavailable.
- [ ] Add a readable terminal presentation while preserving machine-readable
  output for scripts and non-interactive runs. No graphical dashboard is required.
- [ ] Distinguish invocation progress from persisted checkpoint and source sync.
  Show ETA only when a finite target and defensible sample exist; omit it at the
  live head or when progress is unstable.
- [ ] Provide actionable errors for missing configuration, auth failures,
  unsupported source ranges, identity mismatch and blocked recovery. Keep secrets
  out of output, and preserve cancellation and exit-code behavior.

Acceptance record: terminal and structured-output checks for healthy backfill,
live follow, source loss, configuration failure and recovery states.

### M4 — Package and distribution readiness

- [ ] Inspect packed contents, entrypoints, CLI executable metadata, declarations,
  dependency resolution, licenses and exclusion of private/local artifacts.
- [ ] Install Prep client and Chef tarballs into a separate empty consumer project.
  Resolve their relationship locally without a workspace symlink or a previously
  published `@zeer/*` package. Run type checking and the example through the CLI.
- [ ] Make the Rust Prep build/install path explicit for the supported platform;
  test the documented path. A working npm client is not distribution of the server.
- [ ] Record candidate versions and a short compatibility/change note. Do not
  choose or claim an available npm organization, publish packages, or enable
  hosted services as an incidental packaging step.

Acceptance record: clean consumer installation, types and executable invocation,
direct Prep query, Chef ingestion and GraphQL result. Public npm publication is a
separate release decision after this gate, not required to prove the local MVP.

### M5 — Demo and release candidate

- [ ] Freeze a candidate commit after M2–M4. Reconcile README, product contracts,
  quickstart and supported capability statements against that commit.
- [ ] Prepare a standalone demo: public chain input → Prep query → TypeScript
  handler → PostgreSQL → GraphQL, followed by a short restart/follow demonstration.
  Show direct Prep usage too, so its independent product role is clear.
- [ ] Use a labelled fixed dataset for a repeatable demonstration; distinguish
  fixture replay, actual Regtest operation and public-network reads in the script.
- [ ] Prepare demo narration and an architecture explanation. Record only behavior
  actually exercised; do not imply a public endpoint, published package, private
  memo access or full-mainnet coverage. Benchmark outputs stay local.

Acceptance record: demo reproducible from the candidate and documentation with
matching commands, scope and limitations. Submission/upload and any public
deployment remain separate actions, not implied by preparing these materials.

### M6 — Final verification and buffer

- [ ] Repeat the clean installation and the critical connected recovery checks
  on the release candidate after any relevant final fix.
- [ ] Review tracked files and package contents for local results, credentials,
  accidental generated state and missing license attribution.
- [ ] Record passed gates and unresolved limits locally; verify the public docs
  contain no unsupported readiness or performance claims.
- [ ] Leave time for defects and submission preparation. Recheck the actual event
  cutoff/timezone and required deliverables before any submission action.

### If the schedule slips

Correctness, clean setup and accurate documentation take precedence. Cut terminal
decoration, optional ETA, additional templates and larger performance runs first.
Local tarball installation is sufficient for the packaging gate; npm publication
and public hosting are optional later decisions. Do not cut canonical-state
verification or convert a failed recovery check into a completed checkbox. Mark
an incomplete release as a bounded prototype and state the remaining gap.

### After the public-data MVP

These are ordered follow-up investigations, not commitments for 28 October:

1. **Larger Prep datasets and storage scaling.** Establish source coverage, disk
   and memory budgets; measure admission/startup, archive growth, full/sparse
   retrieval and follow lag separately. Use measured bottlenecks to decide whether
   persistent indexes, a different layout or more parallel ingestion are needed.
   A height-0-to-pinned-tip run requires explicit genesis support and a complete
   compatible source. Do not estimate an unrun whole-chain duration.
2. **Chef query improvements.** Select real application queries, inspect database
   plans and bounded request behavior, then improve the read path if justified.
   Preserve authorization, exact values, pagination and snapshot consistency.
   Keep application ingestion and prepared lookup comparisons separate.
3. **Schema/handler evolution.** Design safe versioning, rebuild/replay and cutover
   for existing projects. Prove compatibility and rollback before replacing the
   current explicit new-namespace workflow.
4. **Authorized private scanning.** Specify local key custody, birthday/range,
   Orchard and Sapling coverage, memo decoding, nullifiers and reorg behavior as
   a separate security-sensitive project. Public Prep never decrypts arbitrary
   shielded payments. Compare results against independent wallet fixtures.
5. **Distribution and operations.** Decide package publication and hosting only
   after installation gates and actual developer feedback. Public service work
   adds access controls, abuse limits, monitoring, backup/restore and capacity
   evidence. Neon compatibility requires its own transaction/locking verification.

Pick one follow-up at a time based on demonstrated need. This backlog does not
reopen private scanning, managed cloud, GraphQL subscriptions/joins, another
product, a new chain, or organization/multi-repo work during the public MVP.

## Authoritative documents

- [ShieldedLabs CipherScan pinned review](docs/SL_CIPHERSCAN_RESEARCH.md): architecture coverage, source-only findings, license declarations and independently adapted public-data concepts.
- [Active Chef public-data contract](docs/CHEF_PUBLIC_MVP.md): public Prep source, TypeScript handlers, developer PostgreSQL, GraphQL, recovery and separate indexing/retrieval benchmarks.
- [Implementation plan and architecture](.omc/plans/zeer-v0.1.md): accepted product decisions, proposed technical contracts, scope, risks, gates, and acceptance criteria.
- [Prep engine contract](docs/PREP_ENGINE.md): implemented first slice, limits, commands and next engine gates.
- [Active 28 October delivery contract](docs/PREP_DELIVERY.md): full blocks/transactions required by the user, completed capabilities and exclusions.
- [Prep HTTP query and client contract](docs/PREP_QUERY.md): supported fields, filters, cursor semantics and numeric precision.
- [Benchmark specification](docs/BENCHMARK_SPEC.md): comparison eligibility, scenarios, metrics, fixtures, and publication rules.
- [Envio / HyperIndex package research](docs/ENVIO_HYPERINDEX_RESEARCH.md): pinned npm/source findings and the ReScript/Rust boundary; recommendations do not override the implementation plan.
- [Benchmark harness](benchmarks/README.md): reproduction instructions and local output policy.
- [Selected logo concept](assets/brand/zeer-logo-concept-v2.png): approved raster concept sheet, not an SVG asset pack.

The active roadmap above owns upcoming order and release gates. Implemented behavior lives in the Prep/Chef contracts; the older framework proposal is reference for deferred design. Benchmark methodology lives in the benchmark specification. Do not maintain competing copies of these responsibilities.

Positioning check (14 October 2026): [Bitquery documents a Zcash GraphQL API in its V1 catalog](https://docs.bitquery.io/v1/docs/Examples/Zcash/address-api). Do not claim that Chef is Zcash's first or only GraphQL offering. Chef's implemented focus is self-hosted application indexing with developer-defined TypeScript handlers, scalar entity schemas, operator-owned PostgreSQL and generated GraphQL. Bitquery endpoint availability/performance has not been authenticated or benchmarked in this project.

## Present evidence

- Name and revised logo concept selected in conversation.
- Product names accepted: Zeer Prep and Zeer Chef. Prep is the first data-engine priority; the earlier TypeScript/GraphQL framework proposal remains the later Chef phase.
- Benchmarking against other indexers explicitly requested.
- Repository direction accepted on 2026-10-13: one core monorepo under the user's personal GitHub account, rather than separate repositories for the engine, SDK and CLI.
- Implementation priority clarified: engine, correctness/recovery tests and early benchmarks first; polished public SDK/CLI packaging follows.
- Workspace inspected on 2026-10-12: logo asset only before these planning documents; no application source or Git repository.
- Benchmark-first work and later Prep engine implementation were authorized on 2026-10-13. The user subsequently required complete blocks/transactions, following, queries and a client. A typed Prep client and the first public Chef framework now exist locally; neither package is published to a registry.
- Historical validation records, benchmark outcomes and comparisons are retained in the local results directory. Public documents describe contracts, implementation scope and reproduction steps.

## Completed implementation history

The user authorized improving Prep on 2026-10-13. This iteration keeps the existing API and archive contract and targets measured read-path and ingestion improvements:

- [x] Reuse sequential segment readers for payload queries and remove response-sized temporary serialization buffers used only for length checks; preserve pagination, exact numbers and response limits.
- [x] Overlap the two independent raw/decoded RPC reads for each block, with bounded concurrency and unchanged source validation.
- [x] Compare the previous release binary and the improved binary on the same immutable archive, including full payload and filtered transaction workloads; preserve every run and check output equality outside timing.
- [x] Run the Linux test/lint/build gates, separate code review, and retain measured evidence and limitations locally.

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
