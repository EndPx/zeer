# Prep proof: shielded-pool data, source outages, and real-node reorg

Executed 13 October 2026. The user asked to prove the three remaining bounded
evidence gates before further product expansion. All three scenarios below
passed; their different trust and environment boundaries are explicit.

| Scenario | Result | What was actually exercised |
| --- | --- | --- |
| Complete Sapling/Orchard data | PASS | Three genuine historical NU5 mainnet blocks replayed through a fixture RPC; all raw/decoded output and four pool-filter cases |
| Follow through source outages | PASS | 600.613 seconds on real peerless Zebra Regtest, 18 new blocks, two stopped-node intervals, same Prep process |
| Real-node branch replacement | PASS | Zebra invalidated two canonical blocks and generated three replacements; Prep advanced epoch and rejected the old cursor |

## 1. Complete historical Sapling and Orchard data

The [committed public fixture](../../fixtures/mainnet-nu5-full-v1/README.md)
contains heights **1,687,106–1,687,108**, with **17 full transactions**:

- 9 transactions contain Sapling activity: 12 spends and 10 outputs.
- 1 transaction contains Orchard activity: 2 actions.
- One transaction contains both Sapling and Orchard data.

Raw blocks originate from official Zebra test vectors at pinned commit
`7121c82ba6795a151523d5b308a19743f4a1ade7`. Decoded transactions were captured
from CipherScan's node-backed verbose transaction API. The collector checks
header SHA256d identities, parent links, transaction counts and exact
concatenation of every transaction into the complete official raw block.
Original decimal and exponent tokens never pass through binary floating point.

The same native Prep importer and HTTP server used for full-data archives
ingested and served this sample. Verification compared every selected raw and
decoded block/transaction field and paginated through all three blocks. Filters
returned the exact expected sets:

| Filter | Matching transactions |
| --- | ---: |
| `has_sapling: true` | 9 |
| `has_sapling: false` | 8 |
| `has_orchard: true` | 1 |
| `has_orchard: false` | 16 |

[Modern proof JSON](../raw/2026-10-13-prep-proof/modern-proof.json) records the
fixture SHA-256, projection digest and all filter outcomes. The fixture retains
source URLs, response hashes and the observed explorer size discrepancy: each
summary listed one fewer byte than its official raw block. The measured raw
length is used; no explanation for that discrepancy is assumed.

**Boundary:** the block RPC envelope is synthesized from independently parsed
official raw headers and captured decoded transactions. This is a frozen replay
of genuine mainnet data, not a native captured `getblock(2)` response or a running
modern full node. It demonstrates this historical NU5 sample's compatibility;
it does not validate consensus/proofs, decrypt notes/memos, or cover every later
network upgrade or current-tip workload.

## 2. A real failure, a bounded fix, and a ten-minute rehearsal

First, the previous release was run against a disposable copy of the real
1024-block Zebra Regtest state. At height 1024 the source container was stopped.
The follower exited with **code 1** and left `ready=false` rather than recovering.
This actual-node baseline is recorded in
[baseline-outage.json](../raw/2026-10-13-prep-proof/baseline-outage.json).
The regression test was also captured failing before the implementation in
[retry-red.txt](../raw/2026-10-13-prep-proof/retry-red.txt).

The fix retains one `SyncSession`, writer lock and committed position while
retrying **classified transient source errors only**. Follow mode defaults to
8 additional attempts with delays 1, 2, 4, 8, 16, 30, 30 and 30 seconds. Success
resets the consecutive-failure budget. HTTP 429/5xx, request timeouts and recognized
connection interruptions can retry. Authorization, malformed responses,
integrity/network mismatch, local storage, deep reorg and overall sync-step
deadline errors remain terminal. Historical mode does not retry.

The updated binary then ran for **600.613 seconds** on the same isolated real
Zebra source, starting at 1024 and reaching 1042. The harness mined **18 new blocks**
and recorded 573 observations. It stopped/restarted the source twice:

| Cycle | Verified stopped interval | Recovery after restart | Unready observations while stopped |
| --- | ---: | ---: | ---: |
| 1 | 30.3356 seconds | 5.1454 seconds | 18 |
| 2 | 30.7802 seconds | 7.1715 seconds | 18 |

Every offline poll checked that the same source container remained stopped.
After the RPC failure was detected, metadata was not ready and queries returned
HTTP 503 `SOURCE_NOT_READY`. Detection is not instantaneous: the configured
transport timeouts apply. The committed head did not change while the source
was unavailable.

