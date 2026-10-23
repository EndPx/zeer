# Prep first-slice correctness evidence

This is a historical snapshot round-trip test. It does not rank Prep against
other indexers or claim wallet scanning performance.

The fixed public mainnet range is 2,700,000 through 2,700,255. The Python capture
is independent of Prep's Rust importer, but both trust the same upstream
provider. It checks network, linked heights and stable terminal hash, and saves
all pinned-schema compact-block fields as length-prefixed protobuf frames.
Endpoint discovery: [Zingolib's documented default](https://github.com/zingolabs/zingolib)
is `https://zec.rocks:443`; TLS verification is required. Availability and served
software versions are observations at capture time, not guaranteed constants.

## Reproduce

Install Python dependencies from `benchmarks/requirements-grpc.txt`. Generate
the pinned upstream bindings as described in `benchmarks/proto/README.md`, then
generate the native Prep bindings into the same ignored output directory:

```sh
python -m grpc_tools.protoc -I crates/prep-proto/proto \
  --python_out=/path/to/generated --grpc_python_out=/path/to/generated \
  crates/prep-proto/proto/prep.proto
export PYTHONPATH=/path/to/generated
python benchmarks/prep/capture.py --output /path/to/new-reference
```

The captured `modern-source.json` supplies the independently fetched terminal
hash for the Rust importer. Use the commands in `docs/PREP_ENGINE.md`, then run:

```sh
python benchmarks/prep/verify.py --reference /path/to/new-reference \
  --endpoint 127.0.0.1:39367 --output /path/to/new-result.json
```

The verifier intentionally uses plaintext only for the local/private benchmark
server. Do not expose that endpoint publicly. It verifies every normalized
CompactBlock, full range, split/resumed subranges, dataset identity and error
codes, followed by unchanged dataset metadata. Unknown future protobuf fields
are outside the pinned-schema preservation claim.

One warmup and five local reads provide a timing observation including client
decoding and cursor checks. Reference equality is checked after each timer.
Public-source fetch timing and local serving timing have different network and
preparation boundaries and must never be presented as a speedup ratio.

For the separate multi-segment lightwallet retrieval profile and the pinned
Zaino/Ztreamer workload schedule, see
[compact serving](compact-serving/README.md). Its wallet-download scenario only
downloads compact blocks; it does not measure wallet scanning or Chef.
