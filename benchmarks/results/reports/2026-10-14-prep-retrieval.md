# Prep retrieval against native Zcash data paths

Executed 14 October 2026, Asia/Jakarta, after the Chef indexing comparison had
finished. Prep's engine binary was unchanged. This session measures prepared
data retrieval, separately from node synchronization and application indexing.

## Common workloads

- **Headers:** all 2,048 rows for heights 1–2048, with height/hash/time.
- **Transaction metadata:** all 16,962 transactions in that range, with txid,
  mined height, version, locktime, byte size, input count and output count.
- **Sparse transaction selection:** 128 fixed transaction IDs from the existing
  independent manifest, using the same seven-field projection.

All rows are normalized into the same canonical order and compared in full
against the retained independent node oracle. Every visit performs source
preflight, a verified warmup, one measured retrieval, complete output verification
and source postflight. Timing runs from the first request through final response
decoding, normalization and ordering. Oracle loading, hashes/equality checks,
readiness and source checks are outside the measured interval.

Five cyclic rotations of six candidates produce five observations per applicable
candidate/workload, for 60 measured visits and 60 warmups. With six candidates
and five rounds, every candidate occupies five distinct positions, rather than
every possible position. One backend runs at a time, in addition to the shared
frozen source and client. Caches are retained and no prior-session timings are
pooled into the results.

## Results

All **60 measured visits and 60 warmups passed** complete row equality checks.
The table reports median milliseconds for the entire stated workload, not a
single request. Each populated cell has five measured observations.

| Native data path | 2,048 headers, ms | 16,962 transaction metadata rows, ms | 128 selected transaction IDs, ms |
| --- | ---: | ---: | ---: |
| Zeer Prep HTTP | **22.615** | **1,614.132** | **443.115** |
| Zakura 1.5.0 JSON-RPC | 1,596.047 | 2,453.900 | 117.348 |
| CipherScan prepared PostgreSQL | 7.242 | 112.883 | 4.072 |
| lightwalletd 0.5.5 gRPC | Not measured | Not measured | 244.230 |
| Zinder 0.6.0 gRPC | Not measured | Not measured | 92.249 |
| Zaino 0.10.1 gRPC | Not measured | Not measured | 1,874.074 |

Prep's observed median is lower than RPC for the two full-range projections, but
its sparse transaction selection is slower than RPC, SQL, lightwalletd and
Zinder. CipherScan's materialized SQL projection has the lowest median in all
three workloads. These results do not establish a general Prep speed advantage.

Prep header samples ranged 16.449–95.452 ms, and Zinder sparse samples ranged
70.809–375.473 ms. Those outliers remain in the five-observation distributions;
the raw session retains every value. Median differences are descriptive results
on a shared host, not confidence intervals or universal multipliers.

The current Prep transaction-ID filter evaluates matches while scanning stored
transaction envelopes, and the requested count/size projection requires decoded
object overfetch. A dedicated transaction-ID lookup index and compact public
metadata projection are useful future optimization hypotheses. Neither change
was implemented to produce this benchmark.

The gRPC adapters only run the sparse transaction workload in this harness.
Compact blocks alone do not enumerate the equivalent complete public transaction
projection, and early-range height/hash/time compatibility was not validated
for this session. Missing table cells mean **not measured here**, not a claim
that every gRPC service lacks a header API or has failed performance.

## Native paths and resources

Prep uses persistent HTTP, 128-block pages and its batched transaction-ID filter.
To derive byte size and input/output counts, the current query returns decoded
transaction objects containing more fields than the final seven-field projection.
That overfetch is included in the timing and response-byte observations.

RPC uses eight persistent worker connections. Full scans request `getblockhash`
and `getblock` at verbosity 1/2 per height. Sparse requests use `getrawtransaction`
and the returned transaction's block to derive its mined height and verify
membership. CipherScan uses SQL range/`ANY` filters inside a read-only
repeatable-read transaction. Its transaction commands and timeout settings are
included in timing. gRPC uses 128 sequential native `GetTransaction` requests
and decodes their returned v1 envelopes on the client. These are equivalent
final outputs via different native work, batching and concurrency patterns.

Each **queried backend** has 1 CPU / 2 GiB / zero swap. The source node has the
same ceiling, and client plus controller share 1 CPU / 512 MiB. Maximum aggregate
is 3 CPU / 4.5 GiB. In the RPC case the source is itself the queried backend, so
no additional backend runs. For the other cases, the shared source remains
available and a backend may query it while serving; both ceilings are included.
Actual cgroup limits are captured before visits, and original limits restored
after the session. CPU ceilings are not dedicated physical cores.

The PostgreSQL projection and Prep archive cover the same 2,048-block workload;
the source and existing wallet-serving stores reach the frozen height 6764.
No provider is represented as synchronized to current mainnet. Zinder uses the
previously disclosed historical-fixture health policy. Data is early-mainnet
public v1/v2; no shielded decryption or modern full-chain performance is implied.

The driver checks request budgets and uses transport/SQL timeouts. The controller
also imposes a 420-second outer client-process deadline with verified scoped
shutdown, since socket inactivity timeouts alone are not absolute wall-clock
termination guarantees. Resource counters include warmup/readiness and are not
isolated timed-query CPU measurements. HTTP bytes exclude headers, gRPC bytes
are serialized protobuf payload sizes, and PostgreSQL wire bytes are unavailable.

## Evidence

- [Session summary, all visits and actual limits](../raw/2026-10-14-prep-retrieval/session.json).
- [Source identities, tests and cleanup](../raw/2026-10-14-prep-retrieval/execution.json).
- [Retrieval driver](../../prep/full/retrieval.py) and
  [host recipe](../../prep/full/retrieval_session.py).
- Each measured visit and client output is retained in the same raw directory.
- The exact executed orchestrator is archived there. A later wording-only change
  clarifies that the shared source may serve backend requests; the original raw
  limitation's word "idle" must not be read as measured source inactivity.

Ten retrieval-driver tests passed. All experiment containers were stopped,
original candidate resource limits were restored, and the five existing
application services remained active. This session did not publish an endpoint,
purchase infrastructure or change Prep's engine binary.