Prep's container ID, PID, start time and restart counter stayed unchanged
throughout. It ran directly as PID 1 with no supervisor. Recovery restored zero
lag and epoch 0. The full historical cursor continuation for 1021–1024 remained
correct; final verification compared all 23 blocks and 23 transactions in 1020–1042
against the real node's hashes and raw bytes, with no missing/duplicate heights.

Evidence: [result](../raw/2026-10-13-prep-proof/resilience-proof.json),
[timestamped journal](../raw/2026-10-13-prep-proof/resilience-proof.journal.jsonl),
and [follower output](../raw/2026-10-13-prep-proof/follower.txt).

**Boundary:** this is a ten-minute peerless Regtest rehearsal, not a days-long
production soak or public-mainnet availability proof. Constructor failures and
source IP changes are not recovered: private HTTP DNS answers remain pinned.
The default 121 seconds is cumulative backoff, excluding failed-request time.

## 3. Canonical branch replacement on real Zebra

Without restarting that Prep follower, the harness exercised actual Zebra
`invalidateblock` and `generate` RPCs on the disposable node. Its exact Regtest
genesis, expected height and empty peer list were checked before each mutation.
The implementation is in
[Zebra v6.2.3's RPC methods](https://github.com/ZcashFoundation/zebra/blob/v6.2.3/zebra-rpc/src/methods.rs).

The initial head was 1042. The node invalidated 1041, rewound to the common
ancestor 1040, then generated a different branch at 1041–1043. Prep recovered to
the new head 1043 with zero lag:

- Archive epoch advanced **0 → 1**.
- The old cursor returned **HTTP 409**, error **`REORG`**.
- A new paginated query covered 1038–1043 exactly once per height.
- All 6 returned blocks and 6 transactions matched the node's canonical hashes
  and raw bytes, with no duplicate transaction locations.

The [reorg result](../raw/2026-10-13-prep-proof/reorg-proof.json) includes old/new
epoch, invalidated hash, all three replacement hashes and six raw-block digests.
Its [journal](../raw/2026-10-13-prep-proof/reorg-proof.journal.jsonl) records the
actual node transition before Prep recovery was accepted.

**Boundary:** this is a real-node, administratively triggered canonical branch
replacement. It is not a naturally occurring multi-peer fork race, deep reorg,
or mainnet safety certification.

## Verification, reproduction and operating limits

- **78 Rust tests** passed, including the outage regression, retry exhaustion,
  exact backoff/reset, cancellation/writer release and retry classification.
- **13 Python fixture/guard tests** passed. These are distinct from the SDK tests
  reported by the earlier improvement batch; no new SDK claim is implied.
- Formatting, Clippy with warnings denied and the optimized release build passed.
- Separate review covered retry behavior and the proof harnesses. It prompted
  stronger stopped-container identity checks and complete old-cursor continuation
  verification before the ten-minute run.

[Reproduction recipes](../../prep/full/README.md) describe the committed harnesses,
their admission flags and the required disposable environment. The source was a
copy of the original frozen Regtest state; the original was not mutated. All
containers used pinned images, an internal network and no published ports.
The follow experiment allocated 0.75 CPU / 2 GiB to Zebra, 0.5 CPU / 2 GiB to the
follower, 0.5 CPU / 1 GiB to HTTP, and a capped 0.5 CPU / 512 MiB host driver.
Build containers used 3 CPU / 4 GiB while runtime experiments were stopped.
The complete experiment remained within the existing 3 CPU / 8 GiB / 40 GiB envelope.

Setup failures are retained: the capability-dropped Zebra image entrypoint could
not initialize its home directory, so the final setup ran `zebrad` directly as
UID 10001 over the writable disposable state. The first historical fixture import
also started before the replay listener was ready and failed closed; the retry
after readiness passed. These are not included as successful proof runs.

Baseline commit: `081684e97505a43658245c8490a236b57e4faae8`.
Executed updated binary SHA-256:
`c14324f40f2e3982efcdf413193d5c5a5c7055b282a52315ba71e69277d02391`.
The [execution manifest](../raw/2026-10-13-prep-proof/execution.json) contains
source/proof hashes, binary/image pins, container configuration, resource limits
and final service state. [Linux validation](../raw/2026-10-13-prep-proof/validation.txt)
contains the test/lint/build results.

All experiment containers were stopped afterward, and the five existing
application services remained active. No public-chain transaction, private key
access, public Prep deployment, package publication or infrastructure purchase
was performed.
