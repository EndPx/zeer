# Full-history readiness and live receipt validation

Completed 22 October 2026, Asia/Jakarta, against baseline `d35d2eb` and published
Chef 0.2.0. The [verification manifest](FULL_HISTORY_READINESS_VERIFICATION.json)
records source identities, gates, deployment, browser checks and cleanup.

| Gate | Observed result |
| --- | --- |
| Frozen archive admission | Both implementations validated 4,526,100 blocks / 13,513 segments |
| Previous / candidate admission | 1,098.547186 s / 897.791157 s, one run each |
| Ordinary live-archive HTTP readiness | 837.424602 s, within the unchanged 1,200 s gate |
| Data equality | Six first/middle/modern query cases; old/new data and independent node headers/TX IDs matched |
| New live receipts | Six future mined Ironwood notes, one uninterrupted observer, zero catch-up |
| Prep response → consumer storage | Median 2.270050 s; observed maximum / nearest-rank p95 3.171446 s |
| API/consumer restart | 12 notes preserved, zero duplicate IDs |
| Controlled consumer recovery | 12 actual process runs, including cursor/reorg, read-gate and HTTP/database faults |
| Native validation | 142 tests, feature clippy, ordinary/profile release builds and formatting passed |
| JavaScript validation | 19 report, readiness, consumer, shutdown and supervisor tests passed |
| Documentation | Build and local/public 44-page browser checks passed; tested 375/768/1440 layouts had no recorded axe violations |
| Publication | Six public evidence files matched local bytes; both review axes passed |

The candidate public Prep upstream was activated only after full readiness,
query equality and the six-live-receipt gate passed. A first activation preflight
stopped before mutation because its literal matcher did not accept the existing
quoted environment value. The corrected helper checked the parsed old loopback
URL, then changed only the web's Prep upstream and restarted that owned service.
Post-switch public transaction observations matched all six node references.
The original native reader remains warm for rollback; existing Chef namespaces,
public limits and canonicality gates were preserved.

The startup optimization avoids rebuilding an intermediate JSON tree for
supported canonical raw-reference records. Unsupported inputs retain the legacy
decoder, including reserved Serde markers. Full checksum/integrity validation,
bounds and optional-index budgets remain enabled. Timers are opt-in and absent
from the deployed ordinary build.

The local observer now publishes immutable report snapshots and verifies its
persisted ready checkpoint and consumer liveness before funding readiness.
SQLite automatic rollback preserves its original failure diagnostic. Controlled
tests retain the last complete consumer projection through write denial,
transport failure, revision invalidation and source reconciliation.

Viewing/spending keys stayed on Windows. The six owned self-transfers each used
a 100,000-zatoshi selected external note and a 10,000-zatoshi fee; total fees were
60,000 zatoshi. The temporary database/role, local test credentials, SSH tunnels
and owned snapshot hardlinks were removed after verification. The source archive
and original wallet keys remain intact. No ZeeSwap driver or payout was run.

Host caches were not cleared; the sequential startup pair is not a cold-disk
comparison or repeatable median. Receipt timing used private SSH transport and
excludes the separately recorded mining/ingestion wait and any additional
settlement confirmation policy. The live sample did not encounter a natural
reorg. Earlier failed/interrupted studies remain unchanged and separate.

Published results: [Prep](https://zeer.endpx.cloud/docs/prep/benchmarks/#full-history-startup)
and [Chef](https://zeer.endpx.cloud/docs/chef/benchmarks/#shielded-receipts-six-uninterrupted-live-samples).
