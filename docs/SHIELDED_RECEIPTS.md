# Watch-only shielded receipts

This opt-in testnet developer preview reads authorized note plaintexts from full
Zcash transactions with a local Unified Full Viewing Key (UFVK). It is a generic
Zeer capability. It has no order, quote, swap, settlement or signing API.
The existing public Prep service does not accept viewing keys and does not expose
the resulting private data. Run the scanner and Chef in the operator's environment.

## Pinned implementation

The native `zeer-scanner` package uses official Zcash implementations:

| Package | Exact version |
|---|---|
| `zcash_client_backend` | `0.25.0-pre.2` |
| `zcash_keys` | `0.17.0-pre.2` |
| `zcash_primitives` | `0.31.0-pre.2` |
| `zcash_protocol` | `0.11.0-pre.1` |
| `orchard` | `0.16.0` |
| `sapling-crypto` | `0.9.0` |

The published crate VCS metadata records these upstream revisions:

- Backend: `9751317da1ff2e9613318f71353989d3f1b7f650`.
- Keys: `fb1031a007fe6baa883ab134d83cd934244ed224`.
- Primitives: `28411cd0245bed626d0605ce7cfa07c21068613f`.
- Protocol: `2279f586dc0c2e576542d77d88ca38c8256d9c22`.

