# Continuous consumer study

This is a bounded one-hour operational study, separate from receipt decryption
and Prep retrieval benchmarks. Run from a copied project installed from npm
outside the repository, with an isolated PostgreSQL role/database. Copy
`run.mjs`, `worker.mjs`, `oracle.mjs`, `schema.graphql`, the reference consumer's
`consume.mjs` / `consumer.mjs`, and `../reliability/report.mjs` into that project.

The source is a live full-data testnet Prep. Each real header produces twelve
**synthetic application entities**, indices 0–11. No viewing key is loaded and
these rows are not shielded receipts. The initial range is 1,200 modern blocks;
the writer, independent API and SQLite consumer then follow live blocks.

Require the external process-group runtime cap as well as the internal timer:
the recorded launcher uses systemd `RuntimeMaxSec=4500`, `TimeoutStopSec=10` and
`KillMode=control-group`. Parent and children share 0.5 CPU / 1 GiB, no swap,
within the existing 3 CPU / 8 GiB pipeline. Do not change production services.
Bound each file/report, database connection/query and the 128 MiB SQLite/WAL
study footprint. Use protected `DATABASE_URL`, `CHEF_API_TOKEN`, `PREP_URL` and
`PREP_API_TOKEN` environment values; never include them in published evidence.

The 3,600-second timer starts after bootstrap and a completed initial consumer
projection. Declared faults: kill/restart the consumer at 600 s, pause its API
for 10 s at 1,200 s, pause its producer for 45 s at 1,800 s, and abruptly restart
the producer at 2,700 s. Source ingestion outside this owned project continues.
The longer producer pause must exercise stale-source waiting. Record every
request status, wait/restart outcome, lag sample, process RSS and SQLite size.
Stdout state counters include both page notifications and invocation results;
they are not a throughput or completed-window count. Resource timestamps record
actual collection time. The loop's elapsed offset can precede a blocking fault
pause, so use the associated resource capture time when plotting samples.

Acceptance requires all faults completed, restart without duplicate IDs, a
fresh final compatible projection, and exact equality against source headers
expanded into indices 0–11. Stop the writer before final export. Verify header
continuity, each expected entity, value, block hash, identity and total count.
Storage/metrics failures produce a failed terminal record; an external timeout
is incomplete regardless of the last periodic report. Preserve setup failures.

This is not a sustained-load limit, public-ingress measurement, natural reorg
test, consensus proof or population latency/SLA estimate. Controlled reorg and
cursor tests are separate. Raw public headers may be published; keys and
database credentials may not. Retain source hashes, package integrity, declared
limits, watchdog outcome and cleanup evidence alongside the result.
