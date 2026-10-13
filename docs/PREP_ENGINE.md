# Zeer Prep: bounded historical range engine

Implementation authorization: user requested work toward Zeer Prep on 2026-10-13.
This document owns Prep's first engine contract. The earlier TypeScript/GraphQL
proposal belongs to Zeer Chef and is not this engine's architecture.

## First vertical slice

1. Read a specified historical range through a lightwalletd-compatible source.
2. Check network, predecessor and an explicitly expected terminal block hash.
3. Store the pinned-schema compact-block representation as a sequential segment.
4. Publish the manifest only after every block and terminal anchor passes.
5. Serve requested subranges through the experimental `zeer.prep.v1.Prep` gRPC
   service, with bounded batches and a required dataset identity.

Rust is the implementation language. Storage is separated from transport so a
future HTTP/binary experiment can reuse the engine. gRPC is the initial test
transport, not a claimed source of superior speed. No HTTP, Arrow or Cap'n Proto
implementation is implied by the comparison with HyperSync.

## Storage and consistency

- One immutable snapshot directory contains a length-prefixed segment and a
  manifest with range, anchors, offsets and integrity checksums.
- Import accepts ascending, contiguous heights with matching parent hashes.
  Explicit bounds constrain block count, individual payload and total bytes.
- Validation failures before publication never publish a manifest. After the
  atomic publication step, an I/O failure during directory sync or cleanup has
  an ambiguous outcome: inspect/reopen the existing snapshot before retrying.
  Existing output is not overwritten. An incomplete directory is retained for
  diagnosis; retry in a new directory. Ingestion restart from an incomplete
  snapshot is not implemented.
- Store opening verifies the committed data before serving. Segment integrity
  and source anchor agreement establish consistency with the chosen provider;
  they do not establish independent full-node consensus or proof verification.
- Every range request binds its start/end to a dataset ID. Clients resume at
  `next_height` only against the same dataset. The server rejects other dataset
  IDs and out-of-bounds requests.
- No automatic live following or reorg rollback is implemented in this slice.
  An old snapshot remains a historical capture and can become stale. Consumers
  must revalidate canonical anchors before treating historical data as current.
- Local store ownership is trusted. The operator must not mutate a served
  snapshot. Checksums do not authenticate a malicious store owner or provider.

## Data and privacy

The preserved projection is the pinned upstream CompactBlock schema, including
its represented Sapling/Orchard/other declared fields. Protobuf decoding does not
promise preservation of future unknown fields. The prototype does not advertise
universal protocol-upgrade compatibility, arbitrary field filtering, a full
transaction archive, transparent-address history or wallet compatibility.

No viewing/spending key is accepted. Prep does not trial-decrypt notes, read
private memos or construct wallet state. A successful payload round-trip is not
proof that a wallet can sync or spend using this service.

## Resource and deployment boundaries

Initial supported write/test target: Linux. Read-only local gRPC serving is a
development profile, with explicit opt-in for non-loopback binding. It is not a
public authenticated production deployment. Source HTTPS must verify its
certificate; plaintext remote sources require explicit opt-in.

Keep existing shared-VPS applications untouched. The previously authorized
aggregate experimental envelope remains 3 CPU / 8 GiB RAM / 40 GiB incremental
disk, including source, build, server and client work. Run build and measurements
separately if their combined limits would exceed that envelope. No paid hosting
upgrade or public port exposure is needed.

## Acceptance and evidence

- Durable close/reopen and exact subrange reconstruction.
- Reject missing, duplicate, out-of-order, broken-parent, truncated and corrupted
  data; never expose a partially written snapshot.
- Real gRPC round-trip, invalid dataset/range rejection and bounded batching.
- Import failure tests with a controlled upstream, clearly identified as test
  fixtures rather than chain evidence.
- A bounded real-chain capture, when available, including source/version, range,
  block anchors, payload counts and correctness results. Public-provider trust
  is disclosed separately from locally validated-node evidence.
- Any serving benchmark must return equivalent output and identify preparation
  costs, cache state, transport, client implementation and network placement.
  A remote source versus local cache is not an isolated engine-speed comparison.

## Next engine gates

After the first slice, measure modern shielded bulk retrieval against existing
services on equivalent outputs; profile disk, encoding, transfer and client
decoding separately. Use results to decide batching, compression or storage
changes. Live following, reorg-aware dataset publication, scalable query indexes,
public-service authentication and polished SDK/CLI packaging need separate
implementation and evidence. Chef remains the later application layer.

## Developer commands

Use Linux or WSL with the pinned Rust toolchain; protobuf compiler binaries are
provided by the build dependency. This internal executable is not a published
npm package or polished product CLI.

```sh
cargo test --workspace --locked
cargo build -p prep --locked

# First obtain the terminal hash through an independent read of the chosen source.
# The directory's parent must exist; the output leaf must not already exist.
target/debug/prep import --source https://zec.rocks:443 --network mainnet \
  --start 2700000 --end 2700255 \
  --expected-end-hash 000000000102414eebc037d5bd2b7ac5dba0edd03a4102f69c9ac462e66c7b52 \
  --out /path/to/new-snapshot
target/debug/prep inspect --dataset /path/to/new-snapshot
target/debug/prep serve --dataset /path/to/new-snapshot
```

The sample anchor identifies a historical capture, not the current mainnet tip.
Source verification, endpoint status and canonicality must be checked for each
new use. See [reference capture and verification](../benchmarks/prep/README.md).
