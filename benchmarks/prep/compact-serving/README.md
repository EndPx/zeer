# Compact-block serving comparison

This profile reproduces the **compact retrieval subset** of
[pearl-max468/zcash-indexer-bench](https://github.com/pearl-max468/zcash-indexer-bench/tree/b01dab9df6256185e9c96fac96286b9d41f1c7ce).
It runs Prep only. Zaino and Ztreamer figures, when shown in a local report, come
from that pinned publication. They were collected on different hardware.

This is a prepared, immutable archive benchmark. It does not measure public HTTP
queries, Chef processing, live ingestion, note decryption, or wallet scanning.
The “full wallet download” scenario downloads compact blocks; it does not run a
wallet, decrypt notes, or construct witnesses.

## Matching the workload

| Property | Profile |
| --- | --- |
| Network and frozen tip | Zcash testnet, 4,382,897 |
| Download range | 280,000–4,382,797 inclusive: 4,102,798 blocks |
| Protocol | Unchanged lightwallet protocol v0.5.0, one `CompactBlock` per gRPC message |
| Projection | Shielded-only; original transaction positions and encrypted note fields retained |
| Unary latency | 1,000 measured requests after 50 warmup requests |
| Range latency | 100 / 1,000 / 10,000 / 100,000 blocks; 1,000 / 300 / 100 / 10 measured requests after two warmups |
| Scaling | 1 / 8 / 32 / 128 clients, one connection each, 30 seconds per workload |
| Scaling workloads | Single blocks and 1,000-block ranges |
| Download | 411 consecutive requests of at most 10,000 blocks |
| Repeats | Three; report the median of each run's statistic and retain the individual runs |
| Timing unit | Seconds |

The request schedule uses the reference's seed-derived 2,000 heights and range
stride `2654435761`. Preserve ghz's warmup and total-duration conventions. Do not
substitute a short, mostly empty range or count failed requests as downloaded
blocks.

## Prepare and verify

Build Prep and the optional capture importer:

```sh
cargo build --release -p prep --bin prep --example import_compact_frames
```

Acquire the fixed compact history before timing. The native `prep import`
command supports `--shielded-only`; use bounded source requests and independently
check their starting predecessor and terminal block hashes. For a separate
Python capture, `import_compact_frames` accepts a stream of four-byte
little-endian lengths followed by protobuf payloads. It enforces exact heights,
links, boundary hashes, frame limits, and EOF through Prep's checked writer.

Place segments under `ARCHIVE/segments/`, then register them in height order:

```sh
prep compact-archive-append --archive "$ARCHIVE" --network testnet \
  --from 280000 --segment segments/s000 --segment segments/s001
# Supply all remaining segments as further --segment arguments.
prep archive-inspect --archive "$ARCHIVE"
prep serve-compact --archive "$ARCHIVE" --listen 127.0.0.1:39479
```

The capture used for this study consists of 42 segments of at most 100,000
blocks. Public-source retrieval used 10,000-block requests after the provider
reset larger streams. Those acquisition calls are outside serving timings.
Materialization from a remote capture is not comparable to a competitor's
index build from local node state.

The included `capture.py` performs that separate capture and checked import,
one segment at a time. It uses TLS for the public compact source and a loopback
connection to an **existing** Zebra node to cross-check boundary hashes. It
does not start a node. Keep the RPC cookie in an owner-only file and never put
it in a command argument or evidence report:

```sh
for i in $(seq 0 41); do
  /path/to/venv/bin/python benchmarks/prep/compact-serving/capture.py \
    --root /path/to/prepared-study --generated /path/to/generated \
    --importer /path/to/import_compact_frames --segment "$i" \
    --rpc-url http://127.0.0.1:18232 --rpc-cookie /path/to/private/rpc.cookie
done
```

After obtaining the reference height list, derive the expected digests with
`python benchmarks/prep/compact-serving/expected.py --root /path/to/prepared-study`.
Failed captures remain available for diagnosis; a retry never appends their
partial bytes to a completed segment.

Before timing, verify all of the following:

1. Vendored protobuf files match the reference byte for byte.
2. Captured frames match stored segment checksums and independently observed
   boundary block hashes. This checks source agreement, not consensus validity.
3. Every seeded unary payload matches its captured deterministic protobuf hash.
4. The supported published compatibility cases match their payloads/digests.
5. The complete 4,102,798-block stream has ordered heights and matches both
   per-chunk and whole-stream SHA-256 digests. The reference digest encoding is
   **eight-byte big-endian payload length + deterministic protobuf**; it differs
   from the on-disk four-byte little-endian framing.

## Run the serving schedule

`run.py` is the parameterized controller used for this profile. It requires
Linux, systemd, a non-root service account, ghz 0.121.0, and Python with the
dependencies in `benchmarks/requirements-grpc.txt`. Generate Python bindings for
the pinned lightwallet protocol as described in `benchmarks/proto/README.md`.

Its input directory contains `archive/`, `expected.json`, and `reference/`.
The reference directory contains `service.proto`, `compact_formats.proto`, the
original `data-heights.json`, and the published compatibility JSONL renamed
`published-compat.jsonl`. `expected.json` contains `lower`, `upper`, `tip`,
`blocks`, seeded `samples` (height to payload SHA-256), ordered `chunks`
(`start`, `end`, `blocks`, `digest`), and the whole-stream `digest`. Construct
these expected hashes from the verified capture, before querying Prep.

```sh
sudo /path/to/venv/bin/python benchmarks/prep/compact-serving/run.py \
  --root /path/to/prepared-study --output /path/to/new-results \
  --binary /path/to/prep --ghz /path/to/ghz \
  --generated /path/to/generated --user benchmark
```

The controller creates uniquely named transient units. It stops each owned unit
after its repeat, including failures. Default server affinity is CPUs 0–1 with
a two-CPU quota, 2 GiB memory limit, and no swap; the client uses CPUs 2–3.
The controller itself uses CPU 5 (override `--controller-cpu` on a smaller
machine). It preserves losslessly compressed raw ghz results, their checksums,
all request status counts, per-scenario CPU time, sampled cgroup memory, and
the complete environment and argument list. An existing output directory is
rejected. Ensure sufficient physical free space before running.

The cache profile is warm: a full verification precedes measurement; OS caches
are not dropped. Each repeat starts a new Prep process. Cgroup file-cache
accounting can differ between repeats because pages were charged to an earlier
unit; report anonymous memory separately and do not interpret cgroup totals as
an independent cold-cache test.

## Compare a read-path optimization

Pass `--baseline /path/to/previous-prep` alongside `--binary /path/to/candidate`
to run both versions sequentially on the same machine. Each binary first passes
the complete payload verification. The candidate receives all 16 scenarios in
each of three repeats. The baseline receives the full download, 1,000-block
ranges with 128 clients, and single blocks with 128 clients. The per-repeat
order alternates. Reports retain separate binary hashes and variant labels;
this mode produces 57 measurements. Keep both binaries built without diagnostic
features and record acceptance thresholds before measuring.

To inspect checked read costs independently of network timing:

```sh
cargo build --release -p prep --features admission-profile --example compact_read_profile
target/release/examples/compact_read_profile "$ARCHIVE" 280000 4382797
```

Admission is outside the diagnostic timer. Store phases count every checksum
and integrity decode. Top-level durations use seconds; nested native phase
counters use nanoseconds. Instrumentation adds overhead; these synchronous
diagnostics are not gRPC latency or a replacement for the serving schedule.

The optional **experimental** `buffered-range-reads` Cargo feature enables a
request-local 64 KiB buffer and one initial seek for sequential ranges. Build
with `cargo build --release -p prep --features buffered-range-reads` to evaluate
it. It is disabled by default: the 24 October experiment improved full-download
median time by 7.56%, below its predeclared 10% promotion gate. Default builds
retain direct reads and per-record seeks. Enable both `admission-profile` and
`buffered-range-reads` when profiling the experimental path.

Singleton reads use no read-ahead. Manifest validation establishes contiguous
offsets; prefix lengths, payload hashes and decoded identity checks still run
for every returned record. A range can retain prefetched snapshot bytes while
an external process changes a file; every returned byte must still match the
admitted manifest. Fresh requests continue to check files and integrity.

## Scope and resource limits

`serve-compact` supports height-based `GetBlock`, forward `GetBlockRange`,
`GetLatestBlock`, and snapshot metadata via `GetLightdInfo`. It limits each range
to 100,000 blocks, active readers to eight, queued readers to 128, queue wait to
30 seconds, and connections to 128 with one HTTP/2 stream per connection.
Internal handoffs batch at most 64 blocks or 4 MiB; wire messages remain single
blocks. Interrupted ranges end with an error, not successful partial EOF.

Other wallet RPCs, hash-only lookup, explicit pool selection, reverse ranges,
transparent address history, tree state, mempool, and live tip following are
outside this profile. `GetLatestBlock` means the **archive tip**, not a fresh
network observation. Do not advertise this service as a complete lightwalletd
replacement. The endpoint is unauthenticated and loopback-only by default.

Keep results local under `benchmarks/results/` or another ignored evidence
directory. Publish a comparison only with provenance, hardware, version,
resource, preparation, and compatibility differences visible beside the table.
Matching payloads and schedules permits a workload comparison; it does not
isolate an implementation speedup across different machines.
