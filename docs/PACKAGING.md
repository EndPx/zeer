# Release package verification

## Current release: Chef and launcher 0.7.0

Chef and launcher **0.7.0** add sync/follow progress heartbeats, build-produced
artifact identity and fixed operator diagnosis. Their registry verification and
fresh-install checks are recorded in [0.7.0 acceptance](CHEF_070_ACCEPTANCE.md)
and the [machine-readable release record](CHEF_070_RELEASE.json).

```sh
pnpx @zeer-dev/cli@0.7.0 init
```

The launcher pins Chef 0.7.0; Prep client remains 0.1.0. An otherwise unchanged
0.6.x project needs no new database migration or replay for this additive
diagnostics release. Stop its writer/API, back up the namespace, update its SDK
dependency and lockfile, then restart with the same configuration and identity.
Changing schema or handlers still follows the project evolution contract.

Source preflight/build-info improvements to the Rust Prep binary have their own
deployment lifecycle. Publishing the TypeScript SDK does not deploy that binary
or upgrade the hosted Playground's runtime/schema. Historical benchmarks retain
the exact package versions and candidate labels used during measurement.

## Previous release: Chef and launcher 0.6.1

`@zeer-dev/chef@0.6.1` and `@zeer-dev/cli@0.6.1` were published and verified
on 23 October 2026. Both latest tags selected 0.6.1 at that verification; anonymous downloads match
the audited candidates. The launcher pins Chef 0.6.1; Prep client remains 0.1.0.

```sh
pnpx @zeer-dev/cli@0.6.1 init
```

The package README now describes entity relationships consistently. Every packed
runtime and template file is byte-identical to 0.6.0; only package metadata and
the Chef README changed. An otherwise unchanged existing project needs no new
migration or replay for this patch. The [0.6.1 acceptance](CHEF_061_ACCEPTANCE.md)
records candidate and registry checks; the [0.6.0 evidence](CHEF_060_ACCEPTANCE.md)
retains the original functional/native/PostgreSQL verification. No new live
benchmark or hosted namespace migration is claimed.

## Previous release: Chef and launcher 0.6.0

`@zeer-dev/chef@0.6.0` and `@zeer-dev/cli@0.6.0` were published and
verified on 23 October 2026. Both `latest` tags selected 0.6.0 at that verification,
before 0.6.1 superseded them. Anonymous registry
downloads matched the audited tarballs; the launcher pins Chef 0.6.0.
Prep client remains 0.1.0.

```sh
pnpx @zeer-dev/cli@0.6.0 init
```

This release adds exact transparent input/output helpers, bounded previous-output
lookup, scalar/reference lists and nested GraphQL relationships. The
[transaction breakdown guide](TRANSACTION_BREAKDOWN.md) explains the model and
its limits. Existing scalar-only schema fingerprints are preserved. Adding the
breakdown model needs a fresh project namespace and replay; installing the
package does not migrate hosted projects.

The [release acceptance record](CHEF_060_ACCEPTANCE.md) contains the actual
testnet transaction and checks: 187 Linux SDK tests with no skips, three launcher
tests, an independent npm-installed testnet consumer, and all three registry
starters. Shielded starter checks use an unfunded fixture fingerprint and do not
claim a newly funded payment. The public docs describe the published API;
the hosted Playground keeps its separately deployed schema.

## Previous release: Chef and launcher 0.5.0

`@zeer-dev/chef@0.5.0` and `@zeer-dev/cli@0.5.0` were published on
22 October 2026. Both anonymous registry downloads matched the audited release
tarballs, both `latest` tags selected 0.5.0 at that verification, and that
version's launcher pins Chef 0.5.0.
Prep client remains 0.1.0. The database format and core indexing/query API are
unchanged from 0.4.0.

```sh
pnpx @zeer-dev/cli@0.5.0 init
```

