# Zeer planning entry point

Updated: 2026-10-24 (Asia/Jakarta).

## Current verified release

Chef and launcher **0.6.1** and Prep client **0.1.0** are published. The
[release record](docs/PACKAGING.md), [developer acceptance](docs/DEVELOPER_ACCEPTANCE_20261024.md)
and [application study](docs/PREP_APPLICATION_STUDY_20261024.md) describe current
delivery and its limits. The public testnet Prep archive follows from genesis;
the Chef block-summary demo follows in its own namespace, while a separate demo
projection exposes one deliberately published memo receipt. Query `/api/status`
and Prep `/height` for current observed coverage rather than a historical height
in this plan. Public Prep accepts no viewing keys.

Curated benchmark summaries and reports are public; raw logs, private operational
records and key material stay local. Buffered range reads remain opt-in after
the recorded experiments. The authorized aggregate resource envelope is
**3 CPU / 8 GiB / 60 GiB**. Organizer form/deadline verification and submission
are separate from technical readiness. Dated milestones below preserve their
original scope and evidence, including sections originally titled "current".

## Completed feature delivery: generated-project deployment and recovery

The user approved a background deployment recipe, backup/restore proof and a
walkthrough from real execution. The [delivery contract](docs/CHEF_DEPLOYMENT_PLAN.md)
defines the matching Chef/launcher 0.5.0 release. Existing hosted namespaces,
ZeeSwap settlement and a durable change feed are outside this milestone.

- [x] Generate a pinned application image and separate follower/API Compose
  services with persistent PostgreSQL, explicit migration and read-only checks.
- [x] Keep viewing keys outside image layers and available only to the shielded
  follower through an owner-protected read-only mount.
- [x] Verify stop/restart and namespace backup/restore into a new database,
  compare checkpoint/entities, then prove indexing can continue.
- [x] Capture a real terminal walkthrough; update existing self-hosting and
  quickstart chapters without adding a navigation product.
- [x] Complete independent review, publish matching package versions, verify
  registry installation and activate the corresponding docs.

Close this reviewed delivery with one grouped commit/push.

Chef/launcher 0.5.0 are published and anonymous registry bytes match the tested
candidates. All 178 Linux SDK tests passed; fresh registry installs verified
three starters and the launcher. Real candidate containers passed public indexing,
follower-only shielded keys, decoded image scanning and fresh-database recovery.
The additional registry-locator Docker rebuild was not run after the monitor
incident; the package and container evidence retain that transport distinction.

The temporary monitor undercounted image storage and later halted the pipeline
during a stale-inventory cleanup race. These were operational failures. Its
resources/hooks were retired and the original guard restored. Node/Prep/Chef/web
and the published memo were verified healthy at 11:30 UTC; the legacy memo
reader database host was repaired and follower CPU restored to 50%. The 44-page
docs release is live and browser-verified. See docs/PACKAGING.md for this bounded
delivery record, including the expensive Prep cold start. No signer, payout or
hosted namespace upgrade was added.

## Completed delivery: Chef dev and doctor

The user approved a grouped Chef/launcher 0.4.0 release for the next onboarding
step. Scope and acceptance gates are recorded in
[Chef dev and doctor](docs/CHEF_DEV_DOCTOR_PLAN.md). This section tracks that
delivery; older dated milestones below retain their historical status.

- [x] Add read-only `doctor` diagnostics for the project, source, PostgreSQL,
  API token, port and optional local scanner/key identity. No schema creation,
  writer lock, key upload or read-gate mutation belongs to diagnostics.
- [x] Add `dev` with code generation, project-local typechecking, setup checks,
  API-first startup, follower supervision and bounded shutdown. Migration is
  explicit through `--migrate` and never resets incompatible data.
- [x] Verify cancellation, child failures, source interruption and compatible
  restarts on installed packages; preserve existing project fingerprints.
- [x] Publish matching Chef and launcher packages, verify standalone registry
  installation, then deploy the corresponding existing documentation pages.

Chef and launcher 0.4.0 are published, their registry bytes match the audited
tarballs, and fresh registry projects passed. The existing public docs were
activated and all 44 pages passed browser checks. The dedicated test database,
role and temporary credentials were removed. No hosted indexer namespace was
migrated, and no signer or settlement behavior was added.

