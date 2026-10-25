# Operational visibility and recovery — 25 October 2026

This milestone addresses source startup, long-running work, diagnosis and a repeatable recovery path. **Chef/CLI 0.7.0 is an unpublished source-build candidate.** Published installation examples remain on 0.6.1; no hosted namespace or shared source service was upgraded as part of this work.

## What changed

| Component | Change | Boundary |
| --- | --- | --- |
| Prep follower | Authenticated, network-aware RPC preflight before archive admission; bounded initial transient retries | Existing archives are untouched on failed preflight; integrity validation remains enabled |
| Prep diagnostics | Startup/follow phases, cached five-second heartbeat, committed position and fixed error/retry fields | Best-effort bounded stderr queue; heartbeat does not establish readiness or a new commit |
| Chef sync/follow | Cached phase heartbeat through fetch, scan, handlers, transaction work, recovery and source waits | No extra Prep/database polling; committed height advances only after observation/acknowledgement and can decrease on rollback |
| Chef status/doctor | Build-produced identity, timestamped source/checkpoint metadata and fixed next-action categories | Read-only diagnosis; existing retry policies and read gates are preserved |
| Authenticated Chef API | Additive artifact identity in cached `GET /status` | No request-time RPC, Prep access or Git inference |
| Artifact identity | Prep `build-info` and `/capabilities.artifact`; Chef build identity embedded during build | Missing/unverifiable provenance is `unknown`; metadata is not an attestation |

No new runtime dependency, application schema migration, settlement adapter or financial side effect was added. An unchanged compatible project retains its existing data model and checkpoints. [Prep operational contract](PREP_ENGINE.md) and [Chef recovery guide](../apps/docs/content/chef-recovery.md) define the fields and limits.

Prep still performs archive admission synchronously; interruption during an admission pass can be delayed until that pass completes. Startup credentials are captured once, so cookie rotation requires a deliberate restart with fresh credentials. Chef heartbeats depend on its event loop and are skipped on stdout backpressure. A working heartbeat is not a watchdog or an uptime promise.

## Source interruption, catch-up and restart

The [executable reference exercise](../examples/receipt-consumer/verify-source-recovery.mjs) used an independently installed candidate, real PostgreSQL, actual Chef CLI/API processes and the SQLite continuous consumer. Its **source branches are controlled fixtures**, not live-network blocks.

1. Indexed and consumed heights 0–31.
2. Made the isolated source unready, then unavailable at the transport layer. Read gating closed while retained entities and the consumer's last complete projection remained unchanged.
3. Observed an actual five-second `source_wait` heartbeat with committed height 31, readiness false and no invented source height.
4. Restored the same endpoint at height 1,600 and recovered a **1,569-block backlog**, exceeding the old integration runner's 1,024-block bound.
5. Restarted the follower and consumer. All **1,601 entities**, checkpoint/hash, revision and projection digest matched without duplicate IDs.
6. Stopped all eight owned CLI processes and removed only the run's marked disposable namespace.

The final run passed against the packed candidate after the full SDK suite. The projection digest was `1408c19e5a232d6174646429f177e488ba947bc0b0d38893e923f76a1c7f69fd`. The exercise does not prove natural-reorg behavior or exactly-once external notifications/payments. Existing bounded cursor/reorg tests remain separate.

## Historical shielded-receipt catch-up

The [watch-only harness](../benchmarks/chef/receipt-catchup.README.md) replayed 24 actual testnet blocks containing six previously mined, authorized Ironwood transactions. It used public full-data Prep, native local scanning, PostgreSQL, authenticated GraphQL and the continuous consumer. There were three fresh-namespace repetitions per SDK/profile, alternating SDK order.

| SDK | Page / commit batch | Indexing median | Prep response → consumer median |
| --- | --- | ---: | ---: |
| Published 0.6.1 | 16 / 1 | 0.441772 s | 0.372333 s |
| Candidate 0.7.0 | 16 / 1 | 0.289324 s | 0.362450 s |
| Published 0.6.1 | 16 / 4 | 0.150287 s | 0.115098 s |
| Candidate 0.7.0 | 16 / 4 | 0.132995 s | 0.110784 s |

All 12 runs produced the same 12-note projection and retained it after no-op resume; **86 GraphQL probes succeeded with no errors**. The real Prep follower published 32 blocks across the whole study, including setup/validation. This does not demonstrate concurrent publication inside every short indexing timer.

These are repeated historical catch-up samples on warm local WSL paths. They exclude mining/confirmation delays, source preparation and initial archive admission. The six selected notes reused across repetitions are correlated, and polling bounds affect observation latency. They are **not new future-live measurements** or a replacement for the earlier 2.27-second six-live-receipt study. Batching/polling defaults remain unchanged.

A separate six-run resource cohort recorded 1.66 user CPU seconds, 0.41 system CPU seconds and 3.82 seconds elapsed for the Node/native-child job. Its 134,708 KiB maximum RSS is the largest process high-water mark, **not aggregate pipeline memory**. PostgreSQL, Prep and follower are excluded from that job's resource total; their sampled reader/follower counters are separate in the artifact. No new archive block was published during that short resource cohort.

Only reviewed timing/count/hash evidence is public. The UFVK remained local, temporary copies were removed, and no new transaction was signed or broadcast. Private SQLite output is not included. The [curated artifact](../apps/docs/static/benchmarks/2026-10-25-chef-operations.json) and [aggregate verifier](../benchmarks/chef/verify-operations.mjs) preserve sample and resource boundaries.

## Acceptance evidence

| Check | Result |
| --- | --- |
| Linux Chef suite, PostgreSQL and native scanner enabled | **204 passed, zero failures/skips** |
| Launcher entry-point tests | **3 passed**, version/help, scaffold and safe errors |
| Prep tests | **93 passed**, including build-info and integration tests |
| Prep formatting and all-target Clippy | Passed with warnings denied |
| Independent candidate package install | Chef and matching launcher 0.7.0 tarballs installed outside checkout |
| Controlled source recovery | Passed after the final candidate install; eight actual CLI children |
| Benchmark aggregate reconstruction | All 12 timing runs, four groups and six separate resource runs match |
| Existing benchmark evidence verifiers | All eight passed; historical promotion/rejection decisions retained |
| Documentation production build and browser checks | 45 routes returned 200; nine navigation/search/copy/reflow exercises passed; sampled widths 375/768/1440 had zero Axe violations |

The prior Windows SDK run had 157 passes and 46 environment-dependent skips; Linux supplied the complete no-skip acceptance. Timed receipts used the measured candidate before a later status-only error-guidance correction. The final correction was covered by the full 204-test suite and repeated source-recovery acceptance; timings were not relabeled as a fresh rerun.

No shared VPS service was restarted or replaced. The existing 3 CPU / 8 GiB / 60 GiB guard was retained. Npm publication and hosted rollout remain separate release steps; neither is implied by source validation.
