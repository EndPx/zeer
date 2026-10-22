# Generated-template acceptance

`verify-generated.mjs` runs outside the checkout with an installed Chef package,
pnpm, a disposable PostgreSQL database and the published Linux scanner. Set
`ZEER_EXPECTED_CHEF_VERSION` (default 0.3.0), `DATABASE_URL`, `CHEF_API_TOKEN`,
`ZEER_SCANNER_EXECUTABLE` and `ZEER_PUBLIC_FIXTURE`. The last value points only to
the explicitly public unfunded fixture at
`crates/zeer-scanner/tests/fixtures/shielded.json`; never use an operator key.

The bootstrap project must contain an installed `@zeer-dev/chef`. It may be a
registry install or a tested local release tarball. For a pre-publication
candidate, set `ZEER_CANDIDATE_TARBALL` to its absolute path. The harness checks
the generated manifest's exact version, then explicitly substitutes that file
dependency before installing. Without this variable all generated projects
install the exact version from the registry. Candidate and registry outcomes
must be recorded separately.

The harness generates blank, public and shielded projects through the actual
installed CLI. Each installs its own dependencies and runs strict TypeScript
checking, codegen, migration, sync and authenticated GraphQL. Blank initially
contains no entity or handler: empty typecheck passes and codegen explains the
missing model. A separately supplied custom observation model then exercises the
application path. The public template's generated query checks block metadata.
Shielded uses the published binary against six public unfunded fixture notes,
checks the packaged memo query and resumes its continuous consumer without
duplicates. Fixture block context is synthetic; this is not live-receipt latency.

Only test-adapter chain responses are injected into CLI sync. The real SDK,
scanner, PostgreSQL, generated query and consumer processes run unchanged.
Process/query timeouts and an external process-group runtime limit are required.
Keep the project root private; command logs can contain test-only identifiers.
The harness removes each successful owned namespace, generated environment and
public fixture key copy. A failed disposable database is cleaned by its caller.

The one-client / three-project public HTTPS study is a different workload in
`../onboarding-public/`. Its preliminary candidate hashes and all failed attempts
remain there. It does not establish rate-limit recovery when no 429/503 occurs.
