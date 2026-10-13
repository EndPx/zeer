# Genuine NU5 full-block fixture

Three contiguous historical mainnet blocks, heights **1,687,106–1,687,108**.
This is a frozen public-data compatibility fixture, not a running full node.

`fixture.json` contains complete raw blocks from
[Zebra's official test vectors](https://github.com/ZcashFoundation/zebra/tree/7121c82ba6795a151523d5b308a19743f4a1ade7/zebra-test/src/vectors),
with the resolved commit pinned in the capture. All 17 decoded transactions
were obtained from CipherScan's node-backed `/api/tx/{txid}/verbose` API.
Each requested URL, resolved URL, response SHA-256 and response byte count is
recorded in the fixture. Capture time and the collector's checks are recorded too.
Git preserves this captured file's original bytes, including its final line
ending, so the published fixture matches the SHA-256 in the executed proof.

The collector parses the raw header independently, checks its SHA256d identity
and parent linkage against the explorer, and requires that the concatenation of
**all** raw transactions exactly exhausts the raw block's transaction payload.
The replay RPC block envelope is assembled from that parsed header and the
captured decoded transactions; it is not a native captured `getblock(2)` result.

The sample contains 9 transactions with Sapling activity and 1 with Orchard
activity: 12 Sapling spends, 10 Sapling outputs, and 2 Orchard actions. One
transaction contains both pools. Public ciphertext is retained; no memo or note
decryption, viewing key, spending key or wallet integration is involved.

The explorer's block-size summary is one byte smaller than the raw block for
each of these three blocks. The observation is retained and the measured raw
byte length is used. No reason for the discrepancy is assumed.

Use `benchmarks/prep/full/modern_capture.py` to capture, privately replay, and
verify this dataset against Prep. Native Prep still validates the raw header,
transaction concatenation and source anchors during ingestion. This does not
independently validate consensus, proofs, Merkle roots or v5 transaction IDs,
nor cover all later network upgrades or current-tip production operation.
