# Shielded receipt historical catch-up

`receipt-catchup.mjs` compares published Chef 0.6.1 with the pre-release 0.7.0 candidate measured before publication on an existing owned testnet wallet. It reads six previously mined Ironwood transactions across blocks **4,526,284–4,526,307 inclusive**. This is historical catch-up, not future-live detection, a broadcast test or confirmation latency.

The recorded 25 October 2026 timing cohort contains 12 runs: three fresh namespaces for each SDK and each 16/1 or 16/4 page/commit profile. The same six selected external notes are reused in every run; their pooled timings are correlated. Scanning also finds other authorized notes in those transactions: all runs store the same 12-receipt projection. A no-op resume must leave it unchanged. No signing or broadcasts occur, and the local viewing key is never sent to Prep.

## What the timers include

| Measurement | Boundary and scope |
| --- | --- |
| Indexing time | From the first `syncStep` through the caught-up result, after migration, scanner object construction and API setup; includes source reads, local scanning, handler work and commits |
| Prep response → decryption | Matching Prep response received and decoded by `PrepClient` → the local scan and receipt validation return |
| Decryption call | Immediately before `NativeReceiptSource.scan` → return; includes native child startup on the first call |
| Decryption → commit | Scan result returned → the application store acknowledges the group containing that note |
| Commit → consumer | Commit acknowledgement → the SQLite consumer's completed projection is observed to contain the note |
| Prep response → consumer | First boundary above → consumer observation; excludes the HTTP transfer before that matching response and all earlier source acquisition, mining and confirmation waiting |

The harness uses one host's monotonic clock. The consumer pauses **0.100 seconds** between sweeps; the GraphQL probe pauses **0.050 seconds** between requests. Consumer observation is a polling bound, not an exact server publication or SQLite commit timestamp. A large group can delay promotion of several notes together. GraphQL and consumer waits/errors are recorded alongside indexing results.

Run-level indexing medians use three durations per SDK/profile. Receipt medians and nearest-rank p95 pool 18 selected-note observations per group: six reused notes in three runs. The small sample does not estimate a service-level tail guarantee. Phase events count stage transitions for the candidate; they are not additional receipts or a scanner timer.

## Reproduction environment

Requirements are Node.js 24.14+, a disposable PostgreSQL database, independently installed SDK roots, an existing native scanner and its protected testnet UFVK file, plus a **loopback HTTP Prep endpoint** serving the relevant `full-v1` history. The endpoint is an existing actual archive; it is not the synthetic source-interruption fixture. The harness loads published selected transaction references from `apps/docs/static/benchmarks/2026-10-22-chef-receipts-testnet.json`.

| Variable | Purpose |
| --- | --- |
| `ZEER_CATCHUP_OUTPUT` | New private output directory; must not already exist |
| `PREP_URL` | `http://127.0.0.1:PORT` for the owned local Prep reader |
| `DATABASE_URL` | Existing disposable PostgreSQL connection with permission to create/drop its own namespaces |
| `CHEF_BASELINE_ROOT` | Absolute installed `@zeer-dev/chef` 0.6.1 package directory |
| `CHEF_CANDIDATE_ROOT` | Absolute independently installed candidate package directory |
| `ZEER_SCANNER_EXECUTABLE` | Absolute existing native scanner executable path |
| `ZEER_VIEWING_KEY_FILE` | Absolute protected local file for the explicitly authorized testnet viewing key |
| `ZEER_ACCOUNT_ID` | Local scanner account identity |
| `ZEER_KEY_FINGERPRINT` | Matching inspected key fingerprint |
| `ZEER_CATCHUP_VARIANTS` | Optional `baseline`, `candidate`, or default `baseline,candidate`; both SDK installations remain required |

For example, after setting those variables in a protected local shell:

```sh
node benchmarks/chef/receipt-catchup.mjs
```

The script creates a new marked `rc_<random>` project for each run, runs authenticated GraphQL and the bounded continuous SQLite consumer, checks every projected row and hash, verifies a no-op resume, then drops only that completed run's namespace. Private SQLite, samples and summary files stay in the output directory. Failed namespaces remain for inspection. The script does not provision PostgreSQL, start a Prep follower, copy/delete a key or impose CPU/memory limits; the operator must manage and record those separately.

This harness is for the existing Zeer-owned test account and selected references. Pointing it at an arbitrary wallet will not reproduce the expected notes. Do not loosen its checks or publish private results to make an unrelated wallet appear to match. Public data and resource summaries must exclude local account identifiers, receivers, memos, key material and credentials.

## Recorded environment and correctness

The timing cohort ran in local WSL2 with warm caches and no cache drops. Prep reader affinity was 0–1, follower affinity 4, and Chef/native scanner/PostgreSQL shared 2–3. Affinity is not a CPU quota; hard memory cgroup limits were absent. SDK ordering alternated by repetition, while the default profile preceded batch4 in each repetition. Source preparation, archive admission, database setup and final validation were outside the indexing timer. Native scanning on the first request includes child startup.

A real local follower read the existing Zebra through a read-only SSH tunnel and advanced Prep from **4,536,306 to 4,536,338**, publishing 32 blocks across the whole study, including setup and validation. This does not establish publication overlap within each indexing timer. These background blocks are distinct from the historical range being replayed. Twelve canonical source checks covered the selected heights before and after. All projections matched SHA-256 `b1392192e717ddb5eb10d502f2516463743ae6afa0bd4ba36fbb73b96aac003a`; 86 concurrent GraphQL probes returned without errors. The viewing key remained local and the temporary authorized key copy was removed by the operator after use.

`requests` counts Prep requests including no-op resume validation, after the indexing timer has stopped. It is not a timed indexing-only counter. The GraphQL probe has a five-second timeout; failure cleanup still depends on the remaining database/scanner operations returning. Completed namespaces are removed, while failed namespaces and private consumer files are retained for inspection.

These results describe the measured local path, not public ingress or VPS quotas. They do not change published defaults, establish mainnet support, prove future-live detection or supersede the older six future-live receipt samples with a 2.27-second median.

## Separate resource cohort

The public artifact also records a later **six-run candidate-only resource cohort**. It is separate from the 12-run timing cohort and cannot be pooled with it. `/usr/bin/time` recorded **1.66 user CPU seconds**, **0.41 system CPU seconds** and **3.82 seconds elapsed** for the completed Node/native-child job. Its **134,708 KiB maximum RSS is the largest process high-water mark, not aggregate concurrent memory**. Separately running PostgreSQL, Prep and follower resources are excluded from that job total.

Per-run `process.cpuUsage()` covers Node setup, indexing, polling and validation through report emission; it excludes the native child, Prep, PostgreSQL and later cleanup. `process.resourceUsage().maxRSS` is a lifetime high-water mark for that Node process, so it can retain the maximum from an earlier run. Neither per-run number provides a total isolated pipeline budget.

Reader/follower CPU deltas and start/end RSS were observed separately. The follower was running but its archive height did not change during this short resource cohort. This cannot be presented as another observation of 32 published blocks or as evidence of steady-state memory bounds.

The curated [public artifact](../../apps/docs/static/benchmarks/2026-10-25-chef-operations.json) includes every timing group, individual stage sample, GraphQL outcome, separate resource scope, and controlled-recovery verification. Raw private receipt data and local key files are not public reproduction inputs.
