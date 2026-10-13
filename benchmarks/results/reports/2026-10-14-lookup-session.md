# Five-candidate lookup session with equal aggregate resource ceilings

Executed 14 October 2026, Asia/Jakarta. This experiment measures prepared native
transaction lookup and client normalization. Index construction, block ingestion,
wallet scanning and shielded decryption are outside its timing boundary.

## Workload and scheduling

Every visit requests the same 128 distinct early-mainnet v1 transactions in the
same order, returning transaction ID, mined height, version, locktime, serialized
size, transparent input count including coinbase, and transparent output count.
The existing independent manifest contains 78 coinbase and 50 non-coinbase
transactions selected from heights 1–2048. Its frozen source head is 6764.

Five rounds rotate the order cyclically:

1. Chef, CipherScan, Zinder, Zaino, lightwalletd.
2. CipherScan, Zinder, Zaino, lightwalletd, Chef.
3. Zinder, Zaino, lightwalletd, Chef, CipherScan.
4. Zaino, lightwalletd, Chef, CipherScan, Zinder.
5. lightwalletd, Chef, CipherScan, Zinder, Zaino.

Each candidate therefore occupies every position once. Only one candidate is
active at a time. A visit starts the prepared service, admits its real readiness,
verifies one complete 128-record warmup, times one sequential 128-record read on
the reused connection, then verifies every returned field and source anchors.
The candidate is stopped before the next visit. OS caches are retained; these
are warm serving measurements, not cold-start measurements.

Each raw visit intentionally has only one measured repetition and is individually
ineligible for comparison. The session becomes eligible only after all five
visits per candidate pass, with matching manifest, projection, adapter identities,
versions and resource profile, followed by successful cleanup and service checks.

## Resource contract

| Component | CPU ceiling | Memory ceiling |
| --- | ---: | ---: |
| Frozen Zakura source | 1 CPU | 2 GiB |
| Active candidate, all required serving processes combined | 1 CPU | 4 GiB |
| Python client and session controller combined | 1 CPU | 512 MiB |
| Aggregate experiment | 3 CPU | 6.5 GiB |

Chef's API and PostgreSQL share one systemd parent cgroup. Either can use available
capacity within that shared ceiling; they do not each receive an extra CPU or
4 GiB. Zinder's four native processes share one Docker cgroup. CipherScan's
prepared serving process is PostgreSQL because its native backfill has already
finished. lightwalletd and Zaino each run inside their own equivalent cgroup.
Candidate cgroup CPU, memory and swap ceilings are inspected before every visit.

All clients use the same pinned Python container image, installed gRPC/psycopg
dependencies, host-network origin, CPU/memory limits, manifest and normalization
code. They connect to private container addresses or Chef's loopback endpoint.
No benchmark API is publicly published. Resource counters include startup and
warmup and must not be described as isolated measured-query CPU or peak RSS.

## Results

All **25 measured visits and 25 warmups passed**. Each returned all 128 records,
with zero duplicate IDs or mismatched fields. Preflight and postflight checks
passed for every visit. These are total times for **128 sequential lookups**, not
individual-request latency. Lower time is better.

| Candidate | Native serving path | Median total, ms | Min–max, ms | Lookups/s | Verified visits |
| --- | --- | ---: | ---: | ---: | ---: |
| CipherScan / 15d7f528 | Indexed PostgreSQL fields | **19.913** | 16.701–24.447 | 6,427.93 | 5/5 |
| Zinder 0.6.0 | gRPC + client decode | **70.164** | 56.142–146.993 | 1,824.31 | 5/5 |
| lightwalletd 0.5.5 | gRPC + client decode | **168.234** | 155.323–342.269 | 760.85 | 5/5 |
| Zeer Chef / 444ebcc | GraphQL + PostgreSQL | **273.039** | 229.246–283.842 | 468.80 | 5/5 |
| Zaino 0.10.1 | gRPC + client decode | **1,794.237** | 1,741.083–1,812.272 | 71.34 | 5/5 |

CipherScan's SQL path had the lowest observed median. Chef's GraphQL path was
slower than CipherScan, Zinder and lightwalletd and faster than Zaino in this
specific session. No prior session's observations enter these medians.

The shared host has four logical AMD EPYC 9354P CPUs and approximately 16 GiB RAM.
Eleven driver/lookup tests passed on the host. Final cleanup recorded no errors;
all benchmark candidate/source/client containers were stopped, and the five
existing application services remained active. No public deployment, paid
resource change or candidate implementation change was performed.

## Interpretation and limits

CipherScan reads previously indexed fields with direct SQL. Chef performs
authenticated GraphQL execution and reads entities inside a PostgreSQL snapshot.
Zinder, Zaino and lightwalletd return raw transaction bytes through gRPC; the
client decodes them into the same seven-field projection. Equal output and equal
resource ceilings do not make these backend/transport workloads identical.
The table compares those native prepared-serving paths, not parser speed or
overall application-indexer quality.

Chef's preserved application namespace covers heights 1–2048; the other prepared
stores/source reach 6764. Their requested records are identical, but their total
indexed footprints are not. The source remains frozen and disconnected from
public peers. Zinder retains the disclosed historical-fixture health policy from
the prior four-provider experiment; this is not a current-mainnet synchronization
claim. No candidate implementation was modified.

This is one session on a shared VPS, with five observations per candidate and no
OS-cache isolation. Rotating order reduces a simple fixed-order bias; it does not
eliminate shared-host variability or establish a universal speed ratio. The
historical v1 workload does not establish current Sapling/Orchard performance.

## Reproduction and evidence

- [Session orchestration recipe](../../chef/session_host.py): known isolated host
  paths, resource checks, rotating schedule, aggregation and cleanup.
- [Per-visit driver](../../chef/session_lookup.py): reuses the existing adapters,
  bounded readiness, verified warmup and measured lookup.
- [Independent manifest](../../fixtures/mainnet-transactions-v1/manifest.json).
- [Session evidence](../raw/2026-10-14-lookup-session/session.json): all visits,
  resource ceilings/counters, hashes, summary and post-run service state.
- [Execution identity](../raw/2026-10-14-lookup-session/execution.json): source
  hashes, inspected shared cgroup limits, CPU model and test result.
- The same raw directory contains every visit's JSON, readable table and client
  output. Old benchmark sessions are not pooled into this table.

The recipe requires the preserved prepared states; it does not install arbitrary
databases or rebuild the chain. Existing services and application databases are
outside its permitted paths. A fresh output directory is mandatory, so previous
results are not overwritten.
