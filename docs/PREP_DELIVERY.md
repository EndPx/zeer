# Zeer Prep delivery contract â€” 28 October 2026

User instruction on 2026-10-13: develop Prep toward the role HyperSync provides
for developers, specifically for Zcash. The user explicitly requires **complete
blocks and transactions**, not a compact-only release.
This contract supersedes the earlier snapshot-only scope for Prep. Chef's public
slice was subsequently authorized under its own contract. Upcoming work and
the combined release gates are owned by the [active roadmap](../plan.md#active-roadmap-public-data-mvp-to-28-october).

## Required delivery

- [x] Complete serialized blocks and all contained transactions from a full-node
  JSON-RPC source, with the node's decoded transaction projection and raw bytes.
- [x] Durable multi-segment historical archive, restart continuation and an
  exclusive writer. Retain the existing compact snapshot workflow separately.
- [x] Follow source growth, detect changed canonical hashes, rewind a bounded
  reorg, and fail visibly when safe recovery exceeds the configured bounds.
- [x] Native HTTP queries: range, supported public filters, field selection,
  bounded responses, pagination and continuation tied to chain epoch.
- [x] A published TypeScript-friendly npm client supporting typed `get`,
  finite `stream`, cancellation and explicit reorg errors; runnable examples.
- [x] Correctness, failure/recovery and integration tests, plus reproducible
  real-node evidence. Distinguish local tests from observed live network events.
- [x] Explain performance boundaries and retain measurements locally without assuming
  parity with HyperSync's latency, scale, infrastructure or EVM capabilities.

## Boundaries

Full raw data includes encrypted shielded transaction payloads. It does not
expose shielded recipients, note values or private memos. Address/event filtering
from an EVM product is not automatically meaningful for Zcash. Unsupported
filters must be rejected, not silently ignored.

The intended archive can grow through multiple segments; demonstrations use
bounded source ranges. A full-mainnet node/archive is not considered deployed
merely because the software can iterate ranges. Disk limits, source coverage,
source trust, indexed height and freshness must be explicit.

Spending, wallet key management, application Chef/GraphQL, cloud billing and new
brand products remain outside Prep. The original 13 October scope excluded
public deployment and npm publication; later authorization delivered the
[public testnet API](PUBLIC_API.md) and [published client](PACKAGING.md).
Full production readiness and "millions of blocks instantly" remain unproven
claims. Preserve unrelated shared-VPS services. The authorized aggregate envelope
is now 3 CPU / 8 GiB / 60 GiB, superseding the initial 40 GiB allowance.

## Architecture and verification order

1. Extend storage with separate payload kinds and an atomic archive catalog.
2. Ingest full node data; independently compare raw and decoded content.
3. Prove restart, source growth and bounded-reorg behavior with deterministic
   node fixtures and actual-node checks where available.
4. Add query/SDK contracts over that archive. Historical continuation survives
   append but rejects an incompatible epoch after rollback.
5. Test multi-segment reads, filters, exact numeric representation, bounded
   memory/cancellation, authentication configuration and query errors.
6. Run documented end-to-end examples and compare equivalent output. Do not
   compare a prepared local archive to a remote node as an engine-only speedup.

Reference: [HyperSync Node client](https://github.com/enviodev/hypersync-client-node)
and the [npm package](https://www.npmjs.com/package/@envio-dev/hypersync-client).
Registry metadata checked on 2026-10-13 reports version 1.4.1, TypeScript
declarations and platform-specific native packages. The public repository
describes Rust/N-API bindings. These inform developer experience, not code
copying, license equivalence, or a requirement to use native bindings in Prep.

## Validation records

Execution records and benchmark reports are retained locally under
`benchmarks/results/`. The [harness](../benchmarks/README.md) and public input
fixtures remain available for reproduction. Checked boxes describe bounded
functional delivery; they do not certify production readiness, whole-chain
performance, all network upgrades or HyperSync parity.
