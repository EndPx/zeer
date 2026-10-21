# Release package verification

The current published npm versions are `@zeer-dev/prep-client@0.1.0` and
`@zeer-dev/chef@0.1.3`. Chef 0.1.3 defaults guided setup to `latest`: one bounded
Prep metadata read captures the available testnet archive height and persists a
numeric start. Explicit numeric heights still initialize offline. Per-command
help and `--version` are available; complete flags and `--json` keep scripts
noninteractive. The `zeer` and `zeer-chef` aliases remain compatible.

The public registry version, latest tag and downloaded tarball checksum match
the tested package. The same packed candidate passed isolated Windows and Linux
installation, code generation and strict generated-project typechecking with
pnpm 10.21; Windows also passed with pnpm 12.14. The starter declares Node types
directly rather than relying on transitive dependency visibility. Actual Linux
terminal checks covered setup, Ctrl+C and end-of-input before file creation.

Chef 0.1.1 added `readShieldedTransaction` for a local
receipt source. A fresh registry consumer passed strict TypeScript checks and
read an actual mined testnet memo through public Prep and a local native scanner.
The Prep HTTP API and Chef's exact `0.1.0` Prep-client dependency remain compatible.

Both npm packages are public under `@zeer-dev` and were verified on
21 October 2026. Rust Prep remains version `0.1.0` and is built from source.
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

## Chef 0.2.0 candidate

The consumption API candidate adds ordered ranges, revision-bound cursors and cached status. It passed isolated tarball installation and the tests recorded in [the consumption verification](CHEF_CONSUMPTION_VERIFICATION.json). Publication is awaiting npm account verification; the registry and hosted services remain at their verified versions above until that completes.
