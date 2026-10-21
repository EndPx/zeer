# Prep versus Zebra RPC

This harness compares **warm public-data retrieval** from a prepared Prep archive with native Zebra RPC methods. It checks every returned row, not just result counts. It does not benchmark Chef, shielded decryption, cold storage or node initial sync.

The recorded 21 October 2026 run uses Zcash Testnet blocks **4,522,544–4,522,799 inclusive**: 256 blocks and 531 transactions, including non-coinbase transparent activity, two Sapling transactions, two Orchard transactions and 181 Ironwood transactions. A transaction may use multiple components. The range was selected before timing: the latest aligned, smallest 256/512/1024-block window with a match for each component in the discovery interval `[4510000,4524000)`.

## Reproduce

Use Python 3.10+ and a synchronized Testnet Zebra node with historical transaction lookup and the transparent address index enabled. Native Prep must support `full-v1` archives, adaptive HTTP queries and the selected public transaction fields. Run from the repository root. `prepare.py` requires Linux or WSL for resource accounting.

Keep RPC credentials in a local cookie file. The commands below use an example loopback endpoint; replace it with your node's credential-free URL. Cookie authentication is restricted to private IP endpoints. Put generated files in an ignored local directory.

```bash
export BENCH_RPC_URL=http://127.0.0.1:18232
mkdir -p .deploy-local/prep-rpc-reproduction

python3 -m benchmarks.prep.rpc.compare capture \
  --rpc-cookie-file /path/to/zebra/.cookie \
  --from-block 4522544 --to-block 4522800 \
  --manifest .deploy-local/prep-rpc-reproduction/reference.json

python3 -m benchmarks.prep.rpc.prepare \
  --binary /path/to/prep --rpc-cookie-file /path/to/zebra/.cookie \
  --from-block 4522544 --to-block 4522800 \
  --archive .deploy-local/prep-rpc-reproduction/archive \
  --out .deploy-local/prep-rpc-reproduction/preparation.json
```

Start a read-only Prep server against that archive in another terminal. Set `PREP_API_TOKEN` locally in both terminals to the same value; it is never printed by the harness.

```bash
/path/to/prep serve-http \
  --archive .deploy-local/prep-rpc-reproduction/archive \
  --listen 127.0.0.1:39487
```

Then run the paired measurements:

```bash
export BENCH_PREP_URL=http://127.0.0.1:39487
python3 -m benchmarks.prep.rpc.compare run \
  --rpc-cookie-file /path/to/zebra/.cookie \
  --manifest .deploy-local/prep-rpc-reproduction/reference.json \
  --out .deploy-local/prep-rpc-reproduction/results.json \
  --rounds 3 --workers 4 --timeout-seconds 90

python3 -m unittest benchmarks.prep.rpc.test_compare benchmarks.prep.full.test_retrieval -v
node apps/docs/scripts/verify-benchmarks.mjs
```

Use new output paths for each trial. A failed run retains its partial samples and receives `FAIL`; the harness does not retry timed source requests. Before comparing to the published reference, check the boundary block hashes: an intervening reorg may make that historical snapshot inapplicable. Capturing again is a new dataset, not a reproduction of the old one.

## Equivalent work

| Workload | Prep | Zebra RPC |
| --- | --- | --- |
| Headers | Project four header fields | `getblockheader(height)` per block |
| All transaction metadata | Project eleven transaction fields | `getblock(height,2)` per block, then project |
| 16 selected TX IDs | Batched `txids` filter | `getrawtransaction(txid,1)` per ID |
| Transparent output address | `transparent_output_addresses` filter | `getaddresstxids` for the range, then `getrawtransaction` and output-only filtering |
| Sapling, Orchard, Ironwood | Separate public component filters | Decoded blocks, then the same component-presence predicates |

Header fields are `height`, `hash`, `previous_hash`, `time`. Transaction fields are `txid`, `block_height`, `version`, `locktime`, `is_coinbase`, transparent input/output counts, Sapling spend/output counts, Orchard action count and Ironwood action count. Both paths return identical normalized rows. The pool workloads observe public components; they do not decrypt note values, receivers or memos.

The reference records every expected row and its SHA-256 digest. It is captured from decoded Zebra blocks, checks linked headers and hashes the raw boundary headers. IDs include each pool and an ordinary transparent transaction, then lexically selected IDs until sixteen. The address is the most frequent observed transparent output address, with a lexical tie-break. These choices occur before timing. Address results include only transactions **paying outputs to** that address, not all activity involving it.

## Timing and counters

Each of seven workloads has one verified warmup for each candidate, then three measured pairs. Candidate order alternates with workload and round index. Zebra uses up to four concurrent persistent HTTP connections and individual JSON-RPC requests, without JSON-RPC batch envelopes. Prep follows adaptive cursors with one in-flight page. Neither adapter caches results between workloads; both benefit from warm OS and server caches. No caches are cleared.

Wall time includes request dispatch, response reads, JSON decoding, projection and ordering. Exact-row equality and digest verification happen after the timer. Fresh source-boundary checks happen before and after each measured retrieval and are excluded from the reported request/byte totals. The timeout applies to the whole retrieval, including response bodies and normalization. HTTP body bytes include actual RPC envelopes and overfetch, exclude HTTP/TLS headers and use identity encoding. Both candidates' rows and digests must match the frozen reference.

Native archive preparation is a separate, **single** run from an already synchronized warm node. Its timer covers process spawn through observed exit, including fetching, normalization, compression and persistence. It records child CPU, sampled RSS and archive file bytes. Verification is timed separately. Source discovery, reference capture and node initial sync are excluded; RPC requests are not instrumented during direct preparation. An earlier reverse-proxy diagnostic added overhead and is not used as the native preparation result.

## Recorded environment and interpretation

The shared VPS had an aggregate Zeer limit of **3 CPU quota / 8 GiB**. Zebra's service ceiling was **2 CPU / 4 GiB**, the frozen Prep reader **0.5 CPU / 1 GiB**, and the benchmark client **0.5 CPU / 1 GiB**. Production followers remained active under the shared parent limit. These are unequal ceilings, not dedicated cores or equal hardware allocations. Locality, server caching, workload density and scheduling affect the measurements. This is a bounded service-path comparison, not an engine ranking or a claim about every RPC strategy.

The final run favors Prep for headers, full metadata and pool filters. Zebra is faster for the selected TX IDs. The address lookup winner changes between the preliminary and final trials, so it has no stable ranking here. Both complete trials are retained in the public report; the final trial uses the corrected absolute-deadline checks. Tiny warm loopback durations should not be read as public-internet latency or an SLA.

Public evidence:

- [Samples, medians, resources and preparation](../../../apps/docs/static/benchmarks/2026-10-21-prep-zebra-rpc.json)
- [Frozen expected rows and selection](../../../apps/docs/static/benchmarks/2026-10-21-prep-zebra-rpc-reference.json)
- [Published methodology](https://zeer.endpx.cloud/docs/prep/benchmarks/)

The scripts make read-only source calls and bound the selected range to 1,024 blocks. Preparation writes a new local archive, caps it at 1 GiB and never modifies an existing archive. Apply your own service CPU/memory limits and disk guard before running; the harness does not configure server quotas.
