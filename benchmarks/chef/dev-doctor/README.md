# Dev and Doctor acceptance

These checks exercise onboarding and process recovery. They do not measure
throughput, payment finality or live shielded receipt latency.

Run from a new directory outside the checkout, using Node 24.14+, pnpm, a
**disposable PostgreSQL database** and the released Linux testnet scanner.
Install the package version being verified there:

```sh
pnpm add @zeer-dev/chef@0.4.0 @zeer-dev/prep-client@0.1.0 pg@8.23.1
```

Set `DATABASE_URL`, an independent `CHEF_API_TOKEN` of at least 16 bytes,
`ZEER_SCANNER_EXECUTABLE` to an absolute local scanner path, and
`ZEER_PUBLIC_FIXTURE` to the absolute path of
`crates/zeer-scanner/tests/fixtures/shielded.json` in the checkout. Configure
these locally; do not paste credentials into an issue or evidence report.

Run `verify.mjs` by its absolute checkout path while keeping the standalone
directory as the working directory. It creates three new generated projects
and installs their declared packages with pnpm. `ZEER_CANDIDATE_TARBALL` can
select a local audited Chef tarball before publication; leave it unset for
registry acceptance. `ZEER_EXPECTED_CHEF_VERSION` defaults to `0.4.0`.

The fixture check verifies:

- Blank starts without sample entities, then accepts an application model.
- Doctor reports a missing migration without creating the namespace.
- Dev refuses implicit migration; explicit `--migrate` starts the compatible
  namespace, compiles the project, starts GraphQL and follows the source.
- Source interruption closes reads; restoring the source permits recovery.
- Shutdown releases the API port; compatible restart preserves the result.
- The native scanner reads six notes from a **public, unfunded fixture**.
  The private consumer resumes without duplicating its observations.

This fixture has synthetic block context served over a local HTTP endpoint.
It does not demonstrate a newly mined payment. No operational viewing key is
needed. Generated credentials and the temporary fixture key are removed after
the child processes stop. Successful runs remove only their random `dev_`
project namespaces; failed runs retain namespace state for inspection. Use a
disposable database and remove its role/database after investigating a failure.

Run `public.mjs` from the same standalone working directory to test the
public testnet separately. It initializes a fresh public project at two observed
blocks, starts and restarts Dev, and compares GraphQL rows with a complete Prep
projection of those blocks. It uses the normal five-second follower polling
interval, requires no viewing key, removes its own namespace and saves a local
proof. It is a bounded functional check, not a load test.

`upgrade.mjs` checks the previous `0.3.0` release separately. Set
`ZEER_OLD_CHEF_CLI` to the absolute `dist/cli.js` path of an independently
installed Chef 0.3.0 package. The script creates a public project with that CLI,
commits two observed testnet blocks, installs 0.4.0 without changing its config,
then runs Doctor and Dev without migration. It compares persisted namespace
fingerprint and generation as well as the queried data. It never upgrades an
existing developer or hosted project.

The scripts create new output folders and refuse an existing one. Use
`ZEER_DEV_ACCEPTANCE_ROOT` or `ZEER_PUBLIC_DEV_ROOT` to select a fresh location
for another run. Keep generated reports and logs local; publish source and
methodology only. The unit/integration suite in `packages/chef/test` separately
covers peer failures, cancellation, forced process cleanup, fingerprint
compatibility, blocked/identity-mismatched state and read-only Doctor behavior.

Run `node --test resources.test.mjs` from this harness directory for the
standalone module-resolution and forced-shutdown cleanup regressions. These
checks need no database, viewing key or external network. Failed shutdowns
still attempt credential removal, source teardown and failure-proof writing;
namespace removal requires a confirmed stopped child.
