# ShieldedLabs/sl-cipherscan: pinned review and Zeer decisions

Reviewed 14 October 2026. Source: [ShieldedLabs/sl-cipherscan](https://github.com/ShieldedLabs/sl-cipherscan),
commit [`f94b13be58f69105978e7fe3185fb698786cf94a`](https://github.com/ShieldedLabs/sl-cipherscan/tree/f94b13be58f69105978e7fe3185fb698786cf94a),
whose commit date is 19 February 2026. Findings apply to that fork and revision,
not automatically to current CipherScan deployments or other branches.

This is the Next/Express explorer application repository, with a retained
JavaScript indexer and Rust/WASM browser cryptography. It is **not** the separate
Kenbak `cipherscan-rust` binary at `15d7f528` used in Zeer's native indexing and
prepared PostgreSQL benchmarks. The repository's hourly statistics job explicitly
describes the Rust indexer as the source of block indexing.

## Review coverage and method

The pinned checkout was inspected without installing dependencies, running its
scripts, contacting its deployed application APIs, or executing its WASM.
External repository text was treated as source material, not agent instructions.

| Area | Scope and evidence boundary |
| --- | --- |
| Root/build/config/license | README, license, dependency manifests, environment example, Next/TypeScript/Tailwind configuration and middleware |
| Application | 41 app files, including 15 pages, 8 local API routes and 9 layouts; explorer, privacy, flows, network, mempool, decode/broadcast and documentation data paths reviewed |
| Components/milestones | 25 components and 2 milestone files; functional data/scan/export boundaries read, UI-only markup inventoried rather than line-by-line audited |
| Client libraries | All 9 lib files, 3 hooks, 1 context, 1 worker, 2 decoder source files and 2 Rust WASM source files: 18 files / 3,367 lines |
| Server | 24 active first-party files across Express/routes, Node indexer, jobs, helpers and manifests; 15 historical scripts catalogued, including 3 SQL files read; 3 protocol files catalogued |
| Generated/vendor assets | Tracked decoder node_modules (245 files), generated decoder dist/WASM and public WASM inventoried; bundled code and binary/source equivalence not audited |

This is an architecture and implementation review, not a formal security audit or
proof of deployed behavior. Root test scripts/CI and generated artifact validation
were not inferred from documentation claims.

## Architecture observed

The explorer frontend mixes direct public PostgreSQL API requests and same-origin
Next routes. The Express service uses PostgreSQL for prepared projections, Zebra
RPC and lightwalletd for node/wallet-serving data, Redis for caches/pub-sub, and
WebSocket broadcasts for updates. Separate jobs compute privacy trends, network
information, cross-chain attribution and heuristic risk tables.

Browser scanning retrieves public compact blocks or Orchard candidate IDs, filters
locally in workers/WASM, then retrieves matching raw transactions for local memo
processing. This transport/computation separation is useful. The backend can still
observe requested ranges and IDs; local key processing does not make request
patterns invisible.

## Concepts worth adapting independently

| Observed pattern | Pinned source | Zeer decision |
| --- | --- | --- |
| One batch request for multiple raw transaction IDs | [transactions.js, batch route](https://github.com/ShieldedLabs/sl-cipherscan/blob/f94b13be58f69105978e7fe3185fb698786cf94a/server/api/routes/transactions.js#L327-L404) | Add bounded public transaction lookup to eliminate multiple HTTP scan pages for one small ID set |
| Group input/output retrieval for a whole block with SQL `ANY`, then group by txid | [blocks.js](https://github.com/ShieldedLabs/sl-cipherscan/blob/f94b13be58f69105978e7fe3185fb698786cf94a/server/api/routes/blocks.js#L151-L183) | Reuse Prep's indexed block positions and existing projection engine; avoid per-ID payload parsing/RPC fan-out |
| Retrieve lightweight candidate metadata before heavy transaction bytes | [scan.js](https://github.com/ShieldedLabs/sl-cipherscan/blob/f94b13be58f69105978e7fe3185fb698786cf94a/server/api/routes/scan.js#L145-L195) | Default batch lookup to public metadata while supporting explicit raw/decoded selection within byte limits |
| Developer-facing API examples and network configuration | [API docs](https://github.com/ShieldedLabs/sl-cipherscan/tree/f94b13be58f69105978e7fe3185fb698786cf94a/app/docs), [api-config.ts](https://github.com/ShieldedLabs/sl-cipherscan/blob/f94b13be58f69105978e7fe3185fb698786cf94a/lib/api-config.ts) | Expose machine-readable capabilities from validation constants; keep live readiness in `/height` |

The batch transport idea extends a bottleneck already measured in Zeer: the
128-ID metadata query still required 16 HTTP pages over a 2,048-block range.
It is not a claim that batch APIs are unique to this repository or to Zeer.

## Implementation details not adopted

The external raw-batch route accepts up to 1,000 IDs and launches a `Promise.all`
operation per ID, opening a lightwalletd client and falling back to RPC. The
inspected path has no equivalent per-ID hex validation, shared deadline or total
response-byte bound, logs sample IDs, and returns successful subsets alongside
individual failures. Zeer instead requires bounded input/output, one admitted
snapshot and whole-request failure on an incomplete read. A missing ID means
absence only within a successfully completed requested range.

The historical compact cache saves a chunk at a 90% threshold, while the read path
treats an existing chunk file as covered. It has no canonical epoch binding in
that path. That is insufficient for proving gap-free canonical coverage, so Zeer
keeps immutable catalog identity, complete-range checks and reorg rejection.

The retained JavaScript indexer inserts a block before finishing its transactions,
catches transaction failures, and resumes from `MAX(blocks.height)`. No atomic
block/checkpoint or reorg mechanism was found in that path. Zeer's existing
atomic publication and Chef transaction boundaries remain unchanged.

Configuration/documentation drift includes `USE_POSTGRES_API=false` despite
comments saying PostgreSQL is always used, separate network-detection rules,
docs saying testnet-only while README advertises both networks, and handwritten
rate limits differing from middleware. Some selected same-origin paths have no
matching Next route in this checkout. Capabilities generated from current server
constants address a narrower, concrete form of this problem in Zeer.

Amount transforms and the TypeScript display parser use JavaScript `Number` and
`parseFloat`. The parser does not enforce all canonical CompactSize/full-buffer
consumption checks and rejects versions above five. Milestone verification is an
external smoke script with skips and one-zatoshi tolerance. None of those choices
are adopted as exact-accounting or archive-admission rules.

## Private scanning findings and scope

The assigned active browser/WASM paths pass viewing keys to local workers and
WASM; no key-bearing network/persistence call was found in those paths. This is
not a certification of the deployed bundle or generated binary. The SDK's Sapling
output mapping feeds the same batch path whose active Rust implementation builds
Orchard domains/actions; working Sapling decryption was not established. The
WASM README's support claims also conflict with the implementation.

Worker messages lack operation IDs, callback state can be overwritten by another
operation, and cancellation can return a normal partial result. Chunk limits
count blocks rather than bytes/outputs. The inspected sources do not demonstrate
the README's explicit memory-clearing assurance. An unlinked key-parser file logs
FVK components; this is a dormant source concern, not observed active exfiltration.

Memo decoding uses a fixed NU5 branch identifier, Orchard processing, and the first
nonempty UTF-8 memo, with a floating-point display amount. Those are presentation
choices, not a complete note/accounting API. Viewing-key handling, memo decryption,
private matching and cross-chain heuristics remain outside Zeer's authorized
public-data implementation slice.

## License and provenance decision

The root [LICENSE](https://github.com/ShieldedLabs/sl-cipherscan/blob/f94b13be58f69105978e7fe3185fb698786cf94a/LICENSE)
declares AGPL-3.0 with a Commons Clause restriction. Other declarations vary: the
decoder package has MIT/Apache license files, API/indexer package labels differ,
and the WASM README declares MIT without a matching Cargo license field. These
are observed declarations, not a legal determination about every subtree or
compiled artifact.

No source, generated bundle, WASM binary or dependency from this checkout is
copied into Zeer. Zeer's new code is independently written around its existing
Rust query/archive engine and JavaScript client. Source links acknowledge the
reviewed concepts; Zeer's license is not changed. The private local checkout is
excluded from the repository. Future direct code reuse would need its own clear
license/provenance treatment.
