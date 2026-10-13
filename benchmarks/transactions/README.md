# Common early-mainnet transaction lookup

This stdlib benchmark compares a fixed transaction projection across three
lightwalletd-protocol candidates and a PostgreSQL indexer. No Zeer engine is
implemented here. No live result is implied by the offline tests.

## Workload

Select **128 distinct pre-Overwinter v1 transactions** deterministically from
heights 1 through 2048. The parent fixture producer owns the independent oracle:
node decoded JSON-RPC fields, raw transaction bytes, and validated block
membership. This module must not be used to produce expected decoded fields.
It checks archived raw size and double-SHA-256 txid when loading the manifest,
but does not populate oracle counts or locktime with its own decoder.

The final projection is:

```text
txid
mined_height
version
locktime
size_bytes
transparent_input_count  (coinbase counts as one input)
transparent_output_count
```

Adapters reuse one connection. gRPC makes one `GetTransaction` request per ID and
decodes returned raw v1 bytes locally; SQL makes one SELECT per ID returning its
already-indexed fields. These reach the same final projection via different
backend/transport work. Describe results as native-stack transaction lookup with
client normalization, never an isolated parser/indexer-speed ranking.

One complete warmup is verified before five sequential timed repetitions. Every
field and transaction order is checked after each timer stops. Verification time
is separate. Any failed repetition or source-anchor check makes the experiment
ineligible; no aggregate median is produced for a failed experiment. Fewer than
128 transactions or five repetitions is a rehearsal, not comparison eligible.

The implemented parser accepts only pre-Overwinter **version 1**. It bounds
lengths, validates canonical CompactSize encodings, counts all transparent
inputs including coinbase, and requires exact end-of-buffer after locktime. It
rejects v2+, Overwinter flags, zero-input/witness-marker encodings, truncation,
and trailing bytes. It does not execute scripts or claim consensus validation.

## Frozen manifest contract

```text
schema_version: 1
scenario: "transaction-lookup-preoverwinter-v1"
network: "mainnet"
genesis_hash: lowercase 64-character RPC hex
end_height: fixed source head (1..100000)
end_hash: hash of that fixed source head
selection_end_height: at most 2048 and at most end_height
reference_source: {name, version, provenance}
blocks: [{height, hash}, ...]
records: [{all seven projected fields above, raw_hex}, ...]
records_sha256: canonical_sha256(records)
```

`blocks` must contain height 1, the frozen head, and every selected transaction's
height. Heights are unique. The oracle producer validates transaction membership
against actual blocks before publication and documents the selection rule and
independent decoding source in provenance. Records are in the preregistered query
order; transaction IDs are unique. Canonical hashing is sorted-key compact ASCII
JSON, UTF-8, with NaN forbidden. The report binds the entire manifest hash as well
as reference-record hash, exact Python code hash, profile and candidate versions.

The observed source head may be later than 2048; the selected transaction set
remains within that historical prefix. This distinction avoids pretending a
partially synchronized but frozen node stopped at the intended selection height.

## Preflight and active-chain anchoring

gRPC uses **only** `GetLightdInfo` and `GetLatestBlock`. Early pre-Sapling
`GetBlock` is not assumed supported by lightwalletd. The network must be mainnet
and the latest height/hash must exactly match the frozen oracle head. This check
runs before warmup and after timed repetitions. Matching the independently
validated head indirectly anchors genesis; no direct genesis compact read is
claimed. All 128 raw transaction identities, heights and fields are then checked
during warmup and every repetition.

SQL runs a read-only session. Preflight checks every manifest block hash against
the `blocks` table and requires MAX(height) to equal the frozen head. Those
independently validated block hashes indirectly anchor the expected network.
Generic adapters can receive an additional `identity_callback(manifest, deadline)`
for independent node/source checks. No source mutation is performed.

For SQL the expected schema is:

```text
transactions(txid TEXT, block_height BIGINT, version INT, locktime BIGINT,
             size INT, vin_count INT, vout_count INT)
blocks(height BIGINT, hash TEXT)
```

The query is exactly:

```sql
SELECT txid, block_height, version, locktime, size, vin_count, vout_count
FROM transactions WHERE txid = %s
```

Optional `--pg-txid-storage bytea` supports display-order bytes, not internal
reversed bytes. `--pg-block-hash-column` accepts a SQL identifier and is safely
quoted. No write SQL, table migrations or fixtures are executed by this tool.

## CLI

The pure decoder/runner needs Python 3.12+ stdlib only. gRPC adapters require the
project's pinned grpc/protobuf packages plus generated `service_pb2` and
`service_pb2_grpc` modules on PYTHONPATH. SQL requires psycopg 3; the parent owns
installation and dependency-version pinning. These libraries are lazy imports,
so offline tests do not require them.

Set `ZEER_TX_ENDPOINT` to `grpc://host:port`, `grpcs://host:port`, or the PostgreSQL
DSN in the process environment; do not put credentials into shell arguments.

```text
python -m benchmarks.transactions.benchmark --manifest benchmarks/fixtures/mainnet-transactions-v1/manifest.json --adapter grpc --candidate lightwalletd --version 0.5.5 --source-version Zakura1.5.0 --profile shared-vps-mainnet-prefix-v1 --output path/to/report

python -m benchmarks.transactions.benchmark --manifest benchmarks/fixtures/mainnet-transactions-v1/manifest.json --adapter postgres --candidate cipherscan --version 15d7f528f07a84d796ed89029de21bfb26a24d23 --source-version Zakura1.5.0 --profile shared-vps-mainnet-prefix-v1 --output path/to/report
```

JSON and Markdown reports are emitted. Exit 0 means the executed experiment
passed; inspect `eligible_for_comparison` separately for short rehearsals. Exit 1
means measured/preflight failure, exit 2 means setup/manifest failure. Errors
expose type and allowlisted symbolic codes, never third-party exception messages.
Source endpoints are reduced to scheme/host/port.

The outer timeout cannot kill an arbitrary blocked Python callable. After
TIMEOUT, remaining runs and postflight are skipped to avoid overlapping adapter
work. Exit that process before starting another candidate. Built-in gRPC and SQL
also have transport/statement timeouts. PostgreSQL statement cancellation is
currently reported as FAIL with its exception class, rather than TIMEOUT;
normalize that classification before a future timeout-focused comparison.
None of the published four-provider runs encountered this condition.
No resource-cap enforcement or Docker
operations happen in this module; the parent deployment owns those controls.

## Tests

```text
python -m unittest discover -s benchmarks/transactions -p "test_*.py" -v
```

The fixtures are explicit synthetic bytes, not claimed chain data. Tests cover
all truncation prefixes, invalid flags/versions, coinbase counting, CompactSize,
script-length corruption, oracle corruption, missing/duplicate transactions,
wrong raw txid from a server, source-head changes, timeout, and exclusion of
verification cost from the lookup timer.
