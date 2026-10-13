# Frozen transaction lookup benchmark

Candidate: CipherScan; profile: shared-vps-five-rotated-session-v1.
Endpoint: postgresql://172.29.0.3:5432.
Code SHA-256: `85b18ddad3c1111d5d5e635d380f73ac01656f2243701f068451a06d494fe394`.
Manifest SHA-256: `27931877b11b01ce48fc448a97ad7201ba18342279b0db6a888e3d676d9290ad`.

sequential per-transaction lookup + client normalization into memory on one reused connection; verification and source-anchor checks excluded

Status: **PASS**; comparison eligible: **False**.
Verified warmup: **PASS**.

| Run | Status | Lookup + normalize ms | Verify ms | Lookups/s |
| --- | --- | ---: | ---: | ---: |
| 1 | PASS | 19.308 | 0.668 | 6629.401 |

Limitations:

- Serving/read benchmark, not fresh indexing or database-ingestion speed.
- gRPC returns raw bytes then client decodes; PostgreSQL returns indexed fields. Equivalent final fields do not make transport/backend work identical.
- Genesis is indirectly anchored by the independently validated frozen canonical head; pre-Sapling gRPC block reads are not assumed available.
- All selected transactions are pre-Overwinter v1 within heights 1..2048; no later protocol or shielded workload coverage.
- This visit has one verified 128-record warmup and exactly one measured sequential 128-record read; it is not independently eligible for ranking.
- The scheduler must rotate candidate order for five rounds and capture equal source/candidate/client cgroup allocations and actual resource evidence separately.
- Prepared-serving comparison only; source preparation and native application ingestion remain separate experiments.
