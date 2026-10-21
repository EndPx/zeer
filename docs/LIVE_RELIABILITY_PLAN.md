# Live reliability and standalone receipt consumer

Baseline: published Chef 0.2.0, Prep source at `afaca65`, existing native Prep
binary retained independently. This milestone does not operate ZeeSwap's driver,
sign payouts or alter source canonicality/read gates.

## Bounded work and acceptance

1. Reproduce metadata capacity rejection while both Prep work permits are held.
   Test bounded admission for height/readiness, authentication before queuing,
   cancellation, overload and snapshot freshness after waiting. Candidate: metadata
   uses the same FIFO admission as data queries. Limits stay two active workers,
   eight queued requests and 0.25 seconds of waiting. A genuine source failure,
   epoch conflict or queue timeout still fails visibly.
2. Run paired live public-data followers using installed Chef 0.2.0 and the same
   schema, two-second polling and data source. Compare original and candidate Prep
   admission, not different SDKs or polling intervals. Collect 12 paired future
   blocks with assignments crossed after six, under the declared shared 3 CPU /
   8 GiB envelope. Isolate test APIs/databases from hosted projects. Deadline:
   1,500 seconds. Record all failures; candidate acceptance requires no timed
   candidate-side consumer read failures, no worse observed p95, no increase in
   background-read failures, exact independent source output
   and restart convergence. Failure is a reportable result, not permission to
   relax gates or discard samples. A second attempt needs a declared reason.
   Both HTTP sources receive two simultaneous 16-block metadata queries every
   two seconds to represent shared use. Original-source failures remain in the
   report separately. Both release binaries use the same checkout/compiler;
   the deployed binary is retained but is not substituted for this control.
3. Copy a reference consumer into a directory outside the Zeer checkout. Install
   Chef 0.2.0 from npm without workspace links. Consume bounded ranges into a
   private SQLite database: stage pages and persist cursors atomically; publish a
   replacement range only after a complete compatible traversal. On 409 discard
   staging and rebuild, including deletions. On 503 or stale/unknown freshness,
   retain the last complete projection without advancing progress. Resume after
   process restart. No webhook, payout or irreversible side effect is included.
4. Verify consumer restart, invalidation and orphan removal against an isolated
   Chef/PostgreSQL project with controlled branches. This is simulated reorg
   evidence, not a naturally observed testnet reorganization. Watched ranges are
   bounded; rescanning the complete watched interval avoids silently missing
   deletions behind an incremental high-water mark.
5. Inspect the dedicated owned testnet wallet/scanner before any live receipt
   study. Target six transactions mined in distinct blocks, one selected external
   note per transaction, each 100,000 zatoshi back to the owned receiver and at
   most 10,000 zatoshi fee. Aggregate fee ceiling: 60,000 testnet zatoshi. Seeds
   remain local and outside Zeer's watch-only implementation. Preserve each
   signed/broadcast operation and resolve uncertain outcomes before retrying.
   If funding, witness, resource or inclusion constraints prevent the declared
   study, report partial or blocked evidence rather than substituting fixtures.
6. Timestamp the first client observation of a complete Prep block/transaction,
   completed native decryption, acknowledged Chef commit and complete consumer
   storage. Report sample count, median, nearest-rank p95, failures and resource
   observations in seconds. First client observation includes detection/transport;
   it is not an exact Prep publication timestamp. Source fetch includes queueing
   unless separately instrumented. Block production and confirmation waiting are
   separate context, not included in receipt processing claims.

## Isolation and delivery

Build/test jobs use the existing admitted build container or transient unit with
bounded CPU/memory under the aggregate envelope. Run the resource guard before and
after; stop new work at its limits. Temporary databases, roles and credentials
are removed only after all workers stop. Preserve raw evidence and original
binaries. Production activation requires the candidate's acceptance results and
a reversible change; publication alone does not upgrade hosted namespaces.

Release verification keeps registry integrity, fresh installation, generated
typechecks, additive upgrade and consumer compatibility as separate recorded
checks. Financial execution remains in the consuming application.

Pre-collection setup note: the first live-launch attempt stopped with zero pairs because native full-archive initialization exceeded its initial 15-second startup check. Both source startups now have a 120-second bound and their elapsed times are retained outside paired steady-state measurements. Workload, quotas and acceptance are unchanged.


Before paired collection, the second full-history reader setup also stopped with
zero pairs. A fresh archive open performs full segment integrity admission over
all historical data; it does not reuse the running production reader's caches.
At the unchanged 0.5 CPU / 1 GiB limit this exhausted the 120-second startup bound.
The revised study therefore uses an isolated **live tail starting at node tip
minus 32**, ingested by the ordinary full-validation follower with one confirmation,
16-block segments and a 16-block reorg bound. Both HTTP variants read that same
archive; the follower shares their existing experiment cgroup. No integrity check
is skipped. This is a bounded-window reliability study and cannot establish
whole-history cold-start performance. The production archive/readers remain
unchanged; both failed setup directories and their source archives are retained.

## Receipt-study outcome and bounded continuation

Three precollection observers stopped without a broadcast while review strengthened
artifact isolation, snapshot timing and supervision. The third also exposed a
PowerShell watchdog timezone bug; the replacement is an independent monotonic
Node process-tree supervisor. These attempts contribute no receipt timings.

The initial measured run stopped after one completed live receipt. The second
transaction had already been submitted. Its original TX ID was inspected and
confirmed mined; no rebroadcast or replacement was issued. The recorded generic
`STUDY_FAILED` diagnostic did not preserve an actionable cause. Subsequent code
records safe error codes/syscalls and retries transient Windows file-replacement
errors; the original failure remains unclassified.

Before further submissions, continuation was restricted to ordinals 3–6. The new
observer recovered 01/02 as `catch_up` and measured four future live receipts.
Total transactions stayed six and aggregate fees 60000 testnet zatoshi. All six
receipt values/memos and source block hashes passed, and API/consumer restart
preserved 12 notes without duplicates. The original six-live-in-one-run goal is
unmet. Initial and recovery timings are not pooled. The frozen recovery sampler's
`PASS` describes receipt checks; the public derived report explicitly separates
live/catch-up counts and marks the original goal unmet. The current harness also
emits those distinctions directly for future runs.

The public ingress returned rate-limit responses independently of native Prep
worker admission. Its shared 2 requests/s limit was not raised. Consumer status
waits/revision restarts are retained alongside HTTP statuses; a 200-only GraphQL
request log does not imply continuous read availability.

## Full-history deployment gate

After receipt timing ended, the release candidate was warmed separately against
the full archive under 0.5 CPU / 1 GiB, with the original public reader left running.
Readiness did not arrive by the declared 1200-second bound. The temporary reader
was stopped; its unit/guard registration were removed/restored. No public route,
hosted Chef namespace or existing reader was switched. CPU consumption was
599.039609 seconds and peak charged memory 1073741824 bytes, with no swap. These
observations do not establish the dominant cold-start bottleneck. The unchanged
aggregate 3 CPU / 8 GiB resource guard passed after cleanup. Production activation
remains unverified despite the successful bounded-tail comparison.