New projects include a pinned Docker image, separate follower/API services,
explicit migration and status scripts, and namespace backup/restore helpers.
The [deployment contract](CHEF_DEPLOYMENT_PLAN.md) and
[self-hosting guide](https://zeer.endpx.cloud/docs/chef/self-hosting/) describe the
boundaries. Upgrading an existing SDK dependency does not add scaffold files.

Release evidence is retained locally under the 22 October deployment run:

- All 178 Linux SDK tests passed with PostgreSQL and the published native scanner,
  with no skipped tests. The CLI test suite passed all three tests.
- Standalone registry installations generated Blank/Public/Shielded starters and
  passed typechecking. Public/shielded codegen passed; blank correctly refused
  codegen until an application entity was defined. Repeated init refused to
  overwrite the project. Refreshed `pnpx @zeer-dev/cli@latest init` selected 0.5.0
  and recorded public Prep start height 4,528,727.
- Real public testnet state was backed up at block 4,528,626. A fresh-database
  restore exactly matched state, entities, blocks, undo and indexes, preserved the
  original database and continued through block 4,528,627 after explicit cutover.
  The custom archive was 9,426 bytes, mode 0600, with verified SHA-256 metadata.
- An unfunded public fixture produced six native-scanned notes: three Sapling,
  one Orchard and two Ironwood. Only the follower mounted the protected local
  key; the API had neither its path nor its mount. Both application containers
  ran non-root with read-only filesystems. This is fixture evidence, not a new
  funded shielded payment.
- All saved image layers were decoded before scanning for generated credentials,
  the fixture viewing key and canaries. The recording contains selected actual
  commands; its animation is an accelerated edit, not a performance benchmark.

The temporary image accounting initially omitted unpacked containerd storage.
Its earlier storage PASS was invalidated: the corrected run was approximately
199 MiB above the 59 GiB safety threshold, below the 60 GiB hard budget. Owned
resources were cleaned and accounting was corrected before another image build
was attempted. At 10:41:29 UTC, a separate stale-name race in the temporary
admission filter triggered `another_zeer_workload_is_running` during cleanup.
The guard stopped Zeer's node and application services. This was an operational
test failure. The original guard was restored after the transient resources
were removed. Fresh verification at 11:30 UTC confirmed all prior services active,
ready Prep data, a modern header matching the node, the public overview and the
published memo receipt. The follower CPU limit was restored to 50%. The legacy
memo reader's database host was repaired after PostgreSQL's container IP changed;
its credentials, database and projection were preserved.
Preserve both incidents and the final corrected checks alongside the release
record; do not describe every initial operational attempt as passing.

The additional Docker rebuild using a registry dependency locator was not run
after the monitor incident. Container evidence uses the tested local SDK tarball;
its bytes are identical to the published package. Separate fresh registry SDK
and launcher installations, all three generated starters and an actual refreshed
pnpx invocation were verified. Keep that distinction in release claims.

Temporary containers/images/volume/network and admission hooks were removed, the
original guard was restored byte-for-byte, and the reservation and child-slice
overrides were stopped/retired. The 44-page docs release was activated with a
rollback target. Final public browser verification is retained locally.

Package publication does not upgrade hosted namespaces or prove production
readiness. This delivery did not optimize Prep's full-archive cold start.

## Previous release: Chef and launcher 0.4.0

`@zeer-dev/cli@0.4.0` and `@zeer-dev/chef@0.4.0` were published on
22 October 2026. The launcher pins the exact Chef version; Prep client remains
`0.1.0`. Anonymous registry downloads matched the audited release tarballs.

The one-time CLI entry point is:

```sh
pnpx @zeer-dev/cli@0.4.0 init
```

It contains one executable and pins `@zeer-dev/chef@0.4.0`. The SDK keeps both
legacy executable aliases. The launcher imports Chef's actual CLI entry point
in the same process, preserving terminal cancellation and sanitized errors.
Run `npm run test:cli` before publishing a matching launcher/SDK pair. Verify
the four-file launcher pack manifest and a separate registry install; the
two-package verifier below continues to cover the SDK and Prep client.

An unscoped `zeer` publication was rejected by npm's similar-name policy. Do not
document `pnpx zeer init` as available. `pnpx @zeer-dev/cli@latest init` selects
the latest launcher tag subject to pnpm's cache and resolution settings; generated
projects keep exact SDK dependencies. See the [CLI reference](https://zeer.endpx.cloud/docs/chef/cli-commands/)
for refresh behavior. The [earlier 0.3.0 launcher verification](PNPX_LAUNCHER_VERIFICATION_20261022.json)
retains its historical version and results.

Chef 0.4.0 adds two commands and matching scripts in generated projects:

- `pnpm run doctor` performs bounded, read-only checks of project configuration,
  source compatibility and coverage, the PostgreSQL namespace, API token, listen
  port and optional local scanner/key identity. It reports fixed codes and
  guidance without migrating, changing read gates or uploading viewing keys.
- `pnpm run dev` generates entity types, runs the installed project's TypeScript
  compiler when `tsconfig.json` exists, and checks setup. It starts the API before
  the follower, stops both on cancellation, and stops the peer if a child exits
  unexpectedly. It does not install dependencies or start Docker. A prepared,
  compatible namespace is required by default.
- `pnpm run dev --migrate` explicitly permits the existing compatible migration
  path when migration is the only blocking diagnostic. It never resets an
  unmarked or incompatible namespace. With npm, use `npm run dev -- --migrate`.

The release preserves existing project fingerprints, database format,
canonicality gates and the three init templates. Blank requires an application
model and handlers before indexing. Shielded requires an explicit numeric wallet
birthday and protected local viewing-key configuration. The nine listed
scanner/consumer template assets remain part of the package allowlist.

The release gate includes installed-package checks for public, blank and
unfunded shielded-fixture projects, real child lifecycle on Windows and Linux,
missing migration, type errors, port conflicts, source interruption, peer
failure, cancellation and restart. Keep those observations separate from funded
or live shielded payment evidence. Publish the audited Chef tarball first, then
the matching launcher after the registry can resolve its exact dependency.
Verify downloaded package bytes and fresh registry projects before deploying
the corresponding docs. npm publication does not migrate hosted namespaces or
restart their processes.

Release acceptance covered all 156 Linux SDK tests with PostgreSQL and the
released scanner, three registry-installed starter profiles, compatible
0.3.0-to-0.4.0 continuation without migration, public testnet source equality,
and launcher installation on Linux and Windows. Actual pnpx commands used a
fresh Linux cache; the terminal wizard cancelled without creating a project.
The shielded starter checks used a public unfunded fixture. They do not measure
live payment discovery or establish whole-chain execution. Detailed local
reports remain outside version control; reproducible checks are in
[dev and doctor acceptance](../benchmarks/chef/dev-doctor/README.md).

## Earlier published releases

The last recorded published baseline on 22 October 2026 was
`@zeer-dev/prep-client@0.1.0`, `@zeer-dev/chef@0.3.0` and
`@zeer-dev/cli@0.3.0`. Chef 0.3.0 added blank, public-data and shielded-inbox
templates to guided init. Its package verification required all nine listed
scanner/consumer template assets and rejected unexpected package entries. That
release did not change the database format or upgrade hosted projects.

Chef 0.1.3 introduced guided setup with a `latest` default: one bounded
Prep metadata read captures the available testnet archive height and persists a
numeric start. Explicit numeric heights still initialize offline. Per-command
help and `--version` are available; complete flags and `--json` keep scripts
noninteractive. The `zeer` and `zeer-chef` aliases remain compatible.

Chef 0.2.0's public registry version, latest tag and downloaded tarball checksum
match the tested candidate. A fresh Windows registry consumer passed CLI version,
offline numeric init, code generation and strict generated-project typechecking.
Its core ran 37 passing integration checks on Linux with isolated PostgreSQL.
Native scanner checks were not rerun without their executable.

The earlier Chef 0.1.3 release also passed isolated Windows and Linux installation,
code generation and strict generated-project typechecking with pnpm 10.21;
Windows also passed with pnpm 12.14. The starter declares Node types
directly rather than relying on transitive dependency visibility. Actual Linux
terminal checks covered setup, Ctrl+C and end-of-input before file creation.

Chef 0.1.1 added `readShieldedTransaction` for a local
receipt source. A fresh registry consumer passed strict TypeScript checks and
read an actual mined testnet memo through public Prep and a local native scanner.
The Prep HTTP API and Chef's exact `0.1.0` Prep-client dependency remain compatible.

Both npm packages are public under `@zeer-dev`. The earlier Prep 0.1.0 / Chef
0.2.0 registry checks were recorded on 21 October 2026. Chef 0.3.0 was published
and verified on 22 October 2026: the registry tarball matched the accepted
SHA-256, fresh registry installs generated all three templates, and the Linux
SDK suite passed 132 tests with PostgreSQL and the released native scanner
enabled. See [onboarding verification](CHEF_ONBOARDING_VERIFICATION_20261022.json).
Rust Prep remains version `0.1.0` and is built from source.
Prefer the
[Chef quickstart](https://zeer.endpx.cloud/docs/chef/quickstart/) or
[Prep quickstart](https://zeer.endpx.cloud/docs/prep/quickstart/) for npm installation.

The package now includes `zeer-chef init` for independent testnet projects. Follow
[the standalone Chef quickstart](CHEF_QUICKSTART.md) for project setup.
The remaining instructions verify source-built release candidates. When testing
tarballs, install both together so the candidate's client dependency resolves locally.

Use Linux x86_64, including the documented WSL2 Linux route. The combined consumer
requires Node 24.14+, npm, and a clean source checkout. Run `npm ci` at the checkout
root before packing. Chef's `prepack` builds JavaScript and declarations from
source rather than trusting retained `dist`. Do not use `--ignore-scripts` for
the release pack. Prep client ships native-fetch JavaScript and declarations.

## Install the two local tarballs

From the checkout root:

```sh
npm ci
node examples/package-consumer/verify.mjs \
  --output benchmarks/results/package-install-$(date -u +%Y%m%dT%H%M%SZ)
```

The verifier packs both packages into the requested new ignored result directory,
checks their allowed contents and required license/entrypoint files, and creates
an empty consumer under the operating system's temporary directory. It installs
both tarballs together so Chef's exact `0.1.0` client dependency resolves locally.
No `@zeer-dev/*` registry package or workspace symlink is required. Third-party npm
dependencies may be downloaded; use `npm_config_offline=true` only when the local
npm cache already contains every dependency for the selected platform.

The consumer installs TypeScript `7.0.2` as a development tool. Chef supplies its
public Node typings as a dependency because its server declaration returns a
`node:http` Server. The consumer adds no separate Node type package. Verification
executes the installed Linux CLI link, checks ESM resolution stays inside consumer
`node_modules`, runs code generation using a standalone copy of the public example
config/schema, and typechecks all declarations with `strict: true` and
`skipLibCheck: false`. Negative type assertions cover unknown entity names and
incorrect BigInt input.

Output files include the npm pack manifests, installation logs, dependency tree,
typechecking and executable checks, and `consumer.json` with the retained consumer
path. A successful run writes `acceptance.json`; a failed run retains preceding
files and the consumer for diagnosis. Never treat absent acceptance as a pass.
Results stay under ignored `benchmarks/results/`. The temporary consumer is also
retained, including generated types and its lockfile. Remove only its recorded
directory when it is no longer needed.

## Exercise the installed packages against the fixture stack

Use the [quickstart](../examples/quickstart/README.md) to provision its isolated
captured-block fixture, Prep and PostgreSQL. These checks require the fixture's
complete range 1,687,106–1,687,108 and authentication enabled. They are fixture
replay evidence, not live-node following or reorg evidence. Run the verifier in a
Linux environment that can reach both the provided Prep endpoint and PostgreSQL.
The quickstart database has no host-published port: a verifier running on the host
needs its own reachable disposable PostgreSQL, or run the verifier on the isolated
Compose network with a clean dependency installation.

Supply `PREP_URL`, `PREP_API_TOKEN`, `DATABASE_URL` and a `CHEF_API_TOKEN` of at least
16 bytes through the environment. Do not put production credentials in evidence.
Choose an unused loopback GraphQL port:

```sh
node examples/package-consumer/verify.mjs \
  --output benchmarks/results/package-fixture-$(date -u +%Y%m%dT%H%M%SZ) \
  --integration --port 39470
```

Add `--indexed` to annotate `PublicTransaction.minedHeight` and
`Block.transactionCount` in the consumer's separate schema. The same installed
CLI, strict declarations, explicit migration and exact-output checks then exercise
the opt-in feature. This does not alter the default example or an existing
application namespace. Each invocation still requires a fresh output directory.

After package/type checks, the verifier queries Prep directly and independently
compares raw blocks and transaction bytes with the committed captured fixture.
It generates a unique project namespace, explicitly migrates, requires an empty
checkpoint, processes the first block, and starts the installed CLI's GraphQL
server on loopback. Every returned block/transaction entity is compared with
fixture-derived identities and fields, including exact integer values. Prep and
GraphQL requests without authorization must fail with HTTP 401.

The verifier stops its own GraphQL child, runs a new installed CLI invocation to
continue the two remaining blocks, starts GraphQL again, and repeats the independent
entity comparison. A repeated sync must commit zero blocks. It then stops its own
GraphQL child and closes its output handles. This demonstrates installed-package
checkpoint continuation; M2 separately owns actual source/Prep outages and branch
replacement. The verifier does not stop external Prep/PostgreSQL services or drop
its generated database namespace. Clean those disposable resources through the
owning experiment's cleanup procedure.

## Build and install the Prep server

The npm client does not distribute the Rust server. Use the source checkout,
the committed Cargo lockfile and pinned `rust-toolchain.toml` (`1.99.0`). Rustup
must have that toolchain available. The protobuf build selects its vendored
`protoc` executable through `protoc-bin-vendored`. Use the quickstart's pinned Rust
container when a system toolchain is not available. Run these builds sequentially
within the approved resource envelope:

```sh
cargo build --release --locked -p prep -j 2
# Set install_root to a new absolute directory below this run's local results.
cargo install --path crates/prep --locked --root "$install_root" -j 2
"$install_root/bin/prep" --help
```

Record the toolchain version, command output and installed binary invocation.
Then use that installed binary for the documented bounded Prep ingestion and HTTP
query workflow. Passing npm installation alone does not pass the server gate.

## Candidate acceptance

M4 requires both the isolated consumer integration and tested Rust server path.
M6 repeats clean installation and critical connected recovery on the frozen
candidate after relevant fixes. Verify the tracked diff and actual pack manifests
exclude local results, credentials, databases and generated runtime state. MIT
licenses travel in both npm packages; generated Rust protobuf material retains
its separately attributed source notices in the source checkout. No performance,
full-mainnet, private-scanning or public-deployment claim follows from this gate.

## Chef 0.2.0 consumption API

The published consumption API adds ordered ranges, revision-bound cursors and cached status. It passed isolated tarball and registry installation and the checks recorded in [the consumption verification](CHEF_CONSUMPTION_VERIFICATION.json). Updating the npm package does not migrate hosted project databases or restart their services; follow [the migration contract](CHEF_CONSUMPTION_API.md) for those upgrades.
