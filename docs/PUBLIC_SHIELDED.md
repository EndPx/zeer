# Public Sapling, Orchard and Ironwood queries

This slice queries public transaction structure. It does not scan viewing keys,
discover a private recipient's receipts, recover private note values or decrypt
memos. Raw encrypted transaction data remains available through the existing
explicit `raw`/`decoded` selections.

## Fields and filters

| Transaction field | Source in stored full transaction JSON | Representation |
|---|---|---|
| `sapling_spend_count` | Length of `vShieldedSpend` | Nonnegative bounded integer |
| `sapling_output_count` | Length of `vShieldedOutput` | Nonnegative bounded integer |
| `orchard_action_count` | Length of `orchard.actions` | Nonnegative bounded integer |
| `ironwood_action_count` | Length of `ironwood.actions` | Nonnegative bounded integer |
| `is_coinbase` | Actual coinbase input marker | Boolean |
| `transaction_type` | Public input/output and pool components | `coinbase`, `transparent`, `shielded`, `mixed`, or `unknown` |
| `expiry_height` | Public `expiryheight`, or zero when absent in older formats | Bounded integer |

These are public component counts. An absent/null bundle or array counts as zero,
consistent with the existing pool-presence filters; empty arrays also count as
zero. A malformed selected non-array component, or a malformed Orchard/Ironwood bundle when its
count is requested, fails the query rather than being silently reported as zero.
In the UI, a missing response field remains unavailable, not a manufactured zero.

Sapling Spend and Output descriptions and Orchard Actions are distinct public
structures in [ZIP 225](https://zips.z.cash/zip-0225). Orchard can contain dummy
components as described by [ZIP 224](https://zips.z.cash/zip-0224). A count is not
proof of a particular number of payments, recipients, real spends or real outputs.

`has_sapling`, `has_orchard` and `has_ironwood` test presence of public descriptions in each pool. `is_coinbase` filters actual block-reward transactions independently of pool use. Filter
properties combine with AND, so setting both to true requires both pools.
Use `shielded_pools` for OR across the requested pools:

```json
{
  "from_block": 0,
  "transaction_filter": { "shielded_pools": ["sapling", "orchard", "ironwood"] },
  "field_selection": {
    "block": [],
    "transaction": [
      "txid", "block_height", "version",
      "sapling_spend_count", "sapling_output_count", "orchard_action_count", "ironwood_action_count", "transaction_type"
    ]
  }
}
```

An empty pool list matches no transactions. Unknown or duplicate pool names are
rejected; supported names are exactly `sapling`, `orchard` and `ironwood`. Other predicates
still combine with AND. This filter does not cover Sprout or claim all possible
shielded protocols. Block fields, when selected, retain every scanned header
regardless of matching transactions.

The example intentionally starts at genesis. Early pages may contain no matching
transactions because they predate pool activation. Continue with the same query
and cursor, or use `client.stream()` until the cursor is null. Default UI examples
also start at zero; Use verified testnet sample only fills a known modern start.

The fields also work in bounded `/transactions` lookups. Check `/capabilities`
for their availability; older servers continue serving their existing fields.
Existing cursors without the new filter retain their fingerprint. Adding or
changing pool predicates requires a new query, as with any filter change.

## Storage and execution

No archive or sidecar format changes are required. Compact counts are projected
from existing full decoded records. They avoid returning entire decoded bodies,
but do not establish faster disk reads or a latency SLA. Metadata-only projections
with pool filtering can use existing presence flags in admitted indexes; selected
counts, classifications and Ironwood predicates use the full-payload path because
old indexes do not store this information. No absence is inferred from those
legacy indexes for Ironwood.

Try the [public playground](https://zeer.endpx.cloud/app/prep?example=shielded&from=0)
or the [runnable packaged-client example](../examples/shielded-query/README.md).

## Live transaction and pending observations

The optional read-only node source exposes `GET /mempool` and `POST /transaction`
with `{ "txid": "64-character-lowercase-hex" }`. These are **testnet node
observations**, separate from the mined-block archive and Chef checkpoints.
The source must be configured through protected operator files; requests cannot
select an RPC URL or an RPC method. No signing or broadcast method is exposed.

A transaction observation has `pending`, `mined`, or `not_observed` status.
Pending requires actual current mempool membership and cannot be coinbase. Mined
observations cross-check the source's block hash and recompute confirmations
from its observed tip; a chain change fails visibly rather than retaining a
confirmed label. Not observed means only that the node did not return the ID in
that lookup/current mempool. It is not proof of failure or a pending state.

Mempool metadata is bounded to 20 rows, with the observed source total, a
`has_more` flag and the number of entries that left during decoding. This is not
an atomic or permanent history. First-seen time is shown only if the node provides
it; otherwise the UI labels the time of this observation. The public ingress and
shared two-request admission/deadline/body budgets still apply. A live observation
requires no viewing key and does not produce an application indexing event.

The [transaction inspector](https://zeer.endpx.cloud/app/transactions) distinguishes
block rewards, transparent/shielded/mixed structure, pool components and public
net pool movements. Coinbase is recognized from its input marker, never from
index 0 or version 6 alone. A shielded coinbase can have zero transparent outputs;
its public aggregate pool inflow remains distinct from encrypted note recipients.

Amounts use exact integer zatoshis. Coinbase fee is zero. For transactions without
transparent spend inputs or legacy JoinSplits, the view may derive fee from the
public shielded value balances minus transparent outputs. Otherwise fee remains
unavailable: this view does not resolve previous outputs or guess their values.
Raw JSON keeps decoded numeric tokens as decimal strings, preserving precision.

Ironwood uses a separate bundle/value pool in [ZIP 229](https://zips.z.cash/zip-0229);
sharing the Orchard shielded protocol does not make it the Orchard pool.

## Decryption reference for a later phase

The supplied [ZecBlock decrypt page](https://testnet.zecblock.com/decrypt) offers
single-message and inbox interfaces and advertises browser-side UFVK/WASM
decryption for Orchard/Ironwood. It explicitly says Sapling memo decryption is
unsupported there. This review inspected the public page, not the WASM binary or
key-bearing data flow, so its no-key-egress claim is not independently verified.
No keys were entered. It is a UX/research reference, not a dependency or a claim
that Zeer now decrypts private notes. See the earlier
[pinned CipherScan review](SL_CIPHERSCAN_RESEARCH.md) for additional implementation
risks to check before a viewing-key phase.
