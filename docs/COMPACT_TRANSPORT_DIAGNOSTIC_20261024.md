# Compact transport and consumer diagnostic — 24 October 2026

The follow-up found substantial client decoding cost and rejected a larger
internal transport batch. No hosted engine or default batching changed.

## Client profile

The profiling client was built from ghz v0.121.0 commit
`b7ca8f5fad40d3da97092a8886e4a4f636712069`, with Go 1.23.0 matching the official
release binary. Only CPU/allocation profile hooks were added. The unmodified
official binary remained the client for timing comparisons.

One two-CPU profiled download sampled 64.35% cumulative CPU under protobuf
unmarshalling and 74.11% under gRPC receive handling. Cumulative percentages
overlap and must not be added. Allocation space was approximately 5 GiB over
the run, not peak live memory. Dynamic message field assignment accounted for
42.95% of sampled allocation space. Normal consumer runs peaked around 33 MiB
RSS. A single four-CPU diagnostic did not improve time; this does not establish
a general CPU-scaling result.

The optional `compact-transport-profile` feature counted 264,476 successful
AsyncWrite completions and 1,115,709,889 bytes over two full diagnostic downloads
and selected parity ranges. About 95% of completions were at most 16 KiB. These
are runtime write completions, not TCP packet counts.

## Batch512 screening

The single-change candidate raised the internal block count from 64 to 512,
retaining the 4 MiB byte limit, two queued batches, admission/connection bounds,
checksums and one CompactBlock per gRPC message. It did not enable buffered
storage reads. Screening used three alternating paired full downloads with
official ghz and the same server 2 CPU / 2 GiB and two client CPUs.

| Repeat | Baseline | Batch512 |
| --- | ---: | ---: |
| 1 | 30.933800 s | 33.134296 s |
| 2 | 29.838873 s | 29.963266 s |
| 3 | 35.328386 s | 29.858499 s |
| Median | 30.933800 s | 29.963266 s |

The 3.14% median improvement missed the predeclared 10% screening threshold,
and two pairs were slower. All 2,466 measured requests were OK. Median server
CPU fell from 35.845081 to 26.848691 CPU seconds, and `/proc` write syscall
counts fell from 215,066 to 60,105. Those counts also include wakeup/control
writes; they do not count packets. Lower write/CPU costs did not produce a
consistent end-to-end improvement. The full concurrency acceptance matrix was
therefore not run. Default batching stays 64; the rejected candidate is retained
as [a reproduction patch](../benchmarks/prep/compact-serving/experiments/batch512.patch).

## Consumer counterfactual

Three runs per combination used the same frozen range, server caps, two client
CPU affinity slots, warm caches and alternating engine/client order.

| Engine | Consumer | Median time | Median client CPU |
| --- | --- | ---: | ---: |
| Direct64 | Official ghz | 29.678618 s | 38.028973 s |
| Direct64 | Typed Rust probe | 23.715860 s | 6.229306 s |
| Buffered64, opt-in | Official ghz | 29.790342 s | 37.527285 s |
| Buffered64, opt-in | Typed Rust probe | 13.993732 s | 6.164829 s |

The typed probe decodes every block, validates ordering and links within the
range, re-encodes the pinned protobuf and hashes all payloads inside its timer.
Every typed run matched 4,102,798 blocks, 411 requests, 529,228,615 payload bytes
and the full reference digest. A separate positive/negative check accepted a
valid digest and rejected a wrong one without printing a successful result.
All official-ghz requests were OK. Every raw report hash and result was checked
again after measurement.

Client algorithms and verification work differ. These typed numbers **cannot
replace the ghz reference comparison or rank Prep against Zaino/Ztreamer**.
They support a consumer-dependent interpretation of this workload, including
how some storage improvements can be masked by client processing. Three samples,
desktop/VM contention, warm caches and differing process histories limit the
conclusion. Client RSS was observed; no client memory cap was imposed here.

## Delivered and checked

- Default: 146 tests passed; all features: 150 tests passed. The shutdown
  fixture scales to three internal batches so it remains a genuine partial
  stream when experimenting with larger batches.
- Rustfmt, all-feature clippy and the documentation production build passed.
- The ordinary release was rebuilt without diagnostic features. All owned
  benchmark/profile services stopped. No wallet, settlement, source node or
  hosted engine cutover was part of this follow-up.
- Source/profile hashes and raw evidence are retained locally. The
  [published summary](../apps/docs/static/benchmarks/2026-10-24-prep-consumer.json)
  is validated by `node apps/docs/scripts/verify-compact-benchmarks.mjs`.
  The [reproduction guide](../benchmarks/prep/compact-serving/README.md)
  includes profile hooks and the typed download probe.
