# Published testnet memo example

Verified on 21 October 2026. The Chef playground's **Read shielded memos** preset
queries a selected receipt from a dedicated Zeer testnet wallet. It uses the same
editor, schema panel and Run query action as the block examples.

| Item | Observed value |
| --- | --- |
| Transaction | `b9444bea5e092925ddfa52dbfbd8d1075c62b8b234260df3d9b9179f0a8d2d6e` |
| Mined block | `4523289` |
| Pool | Ironwood |
| Published note value | `100000` zatoshi / `0.001 TAZ` |
| Text memo | `Hello from Zeer Chef` |
| Scope / origin | `external` / `unknown` |
| Coinbase | `false` |
| Dedicated Chef project | `demo_memo_20261021` |
| Demo projection checkpoint | `4523291` |

[Run the Chef example](https://zeer.endpx.cloud/app/chef) or
[inspect public transaction fields](https://zeer.endpx.cloud/app/prep?view=transaction&txid=b9444bea5e092925ddfa52dbfbd8d1075c62b8b234260df3d9b9179f0a8d2d6e).

## Evidence

- A one-off local testnet transaction funded the note with a 10,000-zatoshi fee.
  It was signed outside Zeer's watch-only scanner. The node accepted the raw
  transaction and subsequently reported it mined; no encrypted fixture was used.
- The native scanner decrypted the complete mined transaction with the dedicated
  wallet's protected local UFVK. It returned the exact amount and original memo
  bytes. The helper checked the source's mined block identity again after scanning.
- Chef codegen, migrate, sync and restart completed in a separate namespace.
  The projection publishes only the allowlisted transaction's 100,000-zatoshi text
  note. Other account notes are excluded. Restart retained one entity.
- The hosted reader runs `serve` with a read-only PostgreSQL role for that demo
  namespace. It has no viewing-key file or signer configuration. No viewing key
  was uploaded to Prep or the public reader.
- The web route checks the transaction's recorded block identity against its
  current chain source before and after GraphQL, then returns the final source
  observation in `extensions.source`. Source failure or an identity change rejects
  the request. Confirmation counts are observations, not a fixed property of the
  example; a separate consumer observed 37 at its verification time.
- Browser verification exercised the real preset, query, text preview, stale
  response handling, a subsequent genesis query and 390-pixel mobile reflow.
- All 110 Chef tests passed with the native executable and PostgreSQL enabled;
  none were skipped. The web preset/query/route checks also passed, including an
  injected source change during GraphQL. This is separate from a natural reorg.
- A fresh consumer installed the Chef 0.1.1 candidate tarball, checked strict
  TypeScript declarations and used its installed helper to read this actual mined
  transaction through public Prep and a local native scanner. Candidate-package
  acceptance is distinct from npm registry publication.
- Chef 0.1.1 was subsequently published to npm on 21 October 2026. A fresh
  registry installation passed strict TypeScript checks and read the same mined
  memo with the local native scanner. Its package integrity matched the verified
  release tarball.

Detailed local proofs and key material remain outside version control. The public
example deliberately discloses its selected demo note; it cannot decrypt an
arbitrary user's shielded transaction.

## Integration boundary

Zeer observes notes readable by the configured viewing key. External/internal
scope does not identify the sender or prove a self-transfer. Canonicality is
relative to the configured chain source; Zeer is not a consensus validator.

A consuming application validates its own order, exact per-note amount, decoded
pool receiver, deadline, confirmations and canonicality. It enforces output
deduplication and payout idempotency, and rechecks chain state near settlement.
The receipt is neither a spendable balance nor permission to pay.