Release acceptance passed: all 156 Linux SDK tests with PostgreSQL and the
published scanner; Windows 116 passed with 40 environment-specific skips;
three generated standalone starters recovered from source interruption and
restart; public testnet blocks 4,528,205–4,528,206 matched Prep. This is bounded
onboarding evidence, not a throughput or funded-payment benchmark.

**Scope: Prep supports public historical queries and live node observations. Chef implements public handlers and an opt-in local testnet receipt preview with a native watch-only scanner. Production readiness remains unproven. The hosted demo serves public block summaries and one selected published receipt; private scanning stays local. Curated benchmark results and scoped reports are public, with raw/private evidence retained locally.**

## Current slice: generic shielded receipts, 20 October

The user authorized the scanner-first progression after the public shielded query
slice, then explicitly authorized a new isolated Zeer test account. Scope remains
the Zeer framework; another agent owns any ZeeSwap-specific integration.

The [receipt contract](docs/SHIELDED_RECEIPTS.md) and
[shielded inbox example](examples/shielded-inbox/README.md) define the current
bounded full-transaction implementation. It reuses official trial decryption and
the existing PostgreSQL checkpoint/undo mechanism. Unlike the historical proposal
below, this profile maintains no separate SDK wallet database or witness trees.
Full wallet balances, spending, webhooks and the earlier lightwalletd/two-store
lifecycle are not implemented by this change. Public Prep never accepts UFVKs.

Verification distinguishes all-pool encrypted fixtures, real native/SQL/GraphQL
restart and simulated reorg tests, and a separately observed mined Ironwood
receipt. Detailed results and key-bearing material stay outside Git. This is not
a claim that all historical scanner-first release gates or all pools' live
receipts have passed.

