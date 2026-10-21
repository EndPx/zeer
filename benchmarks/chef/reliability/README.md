# Live reliability

`run.mjs` compares the original and queued-metadata native Prep binaries while
keeping published Chef 0.2.0, two-second follower polling and the entity workload
fixed. It reuses the source oracle, process instrumentation and database export
helpers from `../head`. Assignments cross after six future blocks. Run only in
an isolated, resource-bounded environment with private RPC/SQL credentials.

The accepted run uses one ordinary full-validation shadow follower from source
tip minus 32. Two HTTP readers share its small modern archive. Each also receives
two concurrent 16-block background reads every two seconds. The archived plan,
raw requests, source projection, entity digests, restart outcomes and source
hashes are part of the public evidence. Cold-start attempts that collected no
pairs are disclosed separately; this does not measure full-history admission.

The one-line Prep change gives height/readiness the same bounded admission queue
as queries. Native tests cover busy-slot waiting, authentication, queue timeout,
request cancellation and snapshot freshness. The live run has zero failed timed
reads in **both** variants, so it does not prove a lower live error rate.

`receipt-live.mjs` is a separate Windows study. Copy it, `report.mjs`, `readiness.mjs` and
`receipt-supervisor.mjs` into the standalone
`examples/receipt-consumer` directory **outside** the checkout after installing
its dependencies from npm. It expects protected environment paths for a local
scanner, viewing key and account metadata, plus an owned PostgreSQL connection.
It refuses a reused output directory. `receipt-supervisor.mjs` launches it with
an independent 2,400-second process-tree deadline. It never signs or broadcasts.

Live monitoring reads `readLatestReport(directory)` from `report.mjs`. The writer
publishes synced immutable `report-*.json` snapshots and normally retains four;
a hard 64-snapshot / 4 MiB-per-report bound stops an unhealthy diagnostic sink.
Readers retry a snapshot removed by retention. The fixed `raw-private.json` is
created once after shutdown for terminal evidence, never replaced during polling.
Transient storage failures have bounded retries; fatal failures retain safe
stage/code diagnostics on stderr and preserve the last complete snapshot.

The study requires a private `expected-operations.json` containing exactly six
unique `{ordinal,txid,broadcast_ns}` operations, ordinals 1–6, before completion. Selected
external notes must carry the corresponding `Zeer live receipt 01`–`06` memos,
equal 100000-zatoshi values and a consistent receiver. Test funding is a separate
private operator action; no signing helper is shipped with this harness.
Readiness requires a successful bootstrap, a ready persisted checkpoint and a
live consumer child. Each live operation must have been requested after that
readiness timestamp and first observed by Prep afterwards in a future block.
Use `STUDY_PREP_URL` and, where needed, `STUDY_PREP_TOKEN` for a private candidate;
disclose the chosen transport separately from public-ingress measurements.

Timings begin when the client receives the matching raw transaction from Prep.
Native scanner completion, handler work, PostgreSQL commit acknowledgement and
the separate child's revision-matched SQLite projection are recorded on one
Windows monotonic clock. Consumer time is an upper bound observed after reading
the committed SQLite snapshot. The database connection crosses an SSH tunnel;
these timings are not directly comparable with the same-host public-data study.
Block-production and confirmation waits are not receipt-processing time.

After an interrupted attempt, recovered operations must be marked
`observation_mode: "catch_up"` in the manifest. The result distinguishes live
and catch-up counts and leaves `original_live_goal_met` false unless six live
samples actually completed in that run. Keep the interrupted run separately;
do not replace its timings with later catch-up observations or pool both runs.

Raw receipt data remains private. Publish only an intentional allowlist of the
owned test observations, summary statistics and non-secret source provenance.
Do not expose viewing keys, seeds, unrelated notes or internal change values.
