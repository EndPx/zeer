# Prep: admitted transaction indexes and direct public metadata

Executed 14 October 2026, Asia/Jakarta. Prep now derives a bounded immutable
transaction-ID index and public metadata cache while admitting a full segment.
The archive format and existing query/cursor contract remain compatible. New
size/input/output-count fields avoid transferring complete decoded transactions.

## Results on the same archive

The existing 1–2048 archive contains 16,962 transactions. Three cases run in five
cyclic rounds: the previous binary with decoded fields, the new binary with
identical decoded fields, and the new binary selecting direct metadata. Every
case performs one verified warmup and one measured pass for headers, all
transaction metadata, and the same 128 selected transaction IDs.

All **45 measured passes and 45 warmups passed complete output equality** against
the independent retained oracle. The final normalized seven-field transaction
projection is the same for every case. Times are milliseconds for the entire
workload, including all page requests, decoding, normalization and ordering;
verification and source admission are separate.

| Workload | Previous binary, decoded | New binary, same decoded fields | New binary, direct metadata |
| --- | ---: | ---: | ---: |
| All 2,048 headers | 19.441 ms | 22.138 ms | 19.148 ms |
| All 16,962 transaction metadata rows | 1,569.411 ms | 1,571.915 ms | **154.974 ms** |
| Same 128 selected transaction IDs | 437.477 ms | **42.940 ms** | **16.612 ms** |

For sparse lookup, identical wire fields and byte counts improve **10.188×** with
the new binary. Selecting direct metadata improves the same normalized task
**26.334×** relative to the previous decoded path. For the complete transaction
metadata projection, direct fields improve **10.127×**; requesting full decoded
transactions remains approximately unchanged, as expected.

The full metadata workload transfers **78,110,289 bytes** using decoded objects
and **3,352,249 bytes** using direct metadata: **95.71% less HTTP response body
data**. Sparse response bodies are respectively 312,733 and 36,410 bytes.
This reduction is explicitly a projection change; it is not attributed solely
to faster index lookup. Header field selection is identical in all three cases;
its observed ranges overlap, and no header-speed improvement is claimed.

Five observations on a shared VPS do not establish universal speed factors.
These values are not pooled with the earlier external-provider session and do
not form a new same-session ranking against CipherScan or wallet services.

## Implementation and compatibility

The derived cache is **in memory**, rebuilt at startup from integrity-checked
immutable segment payloads. No persisted sidecar, archive migration, new database
or changed manifest is required. Metadata extraction streams the decoded JSON
instead of materializing a second complete JSON tree. It stores exact public
integers, raw-hex byte length, array counts, pool-presence flags and transaction
locations. The sorted transaction-ID index retains all duplicate occurrences.

Limits are **16 MiB per segment / 64 MiB per archive snapshot**, accounting for
allocated vector capacity, index structure and Arc header. Refresh reserves
reused caches before admitting new ones. Old snapshots can coexist, so these are
not global process-memory limits. Unsupported/malformed metadata or exhausted
budgets disable the optional index for the whole segment. An unindexed overlapping
segment causes payload fallback rather than an incorrect indexed absence result.

Metadata-only reads avoid full payload reads. ID-filtered requests load payloads
only for matching block positions when the block selection permits it. Requests
for raw or decoded blocks still return every block independently of transaction
filters. Scanned-block limits, empty-page advancement, canonical order, response
byte limits and cursor epoch/boundary checks remain unchanged. Consecutive slow
fallback blocks reuse the previous sequential range-reader behavior.

The new fields are `size_bytes`, `transparent_input_count`, and
`transparent_output_count`. Defaults and old fields remain unchanged. The updated
SDK validates these bounded numeric fields and rejects unknown/duplicate selected
fields before transport. A live SDK stream checked all **16,962 records across
16 pages** against the same oracle.

## Admission and resources

Both private servers ran with 1 CPU / 2 GiB each. The shared client/controller
ceiling was 1 CPU / 1 GiB: aggregate **3 CPU / 5 GiB**, with the full node stopped.
The archive was mounted read-only and its catalog hash remained unchanged.

Observed container-start-to-ready times were 0.541 s for the previous binary and
0.541 s for the new binary. There is only one observation per binary, sequential
startup and retained OS cache, so this is not evidence of equal cold-start cost.
The derived cache's startup work is excluded from query timing and must be
included when evaluating a deployment that frequently restarts.

Recorded server cgroup memory peaks were 59,940,864 bytes (previous) and
53,325,824 bytes (new). These include shared-page-cache accounting and startup;
the new server also serves twice as many query cases. They are operational
observations, not isolated cache size, heap usage or a memory-efficiency ranking.
Both remained within their configured limits without recorded OOM events.

## Correctness and live proofs

Linux validation passed **88 Rust tests**, formatting, Clippy with warnings denied,
and the release build. The SDK passed **15 tests** and the retrieval harness
passed **11 tests**. The reorg wrapper has three additional offline self-tests.
Regressions cover fast/slow output and pagination equivalence, duplicate IDs,
empty/no-hit selection, malformed-index fallback, budgets, append/cache reuse,
replacement without stale synthetic IDs, whole-block response limits, and
retention of requested raw/decoded block projections.

Three genuine historical NU5 fixture blocks, containing **17 v4/v5 transactions**,
passed direct metadata, repeated-ID filters, Sapling/Orchard presence filters and
equality with raw-block fallback. This is fixture replay using retained genuine
chain data, not a newly synchronized mainnet node or independent proof validation.

A copied peerless Zebra Regtest node then replaced two blocks and appended a new
block, advancing **1043 → 1044**. Prep's epoch advanced **0 → 1**, the old metadata
cursor returned **409 REORG**, and full metadata plus old/new ID-filtered results
matched the node's canonical locations. All five old coinbase IDs were reused
on the canonical chain, so **zero unique old IDs disappeared in this live test**.
It proves canonical branch/cursor/append handling; orphan-ID removal is covered
by the separate synthetic replacement test, not inferred from this live run.

Two initial proof setup attempts are retained: a node image entrypoint failed
directory creation before mutation, then a retry encountered the already-created
internal network. The successful recipe uses the previously validated explicit
node user/entrypoint/config and checks/reuses the internal network. No performance
samples were selected from those setup failures.

All owned experiment containers were stopped and the five existing application
services remained active. No public API deployment, paid upgrade, viewing-key
access or whole-chain performance claim was added.

## Evidence

- [Execution/source manifest](../raw/2026-10-14-prep-index/execution-manifest.json).
- [45-pass comparison and admission/resource observations](../raw/2026-10-14-prep-index/compare/comparison.json).
- [Rust gates](../raw/2026-10-14-prep-index/rust-validation.txt),
  [SDK tests](../raw/2026-10-14-prep-index/sdk-tests.txt), and
  [live SDK result](../raw/2026-10-14-prep-index/sdk-live.json).
- [Modern metadata fixture](../raw/2026-10-14-prep-index/live/modern-metadata.json).
- [Actual-node metadata/reorg proof](../raw/2026-10-14-prep-index/live/index-reorg.json)
  and [raw branch proof](../raw/2026-10-14-prep-index/live/index-reorg.raw-reorg.json).
- [Host comparison recipe](../../prep/full/index_compare.py),
  [live recipe](../../prep/full/index_live.py), and
  [metadata reorg verifier](../../prep/full/index_reorg.py).