Zeer is the umbrella brand and monorepo for **Zeer Prep**, the Zcash data preparation and delivery engine, and **Zeer Chef**, the application-indexing framework. Both have bounded public-data implementations. Accepted names and original architecture decisions are recorded in [the framework proposal](.omc/plans/zeer-v0.1.md#0-accepted-product-names-and-planning-order).

## Current slice: public shielded data, 20 October

The user chose public Sapling/Orchard queries before viewing-key scanning, then
added Ironwood, coinbase/block-reward inspection and current mempool observations.
The implementation and operator contract are in [Public shielded queries](docs/PUBLIC_SHIELDED.md).
No private key import, memo decryption, transaction broadcast or private receipt
indexing belongs to this slice. The supplied ZecBlock decrypt tool is a research
reference for a later phase.

The hosted frontend is on the VPS at https://zeer.endpx.cloud. Prep stores
testnet history from genesis. The original Chef demo covered only blocks
4,510,000–4,519,999; the later public block-summary namespace follows from genesis.
Read current coverage from the service. Older deployment and roadmap notes below
are historical decisions, not a statement that public hosting is still pending.
Live observations do not extend archive coverage or advance Chef checkpoints.

## Active roadmap: public-data MVP to 28 October

This section is the single source of truth for upcoming work. It supersedes the
older scanner-first sequence and completed tasks below. The dates are internal
planning targets in Asia/Jakarta, not verified organizer submission cutoffs or
promises that unfinished gates will pass. Implementation was subsequently
authorized on 14 October. M1–M6 technical delivery is complete on the tested
candidate `8023c329bbb0cc5b26f101e01b383bb0b9180cea`. Detailed execution evidence
remains local. Authenticated organizer cutoff/form verification remains a
separate submission gate. Package publication and public deployment had not been
run for that original candidate; subsequent releases are recorded above.

### Current priority after the technical candidate

**User correction, 18 October: the required Prep deliverable is real public
testnet data from block 0 through the latest eligible block, followed continuously.
The recent live window is integration evidence only, not completion of that
deliverable. Prioritize genesis support, capacity-qualified full historical
backfill and coverage verification ahead of more demo polish or optimization.**
The application playgrounds must display actual backend responses or errors;
recorded-response controls are removed from `/app/prep` and `/app/chef`.
Landing-page examples remain explicitly labeled examples.

**Network decision, 16 October: Zcash testnet only for the planned hosted Prep,
Chef application demo and landing-page playground. Do not start mainnet sync or
provision a mainnet service.** Existing mainnet fixtures and historical benchmark
evidence retain their original network labels; they are not relabeled as testnet.

Execution update, 18 October: Zebra 7.0.0-rc.0 completed initial testnet sync and
continues accepting gossiped blocks. The node retains its 2 CPU / 4 GiB limit and
internal cookie-authenticated RPC. The user approved a 35 GiB node / 60 GiB total
Zeer storage budget; the guard stops at 34 / 59 GiB, while retaining the 25 GiB
host-free-disk and 3 GiB available-memory floors. Aggregate VPS limits remain
3 CPU / 8 GiB. Existing Zeer experiments still count toward the total.

The hosted path is now **VPS Zebra → Prep → Chef → PostgreSQL**, with a
Vercel frontend at https://zeer-ten.vercel.app. Source/database ports remain
private. A dedicated, forced-command SSH account carries bounded API reads;
its key cannot open a shell or forward ports. Combined service/API limits remain
3 CPU / 8 GiB. The operator-only configuration and credentials stay local.

Full-data ingestion now starts at **block 0**. Genesis handling is implemented
and verified against real testnet raw blocks/transactions. The recent-height
window was only the initial integration test and is no longer the active target.
A historical prefix has been imported while lossless archive conversion and
resource validation are completed. **Full-history catch-up is still pending.**
Read current coverage/readiness from the API rather than relying on a fixed
height in this document.

Storage work adds bounded binary header metadata and opt-in compressed full
records. Duplicated canonical JSON hex data can reference raw block bytes;
restoration verifies original payload length and checksum. Offline conversion
keeps the source, supports interrupted-run resume and compares every decoded
record before operator cutover. Live API adoption requires the complete proof,
independent node checks and preserved recovery metadata.

Chef distinguishes a transient source outage from reorg replay durably. A
verified prefix can resume reads after temporary recovery; reorg/unknown replay
remains gated. Existing unclassified state is never forced open. The hosted
upgrade uses a separate project namespace and retains its predecessor.

The public Prep base is `/api/prep`, with SDK-compatible height, capability,
range-query and transaction-lookup routes. CORS is limited to these public-chain
read routes; console adapters retain origin checks. Preview quotas, payload
bounds and current limitations are documented in `docs/PUBLIC_API.md`.

Acceptance requires the entire testnet history through the configured
confirmation boundary, continued source following, matching Chef checkpoints,
public SDK/GraphQL reads, recovery checks and healthy shared-VPS budgets.
Deployment READY or a successful partial query is not that acceptance.
Evidence remains local under `.deploy-local/` and `benchmarks/results/`.

Capacity reference: Zebra's official requirements page describes about 10 GB of
cached testnet state (https://zebra.zfnd.org/user/requirements.html, checked
2026-10-16). This is an approximate node-only figure, not a whole-stack budget.
Measure node state, Prep raw/decoded archive and indexes, Chef/PostgreSQL and
temporary storage separately. Stay within the approved aggregate 3 CPU / 8 GiB /
60 GiB operational envelope, account for existing artifacts, and refresh host
headroom before sustained sync. Do not infer a paid upgrade or data cleanup from
the network change. Full testnet fit and public load capacity remain unverified.

Website implementation was authorized and the local landing/console is working.
Connected Prep defaults now come from actual ready testnet coverage; explicit
user-entered ranges remain intact. Offline recorded examples retain their
historical labels. The local console identifies its partial live window and
confirmation policy. No public-hosting claim follows from the local preview.

The private consumer restart procedure is recorded with the local evidence and
was exercised against the existing checkpoint without duplicate processing.
Next gates: finish verified storage conversion and cutover; resume the complete
genesis-to-tip backfill within measured capacity; verify hosted SDK/GraphQL reads
and follow/recovery behavior; then record full-history acceptance. Keep viewing-key
scanning, registry publication and broader production guarantees separate.

User direction on 16 October: prioritize developer usability and a concrete
application proof. Pause open-ended performance experiments; change engine code
only for a demonstrated integration blocker, correctness issue or measured
application requirement during this phase.

### Developer alpha and application proof

Reuse the existing CLI, typed client, package-installation checks and quickstart.
The next deliverable is one complete developer journey using the current release
candidate and one independent consumer application. Avoid rebuilding M1-M6.

- [x] DX1: refresh the installation path on the current candidate. Install
  versioned package artifacts in a separate clean consumer project, run its own
  schema/TypeScript handlers and developer-owned PostgreSQL, then reach a verified
  GraphQL response. Record prerequisites, commands, elapsed setup time and actual
  failure guidance. Registry names/publication remain unverified until checked.
  Verified on 16 October with installed local tarballs, a new `zeer-chef init`
  testnet project outside the monorepo, strict types, actual PostgreSQL and a real
  Prep archive replaying captured testnet blocks 1000–1002. GraphQL values matched
  the independently captured blocks; unauthenticated requests failed, restart
  resumed the remaining range, and repeated sync committed zero blocks. All 73
  Chef tests passed with PostgreSQL integrations and no skips. New package source
  is verified locally but not yet committed, pushed or published. See
  [standalone quickstart](docs/CHEF_QUICKSTART.md); detailed output stays local in
  `.deploy-local/chef-dx-20261016/evidence/`. This is historical onboarding proof,
  not live tip following, full-chain coverage or private scanning.
- [x] DX2: build a public-data **Zeer Developer Console**, replacing the Activity
  Explorer after the user's 17 October direction. Scope: Overview, Prep Playground
  and Chef Playground for one managed testnet demo. Use packaged interfaces and
  real source responses; show dataset coverage, source mode and checkpoint separately.
  Design: [console contract](docs/DEVELOPER_CONSOLE_DESIGN.md). Local Next.js
  landing, Overview and both playgrounds are implemented. Browser execution
  reaches actual Prep and PostgreSQL-backed Chef over historical testnet blocks
  1000–1002. Prep has Table/JSON views, empty/stale states and bounded response
  coverage; both playgrounds show actual request duration and copy controls.
  Responsive result states pass at 1440/768/390/320px with no document overflow
  or automated axe WCAG 2.1 AA findings. The preview is local, not a published
  full-chain API. Detailed checks remain in `.deploy-local/web-20261018/`. No login,
  billing, user deployment platform, private notes or viewing-key input in this slice.
- [ ] DX3: make the example reproducible from a clean checkout and prepare a
  short recorded walkthrough of installation, indexing, querying and restart.
  Prove the app consumes the packaged interfaces without internal monorepo imports
  or manually inserted demonstration rows. A recording is not complete until made.
- [ ] DX4: prepare a bounded developer preview and distribution handoff: documented
  API origin/token handling, coverage, quotas, health and support instructions.
  Validate before any public release. Deployment and publication are explicit
  delivery actions; this planning update creates neither a hosted API nor an npm
  release. Capture an external developer's actual setup feedback when available.

Acceptance is a usable application plus a repeatable consumer setup, not another
throughput claim. Public example source and product documentation may explain the
flow; benchmark measurements and raw reports remain local. Historical replay and
live-node operation must remain visibly distinguished. External adoption is only
claimed after an external developer has actually used the tooling.

The completed optimization/reliability investigations below remain as history.

User direction: profile Chef write SQL, implement one measured optimization, and
validate equivalent output, rollback/restart and GraphQL behavior before delivery.

- [x] W1: attribute actual `PostgresStore.apply` query counts and client-observed
  SQL durations in a measurement-only harness, separate from ordinary wall timing.
- [x] W2: evaluate combined metadata and conservative pruning candidates against
  performance and correctness acceptance gates. The original write SQL remains
  the delivered default; measurements and the acceptance decision stay local.
- [x] W2 recovery repair: preserve reconciling while a follower has not yet
  republished the retained ancestor window after rollback. Defer only when its
  observed upstream tip can supply that window; proven deep forks remain blocked.
- [x] W3: retain all alternating uninstrumented modern/legacy comparisons, then
  verify before/after concurrent ingestion and connected Regtest recovery. Accept
  only scoped measured gains; modern shared-host noise is not a universal speedup.

All related W1-W3 work is one delivery batch. Detailed profiles, failures and
benchmark results remain local; no public endpoint or package publication is added.

User direction: validate modern data and concurrent Prep/Chef ingestion before
another engine optimization or application demo.

- [x] N1: capture a bounded contiguous NU5-era dataset with source response hashes,
  exact decimal tokens, independently prepared application projections and clear
  historical replay versus live-node limitations. Enlarge only within measured
  provider, time, memory and disk bounds.
- [x] N2: run the current engine through growing-source replay, Prep follow,
  Chef handlers/PostgreSQL and concurrent authenticated queries. Verify exact
  results, checkpoints, restart/source-outage behavior and real read/write overlap.
- [x] N3: measure preparation, admission, query and Chef fetch/handler/database
  costs; record the next optimization decision from measured bottlenecks. Keep
  all results local and preserve the existing 3 CPU / 8 GiB / 40 GiB envelope.

This pass does not authorize public hosting, private scanning or speculative
engine changes. Historical replay is not evidence of a synchronized modern node.

N1-N3 are accepted through two bounded combined runs and an unloaded ingestion/
admission baseline. The next investigation is finer-grained Chef write-path SQL
profiling: current runtime attribution combines entity flushing, journal/checkpoint
work, pruning and commit overhead, so it does not identify a single expensive
statement. Preserve block atomicity and PostgreSQL durability. This modern sample
does not establish a new Prep bottleneck or whole-chain scale. Detailed results
and source provenance remain local under `benchmarks/results/`.

Delivery preference: collect related changes and their verification into one
reviewed batch, then commit and push once; do not push each small intermediate edit.

User direction following O1-O3: implement bounded request admission and a safe
disk-backed public metadata index before demo/public API work.

- [x] Q1: keep active work bounded, add a small FIFO queue with finite wait,
  explicit overload/retry guidance and disconnect/shutdown cleanup; verify fresh
  snapshots after waiting and compare repeated same-profile load before/after.
- [x] D1: build source-bound versioned metadata sidecars offline with explicit
  disk limits and atomic no-overwrite publication. Validate against actual source
  metadata during admission and authenticate each later read; missing/corrupt
  caches must preserve the ordinary payload path and integrity checks.
- [x] D2: demonstrate reduced retained row memory and efficient reads beyond the
  previous RAM-row boundary, with exact output, corruption/restart/append/reorg
  checks and explicit residual descriptor/IO/handle limits. Keep results local.

No public endpoint, package publication, private scanning or unrelated database
change is included. Reuse the bounded experiment envelope and verify each change
before retaining it. Admission queue limits do not certify public ingress safety.

Q1-D2 acceptance uses sequential repeated HTTP comparisons, source-verified disk
profiles on real legacy/NU5 data, and synthetic default-cap boundary fixtures.
RAM remains faster for indexed sparse queries when it fits; the disk path is an
explicit capacity tradeoff, not a universal performance replacement. Detailed
results, source identities and service cleanup evidence remain local in
`benchmarks/results/reports/2026-10-15-capacity.md`.

User direction on 15 October: execute the bounded optimization work below before
the application demo. This authorization ends at Prep startup/index-limit
profiling; it does not include public API hosting or private scanning.

- [x] O1: measure concurrent Prep and Chef reads at 1/2/4/8 clients, distinguish
  admitted throughput from capacity rejection, and verify snapshots during paced
  ingestion. Retain sample counts, latency distributions and resource evidence.
- [x] O2: profile Chef request phases, implement only an evidence-supported
  bounded optimization, and compare ordinary HTTP before/after without weakening
  authorization, fresh checkpoint/readiness checks or transactional snapshots.
- [x] O3: attribute Prep startup costs and exercise archive/segment index-budget
  boundaries. Preserve normal integrity checks, distinguish real archives from
  synthetic capacity fixtures, and record a persistence decision from evidence.

Keep resource-intensive experiments sequential inside the existing 3 CPU / 8 GiB
/ 40 GiB envelope, with results local and ordinary applications undisturbed.

O2 adds bounded per-server validated-document reuse; request data, variables and
checkpoints remain uncached. O1 retains existing admission limits and distinguishes
capacity/readiness rejection from verified responses. Actual paced Prep append and
Chef ingestion are checked against independent public data. See the
[load contract](benchmarks/load/README.md) and
[request profiler](benchmarks/chef/profile/README.md).

O3 adds opt-in diagnostics and synthetic default-cap proofs while preserving
ordinary budgets and integrity checks. D1-D2 implement an optional disk projection
with bounded in-memory block descriptors; the existing memory caps remain.
Identity binding, atomic publication, corruption fallback and snapshot isolation
are covered by targeted regressions. See the [disk index contract](docs/PREP_DISK_INDEX.md) and
[admission/cap methodology](benchmarks/prep/profile/README.md). Detailed results
and the final scoped acceptance record remain local; no public-service readiness
or whole-chain claim follows from this work.

User direction on 14 October: prioritize the three investigations below before
submission/distribution work. Independent investigations may proceed together;
resource-intensive runs remain sequential within the shared experiment budget.
Results and reports stay local.

The subsequent comparison request uses the current production implementation and
pinned external providers. Keep Prep retrieval, Chef/native prepared lookup, and
fresh native ingestion observations separate. Reproduction settings live in the
[benchmark preflight](docs/CHEF_BENCHMARK_PREFLIGHT.md); output equivalence, actual
aggregate resource limits, source identity and complete cleanup determine whether
a session is eligible. Different native entity workloads do not establish a pure
framework ranking. This request does not reopen engine optimization or publishing.

| ID | Work | Acceptance evidence |
| --- | --- | --- |
| S1 | Prep scaling | Real bounded dataset tiers, source identity/coverage, preparation versus serving costs, startup/CPU/memory/disk and equivalent query measurements; decision on persistent indexes justified by observations |
| S2 | Chef query performance | Concrete application queries, canonical expected results, actual PostgreSQL plans and bounded before/after GraphQL measurements; preserve auth, exact values, keyset pagination and snapshot/reorg gates |
| S3 | Schema/handler evolution design | Compatible/breaking-change policy, shadow rebuild/replay and verification gates, cutover/rollback failure model, and a real PostgreSQL rehearsal using separate namespaces |

- [x] S1: admit source and disk budgets, capture baseline tiers, measure and decide
  whether a persistent index or another targeted change is warranted.
- [x] S2: measure application query patterns and database plans, implement only
  justified changes, and verify correctness plus read/write/storage tradeoffs.
- [x] S3: document the proposed version-transition contract and prove the parts
  supported today; identify automatic routing/cutover work still unimplemented.

The [schema/handler evolution design](docs/SCHEMA_EVOLUTION.md) and
[PostgreSQL rehearsal](benchmarks/chef/evolution/README.md) cover shadow replay,
exact replacement validation, pin invalidation and stale rollback targets using
the existing separate-namespace workflow. Routing automation remains proposed.

S1 retains the released in-memory derived-index policy and full admission checks.
The [scale and admission-cost harness](benchmarks/prep/scale/README.md) documents
how to reproduce the investigation; a measurement-only zero-index clone is not
a released engine variant. A persistent cache needs a separately verified format,
payload/catalog binding and corruption/reorg recovery contract before adoption.

S2 implements explicit scalar `@index` declarations through namespace migration;
see [query indexes](docs/CHEF_QUERY_INDEXES.md). No default field indexes or query
semantics changed. Query plans, read/storage/write tradeoffs and indexed recovery
were verified; detailed results remain local. Adding annotations changes model
identity and follows the separate-namespace evolution procedure above.

Larger early-chain datasets must not be presented as modern full-chain coverage.
No universal speed advantage, persistent-index benefit or atomic version cutover
is assumed before evidence. Private scanning was deferred at that stage; the 20 October local receipt profile is defined above. These older priorities
supersede the older one-follow-up-at-a-time note for investigation work.

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
| M1 — complete | 14 October | Reproducible developer quickstart | Existing public Prep/Chef contracts | Clean checkout reaches verified GraphQL output and resumes after restart without local-only artifacts |
| M2 — complete | 14 October | Recovery across node, Prep, Chef and GraphQL | M1 | Real isolated Regtest branch change, source outage and restart preserve canonical application state |
| M3 — complete | 14 October | Clear CLI status and failure guidance | M1; use M2 state transitions | Human-readable progress is accurate; automation retains structured output and nonzero failures |
| M4 — complete | 14 October | Installable local release packages | M1–M3 | Packed packages work in a separate consumer project without monorepo resolution or registry publication |
| M5 — complete | 14 October | Demo, documentation and release candidate | M2–M4 | Complete public-data demo and documented limits match the frozen candidate |
| M6 — technical checks complete | 14 October; remaining days reserved | Final verification and delivery buffer | M5 | Fresh installation and critical recovery checks pass; submission gates remain explicit |

### M1 — Reproducible developer quickstart

- [x] Provide one documented startup path covering the full-node source or clearly
  labelled fixture source, Prep ingestion/API, developer PostgreSQL and Chef.
  A compact-only source cannot satisfy full-data ingestion.
- [x] Supply bounded isolated runtime configuration, environment examples and
  explicit migration/start/stop instructions. Reuse existing fixture tooling and
  CLI commands; do not create a new launcher framework just for this flow.
- [x] Demonstrate direct Prep queries as well as the existing public Chef example:
  block/transaction handlers, generated types, committed entities and authenticated
  GraphQL. Verify expected identities and fields independently of displayed counts.
- [x] Stop/restart the example and confirm checkpoint continuation without
  duplicate entity effects. Reject unavailable ranges and explain the required
  source/Prep coverage instead of silently returning incomplete output.
- [x] Reproduce from a fresh checkout with no ignored results, existing database,
  workspace node_modules, machine-specific helper scripts or retained node state.

Acceptance record: exact setup commands, pinned input identity/range, generated
entity checks, GraphQL response checks and restart checkpoint. Retain the run
record locally; publish the setup instructions and reusable fixture inputs.
M1 completed on 14 October with a clean-source Docker run, host-loopback queries,
restart/resume and exact fixture comparison. See the
[quickstart](examples/quickstart/README.md). Execution records remain local under
`benchmarks/results/`; the next bounded task is M2.

### M2 — Recovery across the full pipeline

Existing Prep real-node checks and Chef source-fixture/PostgreSQL tests do not
by themselves prove recovery of the connected pipeline. Exercise one isolated
real Regtest node feeding Prep, Chef, PostgreSQL and the GraphQL reader together.

- [x] Backfill to a known head, follow new blocks, and independently compare
  application entities/checkpoint to the canonical source.
- [x] Interrupt the source and then Prep separately. Verify the configured
  detection/polling behavior, unavailable-state handling and recovery; do not
  promise instantaneous outage detection or uninterrupted reads.
- [x] Interrupt/restart Chef at controlled ingestion boundaries. Confirm atomic
  entity/checkpoint commits and correct continuation after an ambiguous interruption.
- [x] Replace a branch within the supported recovery window using isolated
  Regtest controls. Verify Prep epoch/cursor behavior, Chef undo/replay, removal
  of orphaned effects and GraphQL results from the replacement branch.
- [x] Exercise a branch change beyond the safe window. Confirm explicit blocking
  and a documented operator recovery path, with no destructive automatic reset.
- [x] Check query availability during reconciliation and ensure a single response
  does not combine incompatible application states. Retain failed attempts and
  classify controlled reorg evidence separately from natural P2P behavior.

Acceptance record: source hashes, epochs, checkpoints, independent canonical
entity comparison and expected failure/recovery transitions. If a correctness
gate fails, fix that failure before CLI polish or release packaging.

Completed with the connected real-node harness in `benchmarks/chef/recovery.py`.
See the [operator guide](docs/OPERATIONS.md) for the verified recovery model and
its boundaries. Detailed comparisons, failures and review evidence remain local.
M6 must repeat the critical checks on the frozen candidate.

### M3 — Developer-facing CLI status

- [x] Expose source/Prep availability, Prep indexed height, Chef checkpoint and
  observed lag, plus backfill/follow/reconciliation/blocked states where known.
  Do not invent a source tip when the upstream source is unavailable.
- [x] Add a readable terminal presentation while preserving machine-readable
  output for scripts and non-interactive runs. No graphical dashboard is required.
- [x] Distinguish invocation progress from persisted checkpoint and source sync.
  Show ETA only when a finite target and defensible sample exist; omit it at the
  live head or when progress is unstable.
- [x] Provide actionable errors for missing configuration, auth failures,
  unsupported source ranges, identity mismatch and blocked recovery. Keep secrets
  out of output, and preserve cancellation and exit-code behavior.

Acceptance record: terminal and structured-output checks for healthy backfill,
live follow, source loss, configuration failure and recovery states.

### M4 — Package and distribution readiness

- [x] Inspect packed contents, entrypoints, CLI executable metadata, declarations,
  dependency resolution, licenses and exclusion of private/local artifacts.
- [x] Install Prep client and Chef tarballs into a separate empty consumer project.
  Resolve their relationship locally without a workspace symlink or a previously
  published `@zeer/*` package. Run type checking and the example through the CLI.
- [x] Make the Rust Prep build/install path explicit for the supported platform;
  test the documented path. A working npm client is not distribution of the server.
- [x] Record candidate versions and a short compatibility/change note. Do not
  choose or claim an available npm organization, publish packages, or enable
  hosted services as an incidental packaging step.

Acceptance record: clean consumer installation, types and executable invocation,
direct Prep query, Chef ingestion and GraphQL result. Public npm publication is a
separate release decision after this gate, not required to prove the local MVP.

The [package guide](docs/PACKAGING.md) and standalone consumer verifier record the
reproduction path. The installed executable regression is covered alongside
strict declaration checks and actual fixture-to-GraphQL validation. Results,
tarballs, failed attempts and build/install logs remain local.

### M5 — Demo and release candidate

- [x] Freeze a candidate commit after M2–M4. Reconcile README, product contracts,
  quickstart and supported capability statements against that commit.
- [x] Prepare a standalone demo: public chain input → Prep query → TypeScript
  handler → PostgreSQL → GraphQL, followed by a short restart/follow demonstration.
  Show direct Prep usage too, so its independent product role is clear.
- [x] Use a labelled fixed dataset for a repeatable demonstration; distinguish
  fixture replay, actual Regtest operation and public-network reads in the script.
- [x] Prepare demo narration and an architecture explanation. Record only behavior
  actually exercised; do not imply a public endpoint, published package, private
  memo access or full-mainnet coverage. Benchmark outputs stay local.

Acceptance record: demo reproducible from the candidate and documentation with
matching commands, scope and limitations. Submission/upload and any public
deployment remain separate actions, not implied by preparing these materials.

The [demo script and narration](docs/DEMO.md) distinguish the captured mainnet
fixture from real Regtest recovery. A prepared script is not a recorded or
uploaded video. M6 replays the candidate before delivery.

### M6 — Final verification and buffer

- [x] Repeat the clean installation and the critical connected recovery checks
  on the release candidate after any relevant final fix.
- [x] Review tracked files and package contents for local results, credentials,
  accidental generated state and missing license attribution.
- [x] Record passed gates and unresolved limits locally; verify the public docs
  contain no unsupported readiness or performance claims.
- [x] Complete the technical candidate early and retain the remaining calendar
  buffer for defects and submission preparation. Check publicly accessible event
  information and record what still requires organizer-account access.

M6 used a fresh GitHub clone of the pinned candidate, empty dependency/build
volumes, the documented quickstart, an independent installed-package consumer,
and a new real Regtest recovery run. Host-loopback demo queries and readable/JSON
status were checked. The candidate's tracked Git blobs match the executed source
hash manifest. Experiment services were stopped; existing application services
remained active. Windows/WSL execution, natural P2P reorgs, whole-chain performance
and production readiness are not established by this Linux acceptance.

### Submission gate — separate from the technical candidate

- [ ] Before any submission action, confirm the authenticated organizer cutoff,
  timezone, eligibility and required form fields/deliverables. The public
  [Zecathon page](https://thezecathon.com/) directs users to sign in for those
  details; this run did not verify them. The internal 28 October target does not
  establish compliance with the actual submission deadline.
- A demo script is prepared; no video was recorded or uploaded in this delivery.
- No npm publication, public hosting or hackathon submission was performed.

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

A full public-mainnet deployment, broader performance claims and production readiness require additional evidence. Chef's public-only slice was implemented under its separate contract; the later local receipt profile is defined at the top of this plan. No npm package or public endpoint was published.

The plan does not authorize purchasing infrastructure, publishing packages, submitting the hackathon entry, or accessing third-party private wallet data. It records work to perform when implementation is requested.
