# Public-data quickstart

Run complete public Zcash blocks through Prep, TypeScript handlers, your local
PostgreSQL and authenticated GraphQL. This example replays three captured mainnet
blocks (1,687,106–1,687,108); it does not connect to a live node or follow today's
head. The [fixture provenance](../../benchmarks/fixtures/mainnet-nu5-full-v1/README.md)
explains raw/decoded origins and verification limits. Shielded payloads remain
encrypted. No wallet, viewing key, hosted endpoint or npm account is needed.

## Requirements

Use Linux x86_64 or WSL2 with Docker Engine and Docker Compose v2+ available in
the Linux shell. Git, Bash and standard shell utilities are needed on the host;
Rust, Node, Python and PostgreSQL run in pinned container images. Allow at least
4 GiB available RAM and 10 GiB free disk for a clean build. Downloads require
internet access; Rust's first build can take several minutes. This is not a
promise of installation time. Images/volumes and build output consume real disk.

Start from a clean clone and run all commands from its root. The example uses
project-scoped Docker volumes and a disposable PostgreSQL password. Its database
and replay RPC have no published ports; Prep/GraphQL bind host loopback only.
The database and replay source use an internal network. Prep and GraphQL also
join an access network so Docker can publish their loopback ports; those two
containers can make outbound connections. Dependency setup/build use a separate
network. These fixture credentials and settings are unsuitable for public hosting.

```sh
git clone https://github.com/EndPx/zeer.git
cd zeer
cp examples/quickstart/.env.example examples/quickstart/.env
# Pick an unused project name if another quickstart already exists.
export COMPOSE_PROJECT_NAME=zeer-quickstart-demo
dc() { docker compose --env-file examples/quickstart/.env -f examples/quickstart/compose.yaml "$@"; }
dc config --quiet
dc run --rm build-prep
dc run --rm setup
```

Build/setup run sequentially. Build is capped at 2 CPU / 3 GiB, while running
fixture/PostgreSQL/Prep/API plus one CLI/check job is capped at 2 CPU / 3 GiB
in total. Quotas are ceilings, not dedicated cores; Docker and host overhead are
additional. Do not run builds alongside this stack on a constrained shared host.
Setup creates node_modules in a project volume, ignored Chef build output and
ignored generated types. It uses the committed npm/Cargo lockfiles. No existing
workspace dependency installation or benchmark-result directory is required.

## Ingest and query

```sh
dc up -d --wait fixture postgres
dc run --rm ingest
dc up -d prep
dc run --rm check --prep-only
dc run --rm chef codegen --config examples/quickstart/chef.config.ts
dc run --rm chef migrate --config examples/quickstart/chef.config.ts
dc run --rm chef sync --config examples/quickstart/chef.config.ts --to 1687106
dc up -d api
dc run --rm check 1687106
```

`ingest` archives all three complete blocks. Chef initially processes just the
first one. The config reuses the [public example's handlers and schema](../chef-public/README.md).
The checker compares every returned entity against the independent committed
fixture, including transaction sizes from raw bytes, block counts, identities and
exact integer fields. It also compares Prep's raw block/transaction bytes and
checks rejection of unauthenticated requests. A successful check prints `PASS`.

From the host, using tokens from `examples/quickstart/.env`:

```sh
set -a
. examples/quickstart/.env
set +a
curl --fail http://127.0.0.1:${PREP_PORT}/height \
  -H "Authorization: Bearer $PREP_API_TOKEN"
curl --fail http://127.0.0.1:${CHEF_PORT}/graphql \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $CHEF_API_TOKEN" \
  --data '{"query":"{ _meta { height hash status } PublicTransactionList(first: 10) { items { id minedHeight version sizeBytes } nextCursor } }"}'
```

Prep can be used directly without Chef: the checker demonstrates the typed
client's range/field selection. See the [client guide](../../packages/prep-client/README.md)
for batch lookup and pagination. Prep ranges end at an exclusive `to_block`;
Chef's `--to` is inclusive. BigInt GraphQL values are decimal strings.

## Restart and continue

```sh
dc stop api prep postgres
dc up -d --wait postgres
dc up -d prep api
dc run --rm check --prep-only
dc run --rm chef sync --config examples/quickstart/chef.config.ts --to 1687108
dc run --rm check 1687108
dc run --rm chef sync --config examples/quickstart/chef.config.ts --to 1687108
dc run --rm chef status --config examples/quickstart/chef.config.ts
```

The first resumed invocation commits only the two remaining blocks. Repeating
the completed range commits zero new blocks; the persisted checkpoint is the
source of truth. A target above 1,687,108 must fail with
`REQUESTED_RANGE_NOT_AVAILABLE`. The fixture cannot demonstrate new block arrivals
or reorgs. On a separately provisioned, compatible complete source, Prep's
`sync --follow` and Chef's `sync --follow` provide the live path; see the
[Prep commands](../../docs/PREP_ENGINE.md) and [Chef contract](../../docs/CHEF_PUBLIC_MVP.md).
Do not use this fixed fixture as evidence of connected real-node recovery.

## Repeatable verification and cleanup

For an automated version of the same partial-sync/restart/resume checks, use a
fresh project name and build/setup as above, then run:

```sh
bash examples/quickstart/verify.sh
```

It refuses a nonempty Chef checkpoint, retains outputs locally under the ignored
`benchmarks/results/` directory, and stops this example's services on exit.
It does not delete volumes. For manual exploration, stop with:

```sh
dc stop api prep postgres fixture
```

Keep volumes for resume. To remove this disposable example's state, first verify
`COMPOSE_PROJECT_NAME` identifies the intended quickstart, then use `dc down -v`.
Never substitute global Docker prune or delete another project's volumes.
On bind-mounted Linux/WSL checkouts, container setup may create root-owned ignored
build files; keep the checkout disposable or correct ownership only on those files.

If a port is occupied, change the two host ports in this example's `.env` before
starting. If setup fails, retain its output and resolve the dependency/configuration
error; do not reuse a partial build as successful setup. For identity/schema changes,
use a new project namespace and replay as described in the Chef contract.
