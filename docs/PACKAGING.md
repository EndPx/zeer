# Release package verification

The local candidate versions are `@zeer/prep-client@0.1.0`, `@zeer/chef@0.1.0`
and Rust Prep `0.1.0`. They implement the current public-data contracts. This
candidate adds build-on-pack and public Node typings for Chef; it does not change
the package entrypoints or Prep HTTP API. Both npm packages are configured for
public publication under `@zeer`. Registry publication is a separate final step:
verify it with `npm view @zeer/prep-client@0.1.0 version` and
`npm view @zeer/chef@0.1.0 version` before relying on registry installation.

The package now includes `zeer-chef init` for independent testnet projects. Follow
[the standalone Chef quickstart](CHEF_QUICKSTART.md) after producing tarballs.
The generated project's installation must receive both local tarballs together
while the packages remain unpublished.

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
No `@zeer/*` registry package or workspace symlink is required. Third-party npm
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
