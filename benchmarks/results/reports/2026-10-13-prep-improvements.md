# Zeer Prep: bounded reads and concurrent source retrieval

Executed 13 October 2026 on the existing shared Hostinger VPS. This iteration
improves the full-data prototype without changing its archive format or HTTP/SDK
contract. Chef, public hosting and npm publication remain deferred.

## Outcome

- 4,096 complete mainnet blocks, heights **1000–5095**, containing **50,283
  transactions**, were ingested into 32 segments and queried by both revisions.
- All six comparison workloads passed ordered record-count and content-digest
  equivalence, including whole decoded blocks, raw bytes and transaction data.
- An independent Python full-node verifier then checked **every block and
  transaction** in eight 512-block ranges. Raw bytes and all decoded projections,
  transaction-ID filters and transparent-output filters passed exact comparison.
- 73 Rust tests, 13 SDK tests and four benchmark-oracle tests passed. Formatting,
  Clippy with warnings denied, and the optimized release build passed. Separate
  review found no remaining actionable issues after the recorded fixes.

## Changes

1. Payload queries use the archive's existing sequential range reader, retaining
   the open segment file across adjacent blocks rather than opening a reader for
   every block. Cached header reads remain separate.
2. Large projections are sized with a bounded counting writer before copying
   decoded subtrees or encoding raw bytes as hexadecimal. Oversized blocks retain
   the existing whole-block pagination and HTTP 413 behavior. Tiny header objects
   keep their small serialization buffer.
3. Exact array-content sizes accumulate while constructing the page. The final
   size check adds serialized metadata, avoiding another traversal of the entire
   response solely to measure it. Actual HTTP serialization still occurs once.
4. Raw and decoded full-node reads run concurrently for the same resolved block
   hash. An error cancels its pending companion. The follower still handles one
   block at a time, retains source-anchor checks, and has no unbounded prefetch.

The source can have two bounded RPC responses in flight rather than one. The
query path still decodes the full stored envelope and node JSON before projection.
These changes do **not** establish a 32 MiB peak-memory limit or a measured RSS
reduction.

## Before/after measurements

Both release binaries read the **same prepared immutable archive** on the same
private network. Each server had 1 CPU / 1 GiB, and the Python client had 1 CPU /
2 GiB. The full node was stopped during this comparison. Each workload warmed
both servers, then ran five measured repetitions with alternating revision order.

The numbers below are medians of **summed HTTP request durations through JSON
decoding**. The client hashes each returned page between requests, outside timing,
and releases that page before the next request. These are not uninterrupted
wall-clock scan times and exclude ingestion, preparation and integrity checking
of returned records.

| Workload over 4,096 blocks | Previous revision, ms | Final revision, ms | Lower median duration |
| --- | ---: | ---: | ---: |
| Header height/hash/time | 42.82 | 39.51 | 7.73% |
| Raw blocks + height/hash | 2,349.95 | 2,223.39 | 5.39% |
| Transaction metadata: 50,283 records | 1,961.75 | 1,907.26 | 2.78% |
| Full block + transaction projection | 16,786.25 | 14,540.19 | 13.38% |
| Transaction-ID filter: one match | 1,749.97 | 1,714.78 | 2.01% |
| Version filter: no matches | 1,730.96 | 1,677.30 | 3.10% |

The full projection returned approximately **882.19 MiB over 34 bounded pages**:
it intentionally includes raw and decoded blocks plus duplicated transaction
projections. The other cases used 32 pages. This wire volume is larger than the
archive and is not a claim that storing these projections is necessary.

All final medians were lower, but several distributions overlap on this shared
host. For example, header runs ranged 39.00–46.09 ms before and 37.11–55.13 ms
after. Small differences are workload observations, not universal or statistically
established improvements. All individual runs are retained in
[the final comparison](../raw/2026-10-13-prep-improvements/comparison-final.json).

## Correctness evidence and findings

The source remains Zakura 1.5.0's previously frozen validated mainnet prefix:
height 6764, hash
`0000000160e11c9403141d7c2a16b07a2459919fc774795da3f687628c5ece54`.
It is not synchronized to the current public tip. The two 128-block segment
payloads from a baseline sequential ingestion were byte-identical to the same
256-block prefix from concurrent ingestion. No ingestion speedup was measured.

The initial independent verifier found a mismatch at block 2909:
`decoded.tx[1].vjoinsplit[0].vpub_old`. Its Python Decimal conversion rendered
the source token `1e-6` as `0.000001`; Prep retained `1e-6`. The verifier now
retains the original numeric token alongside Decimal's exact value. A dedicated
test covers scientific notation, long precision, trailing zeros, and unchanged
strings/booleans. All eight ranges were rerun with **strict exact comparison**;
comparison was not weakened to approximate numeric equality.

The initial development benchmark also exposed slower header medians. The final
revision restored the tiny header-sizing path and removed the redundant full
response-sizing traversal. Separately, review corrected a benchmark issue where
the previous page could remain alive and be destroyed during the next timed
request. The earlier measurements and their script are retained as development
evidence, not mixed into the final five-run table:
[development results](../raw/2026-10-13-prep-improvements/development-comparison.json).

The first build lacked the image's optional rustfmt component; temporary build
containers installed rustfmt/Clippy before passing the gates. The first ingestion
attempt also reached the source before its RPC listener was ready. Retrying after
startup safely resumed the archive. Automatic source-outage recovery remains
future work; no successful unattended retry policy is claimed.

## Reproduction and provenance

Use [the comparison instructions](../../prep/full/README.md#comparing-prep-revisions).
Start both pinned release binaries on the same read-only archive; preserve the
resource limits and source exclusion above. For independent correctness, run the
full-node verifier in 512-block chunks with fresh output directories. The verifier
also emits its pre-existing node/header timings; those are separate native-path
observations and are not combined into this before/after table.

- Baseline commit: `138f174f327bc08cc4c0968f542b367921ddd8e7`.
- Baseline binary SHA-256: `6b9158d696e96f12ba225a2a80c143f726fd6e5aef068d038c8861a9d0150132`.
- Final binary SHA-256: `07e9e917fa3990072ef2997846f5892d47c52cfc8ed6544fa241eb718f060157`.
- [Execution manifest](../raw/2026-10-13-prep-improvements/execution-final.json):
  source hashes, binary/image pins, byte-equivalent ingest checks, all eight oracle
  report hashes, resource limits, and service state.
- [Linux validation log](../raw/2026-10-13-prep-improvements/validation-final.txt).
- [First oracle range](../raw/2026-10-13-prep-improvements/oracle-final-1000/full-roundtrip.json)
  and [last oracle range](../raw/2026-10-13-prep-improvements/oracle-final-4584/full-roundtrip.json).

Experiments stayed within the existing 3 aggregate CPU / 8 GiB / 40 GiB envelope.
All experiment services were stopped afterward; the five existing application
services were still active. No public Prep port, paid upgrade, package publication
or transaction broadcast was introduced.

The demonstrated data is early mainnet, including legacy Sprout fields. It does
not establish representative modern Sapling/Orchard coverage, sustained public
live-follow, real-node reorg recovery, or million-block query performance. Those
remain the next evidence gates rather than reasons to broaden into Chef now.
