# Compact read-path experiment — 24 October 2026

The sequential-read candidate improved the paired download median from
**22.920197 s to 21.186483 s**, a **7.56%** reduction. Median server CPU time fell
from **26.106398 CPU s to 16.754105 CPU s** (35.82%). The candidate was **not
promoted to default** because the predeclared promotion gate required at least
10% lower download time.

## Evidence

- Candidate: 16 scenarios × three repeats; baseline: three focused scenarios ×
  three repeats. Baseline/candidate order alternated by repeat.
- **57 measurements, 4,606,704 measured requests, all OK.** Every compressed ghz
  report was independently re-read for SHA-256, status and count verification.
- Both binaries passed complete 4,102,798-block payload verification, 2,000
  seeded unary hashes and supported published compatibility cases before timing.
- The 128-client throughput, range/single-block p95, memory, and per-pair
  improvement gates passed. Range128 median p95 increased from 0.556283 s to
  0.571452 s, within the declared 5% allowance.
- Maximum sampled anonymous memory was 835.04 MiB for the focused baseline and
  927.81 MiB across the complete candidate matrix. Both used the same 2 CPU /
  2 GiB service ceiling. Different scenario histories can affect retained
  allocator memory; file-cache charges are reported separately.

| Repeat | Baseline download | Candidate download |
| --- | ---: | ---: |
| 1 | 22.920197 s | 21.803666 s |
| 2 | 23.369088 s | 21.186483 s |
| 3 | 21.789863 s | 21.125028 s |

The historical 32.28-second baseline was not used to attribute improvement:
the unchanged previous binary itself ran faster in this new window. External
Ztreamer figures still come from different machines and a broader wallet service.

## Implementation and validation

The optional `buffered-range-reads` Cargo feature uses a 64 KiB request-local
range buffer and one initial seek, with zero read-ahead for singleton lookups.
Manifest validation establishes contiguous offsets. Length, checksum,
decompression, protobuf identity and indexed-header checks remain per record.
Default builds retain direct reads and per-record seeks.

The measured prototype was built before the path was placed behind this
experimental feature. Its exact binary hash remains in the published summary;
enable the feature to reproduce the experimental algorithm from the final source.
The ordinary release was rebuilt afterward without the feature.

Default tests: **146 passed**. Feature-enabled tests: **147 passed**, including
cross-buffer refill, corrupted prefix/payload, full-data follower, rollback,
independent ranges, cancellation and truncated stream coverage. Clippy with the
diagnostic and experimental features, formatting and the docs production build
passed. Tests using controlled forks are not observations of a natural reorg.

The opt-in `compact_read_profile` diagnostic measured one synchronous replay
before/after: 20.919792 s / 10.747446 s, with record I/O 7.602480 s / 0.487902 s.
These instrumented timings exclude admission and network work. They guided the
candidate choice but are not gRPC latency claims.

The [published chapter](https://zeer.endpx.cloud/docs/prep/benchmarks/#buffered-read-experiment--24-october)
and [summary](../apps/docs/static/benchmarks/2026-10-24-prep-buffered.json) retain
the failed promotion gate. Run `node apps/docs/scripts/verify-compact-benchmarks.mjs`
to recompute the summary checks, or use the
[paired reproduction guide](../benchmarks/prep/compact-serving/README.md).
Raw per-request evidence remains local under the dated benchmark results.

No hosted Prep engine, Chef runtime, wallet, or settlement process was changed.
The static documentation release was verified against all 45 public HTML pages;
the experimental JSON artifact matched its local source. All owned benchmark
units stopped after completion. Further work should measure transport/client
costs before stacking additional storage optimizations.
