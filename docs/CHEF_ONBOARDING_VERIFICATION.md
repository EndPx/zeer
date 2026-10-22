# Chef 0.3.0 onboarding verification

Recorded 22 October 2026, Asia/Jakarta. Base commit: `10b8f15`.

## Delivered behavior

Guided `zeer init` offers Blank project, Public chain indexer and Shielded payment
inbox. The `--template blank|public|shielded` flag selects a starter explicitly.
Fully supplied older scripts without the flag retain the public default. Blank
and public default to one captured latest indexed height; shielded requires a
numeric wallet birthday. Init collects no key contents, installs no packages,
starts no services and refuses existing output paths.

Blank contains an empty schema and handler module. Its initial typecheck passes;
codegen explains the absent model. After a developer supplies a schema, codegen
works before the handler exists; indexing still requires an actual handler.
Public produces BlockSummary entities from headers and transaction metadata.
Shielded packages nine explicitly listed assets for a local scanner, receipt
query and continuous SQLite consumer. Its private key-file paths and fingerprint
are configured after init; no viewing key reaches public Prep.

## Package and registry

Published `@zeer-dev/chef@0.3.0`, retaining Prep-client 0.1.0. The 44-entry package
contains exactly nine shielded template assets. Canonical package acceptance
requires those paths and rejects unexpected entries. The frozen 71,944-byte
tarball has SHA-256
`bf8e520ceb8763486dc609e9257110664a3e990ea1ff759ecfc3ebeea43f7094`;
anonymous registry download matched the accepted bytes. No hosted database
namespace was migrated or follower/API upgraded as part of publishing.

Fresh registry acceptance covered all three generated projects on Windows and
Linux, using pnpm outside the checkout. It exercised the actual `pnpm --package`
`dlx zeer` alias, explicit templates, and a real public latest-height lookup.
Each project passed code generation and strict typechecking. Linux additionally
ran actual PostgreSQL migration, CLI sync and authenticated GraphQL. The shielded
project read six notes across Sapling/Orchard/Ironwood with the released Linux
scanner, ran its generated memo query and resumed the continuous consumer.
These notes use public unfunded fixture bytes and synthetic chain context; no
new funded transaction or live-decryption latency claim is involved.

The full SDK suite passed **132/132 tests, zero skipped**, against isolated
PostgreSQL and the released scanner, both before publication and from the final
registry package. Independent intent and standards reviews passed after fixing
memo-query wording and the canonical package allowlist. The canonical standalone
tarball verifier also passed actual installation, installed-bin execution,
codegen, strict typechecking and module containment on Linux.

## Public HTTPS acceptance

The separate preliminary-candidate study ran one, then three independent public
projects. Passing phases took 18.160 s / 39.951 s and made 11 / 31 public HTTPS
attempts, all HTTP 200. Every project matched an independent eight-block Prep
projection; sixteen total block comparisons also matched configured Zebra.
These elapsed values are acceptance durations, not latency benchmarks.

CLI following retained its default five-second poll and canonicality gates.
Starts were staggered 1.5 seconds; peak observed simultaneous request count was
one. No passing-phase 429/503 occurred, so the run establishes neither a capacity
ceiling nor recovery from public rate limiting. The original interrupted-stop
failure and all six of its requests remain in the evidence: terminating an
in-flight source read correctly left Chef reconciling. Total observed public
traffic across passing and failed attempts was 48 requests.

That study records its exact earlier candidate hash. Minor later helper/copy
changes are covered by separate final registry acceptance rather than silently
attributing preliminary traffic to the final tarball.

## Evidence and cleanup

- Machine-readable release checks: `CHEF_ONBOARDING_VERIFICATION_20261022.json`.
- Public raw results, frozen harness and offline verifier:
  `benchmarks/chef/onboarding-public/2026-10-22-public-onboarding.json` and
  `node benchmarks/chef/onboarding-public/verify.mjs`.
- Generated-template acceptance: `benchmarks/chef/onboarding/verify-generated.mjs`.

Setup errors are retained: pre-publication dependency substitution, copied-test
fixture/dependency setup, and a build diagnostic that initially polluted npm's
JSON stdout. The build diagnostic now goes to stderr. npm authentication and
transport interruptions were resolved before registry acceptance; no incomplete
publish response was used as release proof.

Each disposable database/role was removed after zero active connections were
confirmed. Temporary runtime environments and public-fixture key copies were
removed. Resource guards passed, the job is inactive, and original wallet/source
credentials remain untouched. Publication audits found zero matches for known
operator key/seed bytes or owned runtime credentials. The existing shared
3 CPU / 8 GiB pipeline and public ingress limits were preserved.
