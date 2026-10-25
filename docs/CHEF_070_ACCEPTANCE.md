# Chef and launcher 0.7.0 release acceptance

Verified on **25 October 2026**. Chef 0.7.0 adds sync/follow heartbeats, safe build
identity and fixed operator actions. The launcher pins that exact SDK version.
Prep client remains 0.1.0. npm publication, documentation activation and hosted
application deployment are separate operations.

## Candidate and registry identity

The release was built from commit `95adb373625d0a25d6369f4b6e2613e2e553cdff`.
The other 67 packed files in the Chef tarball match the fully tested
candidate byte-for-byte; the package README and build-produced identity are the
only changed files. The launcher executable and metadata match its tested
candidate, with only its README updated.

Build provenance reports `sourceState: modified` conservatively because the
checkout contained unrelated untracked demo-video files. It is not presented as
a clean-tree attestation. The release record contains tarball SHA-256 and npm
SHA-512 integrity for both packages; anonymous registry downloads match them.

## Verification

- **204 Linux Chef tests passed without skips**, with PostgreSQL and the native
  scanner available. **93 Prep tests** and **three launcher tests** also passed.
  These full-suite results belong to the candidate; the release changes only
  documentation/provenance and was not presented as a new full-suite run.
- Independently installed candidate and registry packages generated **Blank,
  Public and Shielded** starters. Codegen and typecheck passed; the intentionally
  empty Blank schema returned its documented empty-schema error. Re-running init
  refused to overwrite the project or its `.env`.
- All three registry starters installed their own dependencies from npm rather
  than using workspace links. The actual **pnpm dlx** launcher returned 0.7.0.
  Shielded starter validation used an unfunded fixture fingerprint and loaded no key.
- Registry runtime acceptance repeats controlled source interruption, the
  1,569-block catch-up and exact 1,601-entity projection through actual CLI/API
  processes, PostgreSQL and SQLite. A separate additive upgrade starts with
  npm-installed 0.6.1, switches to 0.7.0 without another migration, then verifies
  checkpoint/revision/entities and recovery. These sources are synthetic fixtures.

The [machine-readable record](CHEF_070_RELEASE.json) contains exact counts and
outcomes. The [operational report](OPERATIONS_20261025.md) preserves the separately
measured historical shielded catch-up cohort and its limitations. Those timings
are not rebranded as future-live receipt performance or a public-service SLA.

## Upgrade

Stop the project's writer and API, back up its namespace, then update its exact
SDK dependency and lockfile to `@zeer-dev/chef@0.7.0`. Restart with unchanged
configuration, schema and handler identity. An otherwise unchanged 0.6.x project
does not need a new migration or replay for this release. Older metadata formats
retain their existing migration requirements. Schema/handler changes still use
the [project evolution procedure](https://zeer.endpx.cloud/docs/chef/evolution/).

Existing projects keep their own scaffold files. Updating the package does not
regenerate them. Historical standalone examples retain their explicitly pinned
versions. The generated `CONSUMER.md` includes a candidate-era repository test
appendix; the maintained [recovery guide](https://zeer.endpx.cloud/docs/chef/recovery/)
describes the published 0.7.0 fields and commands.

The documentation release identifies Chef/CLI 0.7.0 while retaining original
versions on historical benchmark and deployment evidence. Source-only Rust Prep
changes and hosted Chef namespaces were not upgraded by this npm release. The
existing public demo was subsequently [restored](HOSTED_RECOVERY_20261025.md)
without changing its runtime or schema, and its four example queries passed in
a fresh anonymous browser.
