# Developer acceptance — 24 October 2026

Chef/CLI **0.6.1** and Prep client **0.1.0** remain the published package versions.
This milestone adds documentation and an application example; it does not change
the SDK runtime or require a package release.

## Public documentation

The Prep benchmark chapter and overview now include the 23 October compact
retrieval study: 4,102,798 blocks in a median 32.282220 seconds, with 48
measurements and 2,592,262 successful measured requests. Published Zaino/Ztreamer
figures retain their original provenance and hardware differences. HTTP retrieval,
startup, and Chef processing remain distinct measurements.

All **45 documentation pages** passed the local browser checks. Navigation,
search, code copying, onboarding and responsive layouts were checked, with zero
axe violations at the tested 375/768/1440 viewports. After activation, every public
HTML page matched its verified build byte for byte. The downloadable compact
summary also matched. Run `node apps/docs/scripts/verify-compact-benchmarks.mjs`
to validate its counts and aggregates.

## Independent registry project

A new Linux project installed the published launcher without a developer account
or workspace link. Public starter dependencies were installed from the registry.
The project passed code generation and typechecking, migrated its isolated local
PostgreSQL namespace, indexed public testnet block 0, then resumed through block 1.
GraphQL returned both blocks with checkpoint 1. Repeating the same target succeeded.
Default `latest` initialization also succeeded against the public Prep endpoint.
This is bounded onboarding evidence, not a full-history backfill or a live
receipt-latency study. No viewing key was loaded.

## Transparent address analytics

The [new example](../examples/address-analytics/README.md) uses the npm-installed
Chef 0.6.1 SDK. Its fixture checks exact integer amounts above JavaScript's safe
integer range, multiple inputs/outputs per address, zero-value activity, unresolved
inputs and multi-address scripts. The documented query executed through Chef's
actual authenticated GraphQL server.

A separate PostgreSQL test verified restart persistence and controlled rollback:
summary amounts, address activity, coverage, destination entities and outpoint
spending state returned to the retained block together. The example also completed
bounded public testnet sync and restart through block 1. The fixture uses synthetic
transactions; the bounded public sync uses chain data. Neither is a natural reorg
test or evidence of wallet spendability.

## Anonymous reviewer journey and recovery

A fresh Chrome context with no saved cookies completed **15 steps and 10 real
Prep/Chef queries**, including headers, Orchard activity, pagination, published
memo results, quickstart discovery and mobile navigation.

The initial check found public Prep unavailable: the existing guard had stopped
the pipeline near its 60 GiB storage allowance. With explicit user authorization,
two inactive historical benchmark database snapshots were losslessly archived.
All **3,297 files** matched their archive checksums and file metadata before the
original directories were removed. Archives and recovery records remain private.

The reviewed guard latch was cleared only after the resource check passed. The
aggregate ceilings remain **3 CPU / 8 GiB / 60 GiB**. Prep's normal startup
verification and freshness gates remained enabled. Following startup, the source
observation refreshed, ingestion caught up, and the final public check reported
height **4,534,979**, `ready: true`, and zero observed lag. These are observations
at verification time, not an uptime guarantee. Guard status was `PASS` with the
monitored existing services healthy.

Detailed build, registry, browser and resource evidence is retained in the ignored
local acceptance directories. Startup recovery time remains a separate performance
target from prepared compact streaming.
