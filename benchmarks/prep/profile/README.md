# Admission phases and optional index boundaries

This opt-in diagnostic executes the ordinary fresh `Archive::open` integrity
path. The `admission-profile` feature adds per-record timers and a thread-local
reduced archive-budget override active only inside `profiling::open`. It never
changes the 64 MiB archive or 16 MiB segment release constants, admits a higher
budget, skips integrity, or persists an index. Build ordinary measured server
binaries without this feature. Profile admission times include instrumentation
overhead; compare phase fractions within this instrumented build and retain the
ordinary `archive_profile` measurements for uninstrumented timing.

Profiles also support archives with optional [disk metadata sidecars](../../../docs/PREP_DISK_INDEX.md).
Each admitted segment reports `index_kind` (`memory`, `disk`, `payload`), so
`allocated_index_bytes` distinguishes retained row arrays from disk descriptors.
`optional_disk_verify` measures source-to-sidecar verification; full source checks
remain enabled. Compare sidecar-free and sidecar copies with identical catalog,
payload and metadata digests, using alternating fresh opens under the same CPU
and memory limits. Report the sidecar build cost and bytes separately. A reduced
RAM budget is a counterfactual, not a release configuration. The synthetic
archive-cap fixture additionally demonstrates the actual default-budget boundary.

```sh
cargo test --locked -p prep-store --features admission-profile --lib -j 2
cargo build --release --locked -p prep-store --features admission-profile \
  --example admission_phases --example admission_fixture -j 2
python3 -m unittest benchmarks.prep.profile.test_run
```

Run commands below from the source root. Use a new ignored output for each run.
The operator must enforce the existing resource envelope externally. For example,
run one profile harness in a systemd cgroup with `CPUQuota=100%`, `MemoryMax=2G`,
`MemorySwapMax=0`; build separately within 2 CPU / 3 GiB. The harness runs one
process at a time, has no network, and never starts a node or server. Neither
the harness nor the binary changes the archive. Prefer a read-only bind mount
of each admitted archive for additional filesystem enforcement.

For every real immutable 2,048 / 8,192 / 32,768 archive, use the exact archive
and oracle identities already admitted by the scale rehearsal. This diagnostic
checks budget equivalence and independent field extraction from stored payloads;
retain the existing external node-oracle/API comparison as the separate source
correctness evidence.

```sh
systemd-run --wait --pipe --collect \
  --property=CPUQuota=100% --property=MemoryMax=2G --property=MemorySwapMax=0 \
  --working-directory="$PWD" \
  python3 -m benchmarks.prep.profile.run \
  --archive "$archive" --binary "$PWD/target/release/examples/admission_phases" \
  --budgets 0,1048576,4194304,8388608,16777216 \
  --out "$PWD/benchmarks/results/admission-real-32768" --rounds 3
```

The default visit plus reduced-budget visits alternate order in three fresh
process rounds. Reduced-budget real-data results are counterfactuals, not evidence
that the real archive naturally reaches the default budget. Each process reports:

- Disjoint cumulative catalog, reference-manifest, store-manifest, manifest-hash,
  record-I/O, payload-hash, integrity-decode, segment-hash, optional-protobuf-decode,
  optional-metadata-build, and optional-index-finish phases. Integrity decoding
  includes mandatory protobuf and JSON validation. Optional metadata build
  includes JSON parsing/row construction; finish includes secondary-index sort.
  Some allocation/drop/path/reference comparison work is unassigned. These are
  elapsed times, not CPU samples; per-record clocks add overhead.
- Per-segment available archive budget and retained allocation; indexed and
  fallback block counts; raw `/proc/self/status` immediately after admission.
  Peak RSS in that snapshot excludes later verification, but includes the open
  process lifetime. RSS is broader than index bytes.
- A complete after-admission verification pass, hashing framed payloads and
  ordered metadata projections. Indexed rows must match independent extraction
  from full stored transaction JSON. Fallback uses the same independent extraction.
  The harness requires identical catalog, payload digest, metadata digest and
  transaction count at every budget. This is data-path equality, not an HTTP
  route or chain-provenance proof. Verification parses a full block JSON tree;
  modern fixtures may need more memory than the streaming admission path.