The lockfile pins transitive dependencies and checksums. These packages are MIT/Apache-2.0;
Zeer does not copy the previously reviewed CipherScan application or its WASM.
See the official [backend source](https://github.com/zcash/librustzcash/tree/9751317da1ff2e9613318f71353989d3f1b7f650/zcash_client_backend).

This is deliberately a prerelease dependency profile. The attempted stable
`zcash_client_backend 0.24.0` / `zcash_primitives 0.30.1` / `orchard 0.15.0`
combination did not compile: the transaction builder referenced deferred-anchor
methods absent from that Orchard release. No upstream code was patched to force
compatibility. The coherent profile above must pass builds and decryption checks
on each target platform before distribution.

Sapling, Orchard and Ironwood are separate receipt pools. Orchard and Ironwood
use the UFVK's Orchard key component with distinct official note-encryption
domains. The profile understands the published testnet NU7 branch and activation
schedule. Unsupported formats/branches fail visibly. Sprout receipt scanning is
unsupported. There is no mainnet profile or arbitrary network override.

## Stateless full-transaction design

Prep supplies complete selected transaction bytes and every scanned block header.
Chef asks a single local Rust child process to decrypt each transaction. The child
owns one configured watch-only account, has no network client or durable wallet
database, and returns a complete bounded result or an error. A valid transaction
without a readable positive note returns an empty result.

This replaces the older proposal's SQLite wallet/tree-state dependency for this
bounded incoming-note profile. Full transaction trial decryption needs no note
witness tree or wallet balance state. There is therefore no second durable
checkpoint to coordinate with PostgreSQL. It does not implement the older
proposal's full lightwalletd wallet lifecycle, spent-note tracking or balances.

Chef decrypts the next bounded application group before opening its SQL commit,
rechecks the canonical end header, then invokes the receipt handler inside the
existing atomic entity/undo/checkpoint transaction. Failure commits none of that
group. A restart rescans uncommitted canonical bytes; an already committed group
is skipped. Reorg reconciliation rolls back orphaned projections before replay.
Source/scanner errors and observed canonical changes close the normal read gate.
A developer handler failure rolls back its group and retains the previously
committed snapshot and checkpoint. The retained application
undo window still bounds recovery; deeper changes require an explicit rebuild.

Full transaction scans transfer more data than compact discovery. This profile
does not claim HyperIndex-like whole-chain latency or a new performance ranking.
Use a known wallet birthday and retained checkpoints. Public transaction filters
intentionally narrow what is scanned; they cannot establish completeness outside
the selected transactions or supported pools. Keep that limitation in application
coverage. Unknown future protocol behavior is not implicitly supported.

## Receipt contract

`indexer.receipt({ block, transaction, receipt, context })` is available alongside
the public transaction handlers. The runtime fetches raw transaction bytes only
when a receipt handler is enabled. Existing public-only query shapes and project
fingerprints retain their behavior.

| Field | Meaning |
|---|---|
| `id` | SHA-256 of a versioned domain, network, configured account ID, canonical UFVK fingerprint, TX ID, pool and output/action index |
| `pool`, `output_index` | Sapling output position, or Orchard/Ironwood action position |
| `receiver`, `receiver_type` | Exact 43-byte receiver component as lowercase hex; Sapling or Orchard protocol. An Ironwood receipt uses an Orchard receiver component |
| `value_zat` | Positive decimal integer string, checked against the protocol monetary bound; no floating point |
| `memo_hex` | All 512 memo bytes, including padding; binary, no-memo and textual content stay distinguishable |
| `scope` | `external` or `internal` incoming-viewing-key scope |
| `origin` | Always `unknown`; external scope does not prove a different sender |
| `is_coinbase` | Actual null-outpoint coinbase marker, independent of note scope or transaction position |
| `height` | Caller-supplied source block height, bound to canonical headers by Chef |

Height, memo and amount are absent from the logical identity, so replay and
re-inclusion do not create a new logical note ID. Keys, account identities and
pools are distinct identity domains. Outgoing-key recovery is excluded; internal
notes remain labeled because they can be change or self-transfers. Zero-valued
descriptions are not emitted as receipts. A full UA can contain multiple receivers;
compare the decoded pool receiver component, not strings of different UA forms.

A receipt is a readable note observation, not an available wallet balance or a
settlement authorization. Apps choose confirmation requirements, matching rules
and treatment of internal/coinbase notes. A reorg can invalidate an observation;
no index rollback can retract an external payment. Keep irreversible side effects
outside handlers and make downstream processing idempotent.

## Local process and keys

The scanner accepts an absolute UFVK file path, never a seed, spending key, URL or
key-bearing request body. This profile requires both Sapling and Orchard UFVK
components and accepts one account per process. Unix files must be regular files
without group/other permissions (0400 or 0600); symlinks are refused. On Windows,
the operator must protect the directory and files with an owner-only ACL. Keep
native binaries and key paths operator-controlled.

The TypeScript child receives only PATH/SystemRoot from the parent environment;
database and API credentials are not propagated. Stderr is drained without being
logged. Input strings use zeroizing buffers and supported upstream zeroization
features are enabled, but this is not a memory-erasure certification.

Inspect identity locally before configuring the project:

```sh
zeer-scanner inspect-key --account inbox --key-file /protected/testnet.ufvk
```

The output contains the fingerprint and default receiver components, not the
UFVK. Bind that fingerprint in `shielded.keyFingerprint`. A different key/account
changes the CLI's persisted project identity; preserve the old namespace and use
an explicit new generation. Replacing a key file cannot silently continue the
same projection. The key is loaded once per child; restart after a controlled
configuration change. Never expose receipt GraphQL without its deployment token.
For custom runtime/store wiring, bind `ReceiptSource.identity` into the store's
persisted fingerprint as well as the schema and handler generation. The Chef CLI
does this account/key/protocol binding automatically; an arbitrary custom store
does not gain that identity guarantee merely by implementing the TypeScript interface.

Private JSONL uses protocol version 1, one in-flight request, 2,000,000 transaction
bytes, 4,100,000 frame bytes and at most 4,096 receipts. Truncated frames, invalid
TX IDs, trailing bytes, wrong network/branch, unsolicited responses, timeouts and
cancellation fail without a successful partial result. The client checks note
IDs, ordering, account, pool, amount and memo bounds. Native raw parsing and note
decryption do not verify consensus proofs/signatures or source honesty; use a
trusted, canonical, testnet Prep source. The standalone scanner does not invent
confirmations or prove that its caller's bytes were mined.

## Reproduction and evidence boundaries

See the [generic shielded inbox](../examples/shielded-inbox/README.md). Native
tests generate cryptographically encrypted fixtures for all three pools with
unrelated notes, multiple outputs, zero-valued descriptions, internal scope,
outgoing recovery, binary/empty memos and a coinbase marker. Fixture proofs and
signatures are placeholders: these are not consensus-valid transactions and must
never be broadcast. Public fixture keys are unfunded test material, never live keys.

The optional native/PostgreSQL tests use separate random namespaces and exercise
handler failure, process restart, atomic checkpoints, authenticated GraphQL and
simulated reorg removal. They are distinct from a natural network reorg. Live
testnet receipt verification uses a dedicated Zeer account; keys and detailed
evidence remain local-only. Pool support must be reported separately for fixtures
and actual mined observations. No ZeeSwap project or settlement is part of this
capability, and no private scanner is enabled on the public demo by default.