The harness prehashes every input and rehashes afterward. This intentionally warms
filesystem cache. No cold-cache or complete CPU/IO accounting claim is allowed.
It retains per-visit stdout/stderr, process wall time, binary/harness SHA-256,
timings, identities and failures in `execution.json`. Timeouts kill the one owned
subprocess; no cleanup or change to existing services occurs.

## Actual default-cap synthetic fixtures

Use Linux x86_64. These minimal JSON/full-v1 fixtures are deliberately synthetic
regtest records with repeated transaction IDs and placeholder raw bytes. They
exercise immutable store admission, not Zcash consensus or realistic workloads.
They remain under ignored results. Each fixture is bounded to at most five blocks,
1.1 million rows and roughly 170 MiB of payloads; no full-chain extrapolation.

```sh
# Prepare once, separately from timed reads, inside the same bounded cgroup.
target/release/examples/admission_fixture \
  "$PWD/benchmarks/results/synthetic-archive-cap" archive-cap
target/release/examples/admission_fixture \
  "$PWD/benchmarks/results/synthetic-segment-cap" segment-cap

python3 -m benchmarks.prep.profile.run \
  --archive "$PWD/benchmarks/results/synthetic-archive-cap" \
  --binary "$PWD/target/release/examples/admission_phases" \
  --synthetic archive-cap --budgets 0 --rounds 1 \
  --out "$PWD/benchmarks/results/admission-default-archive-cap"
python3 -m benchmarks.prep.profile.run \
  --archive "$PWD/benchmarks/results/synthetic-segment-cap" \
  --binary "$PWD/target/release/examples/admission_phases" \
  --synthetic segment-cap --budgets 0 --rounds 1 \
  --out "$PWD/benchmarks/results/admission-default-segment-cap"
```

On the measured 64-bit ABI, a metadata row is 72 bytes and its secondary entry
4 bytes. Archive-cap uses five segments of 220,000 rows each: each fits 16 MiB;
four retained indexes consume almost 64 MiB and the fifth falls back. The
harness fails unless it observes that exact topology at the unchanged default
budget. Segment-cap uses 220,000 then 221,000 rows: the first fits, the second
exceeds 16 MiB even though the archive remainder is larger than 16 MiB. The
harness explicitly checks that the archive cap does not confound this result.
Both checks require the exact generated per-segment and total row counts, one
block per segment, and the measured 72/96/8/4-byte row/fixed-index/offset/secondary
layout. The derived minimum `96 + 2*8 + rows*(72+4)` must exceed the fifth archive
remainder or the second segment's 16 MiB cap. Allocation topology alone is not
accepted as evidence of budget-caused fallback.
All projections and payloads must match the zero-budget fallback visit.

`admission_fixture NEW_PATH small` creates only 12 rows for a smoke test. The
Rust unit test `exact_minimum_budget_boundary_is_all_or_nothing` checks a
one-byte-below / exact minimum allocation admission boundary without large data.
The Unix feature test `profiling_budget_preserves_integrity_and_payloads` checks
zero-budget equivalence, timer accounting, override cleanup and rejection of a
corrupt payload even when optional indexing is disabled. Do not describe any
fixture as executed until its retained report says PASS.

## Native query cost across optional budget boundaries

`prep`'s opt-in `admission-profile` feature forwards only the store diagnostic
feature. Its `admission_queries` example measures the actual native
`prep::query::execute_query` plus response JSON serialization. It does not run
HTTP, a public server, an admission queue or a parallel workload, and changes no
engine code or release budget. Build and test separately from ordinary binaries:

```sh
cargo test --locked -p prep --features admission-profile --example admission_queries -j 2
cargo build --release --locked -p prep --features admission-profile --example admission_queries -j 2
```

Generate the six cases reproducibly from the independent node oracle and exact
immutable catalog, without using Prep query output:

```sh
python3 -m unittest benchmarks.prep.profile.test_make_cases -v
python3 -m benchmarks.prep.profile.make_cases \
  --archive /opt/zeer-scale/20261014/archives/32768 \
  --oracle /opt/zeer-scale/20261014/oracles/32768.json.gz \
  --out "$PWD/benchmarks/results/admission-native-cases-32768.json"
```

`--archive` accepts the archive root or its exact `catalog.json` path. The
producer validates the semantic catalog checksum, contiguous segment references,
the oracle's exact range and head hash, and source transaction order/counts using
the existing scale oracle loader. Captured source height may be later than the
oracle range. It requires a mainnet full archive of 384 through 32,768 blocks.
It writes a new file exclusively inside ignored results, outside its inputs,
after checking the complete output is at most 8 MiB; existing files remain intact.
Its stdout records the case-file, compressed-oracle and catalog identities.

The generated JSON case document uses this format:

```json
{
  "format": "prep-admission-query-cases-v1",
  "oracle_sha256": "64 lowercase hex characters identifying the oracle file",
  "archive": {
    "network": "mainnet", "start_height": 1, "head": 32768,
    "head_hash": "64 lowercase hex characters from the oracle head",
    "epoch": 0, "revision": 128,
    "catalog_sha256": "64 lowercase hex characters from the pinned catalog"
  },
  "cases": [{
    "name": "first_metadata",
    "request": {
      "from_block": 1, "to_block": 129, "limit": 128,
      "field_selection": {
        "block": [],
        "transaction": ["txid", "block_height", "index", "version", "locktime", "size_bytes", "transparent_input_count", "transparent_output_count"]
      }
    },
    "expected": {"blocks": [], "transactions": []}
  }]
}
```

The example values for expected transactions and hashes are placeholders; fill
them from the independent oracle and exact immutable catalog. The input carries
numeric epoch/revision; native query responses encode them as decimal strings.
Use at most six named cases, explicit ranges of at most 128 blocks, `limit:128`,
no cursor, no block fields, and exactly the eight scalar transaction fields shown.
Every expected transaction must retain all eight native JSON scalar types and
canonical block/transaction order. A sparse case adds
`transaction_filter:{"txids":["known ID"]}` and includes only matching expected
rows. The input is capped at 8 MiB and accepts no output paths or other actions.

For the real 32,768 tier, prepare metadata and sparse cases for each of
`[1,129)`, `[16385,16513)`, and `[32641,32769)`. Select a known transaction near
each window's middle for its sparse case. Run the same binary and case file in
fresh processes under the existing bounded diagnostic cgroup:

```sh
target/release/examples/admission_queries "$archive" "$cases" > "$new_default_report"
target/release/examples/admission_queries "$archive" "$cases" 16777216 > "$new_16m_report"
target/release/examples/admission_queries "$archive" "$cases" 8388608 > "$new_8m_report"
target/release/examples/admission_queries "$archive" "$cases" 0 > "$new_zero_report"
```

The shell report paths must be newly owned ignored result files; the example
itself only writes JSON to stdout. Each process runs all mandatory fresh-open
integrity checks, checks the pinned archive/head, and runs one verified warmup
plus five timed samples per case. Expected-envelope serialization, equality,
SHA-256, and indexed/fallback coverage counting occur outside the query timer.
Every serialized response must equal the supplied independent data and pinned
head/network/epoch/revision/range/progress/null-cursor envelope. Record all raw
sample times, byte counts and response hashes; per-case response hashes must
remain identical at every budget. The final report records case-file and oracle
identities, the admission profile, per-range index coverage and exact output
digests. A mismatch exits nonzero without printing a PASS report.

These are warmed sequential core-query timings from one instrumented build,
not HTTP latency or a capacity test. Inactive feature timer hooks still run on
fallback payload reads, so use only paired same-binary budget comparisons.
Retain raw variation and separate first/middle/end windows instead of pooling
unlike index coverage. The oracle hash records provenance supplied by the
operator; the example does not independently certify the oracle producer.
