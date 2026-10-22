# Public HTTPS onboarding acceptance

This bounded test uses candidate-generated public-data projects outside the
checkout. Each project installs the accepted Chef tarball into its own
`node_modules`, performs code generation, strict typechecking and PostgreSQL
migration, then runs the actual CLI API and `sync --follow`. It stops and
restarts the writer, runs the generated query script, and compares the complete
eight-block `BlockSummary` range to an independent public Prep query. An optional
read-only configured-Zebra cross-check verifies every hash, predecessor, timestamp
and transaction count. There are no keys, scanners, signers or funded transfers.

## Profiles and bounds

Run the one-client phase before the three-client phase. Each phase has a shared
120-public-request attempt cap, a 105-second work deadline and a 120-second total
acceptance bound. Use an external process-group watchdog as well. The initial
range ends at the indexed height captured once from public `/height`; following
may observe more blocks, but equality is checked over that fixed eight-block
range. Setup and package downloads are not timing/performance measurements.

The actual CLI retains its default five-second follow polling. Writer starts
are staggered by 1.5 seconds. The fetch instrumentation counts attempts, records
status, bytes, Retry-After and transport failures, and enforces the hard cap. It
does not pace, queue, replace responses or retry CLI calls. It buffers these
small HTTP bodies to measure bytes before returning them; instrumentation adds
overhead, so this is correctness/recovery acceptance rather than latency data.
The production ingress stays at its existing two requests/second, burst eight,
and two active upstream requests. Natural 429/503 responses remain in the raw
result, with CLI `source_unavailable` states and every process outcome. If none
occur, this run does not establish rate-limit recovery. No overload is generated
to force them. The standalone oracle retries transient failures up to eight
times with five-second waits; these are explicitly labelled `oracle_waits` and
never attributed to SDK retry behavior.

Prep-client currently has no automatic retries. Chef follow catches temporary
source failures, keeps the reconciliation gate and retries after its poll
interval. Finite sync surfaces errors. This harness exercises follow directly,
without a wrapper that restarts failed CLI processes.

## Execution

Use Node 24.14+, pnpm, a dedicated disposable PostgreSQL database/role and a
nonexistent absolute work directory outside this checkout. The preparation step
only downloads packages; it never contacts Prep. It caps its installation at
240 seconds. The live phase is not authorized until the reviewed candidate
tarball is supplied by the release owner.

```sh
node prepare.mjs /private/outside/onboarding /private/release/chef-candidate.tgz
# Supply DATABASE_URL through a protected runtime environment file.
node run.mjs /private/outside/onboarding 1
node run.mjs /private/outside/onboarding 3
python3 verify-node.py /private/outside/onboarding/phase-1/result.json
python3 verify-node.py /private/outside/onboarding/phase-3/result.json
```

Each phase refuses an existing output directory, uses randomly named project
namespaces and refuses to reuse an existing namespace. Cleanup occurs after all
child processes stop and drops only marked namespaces that this phase created.
The root database/role lifecycle belongs to the caller. Generated `.env` files
are overwritten after shutdown. The result excludes credentials and captures
candidate identity, source observations, exact expected rows, command outcomes,
HTTP attempts, restart equality and cleanup. Keep any failure result; use a new
outside directory for a retry.

On the shared VPS, first run `/opt/zeer-testnet/guard.py --check`. Use the existing
registered temporary job unit only while inactive, under `zeertestnet.slice`,
with 0.5 CPU / 1 GiB / no swap / control-group kill. Preserve the shared 3 CPU /
8 GiB pipeline, all production services and ingress configuration. Record guard
and cgroup counters before and after. Successful private loopback studies do not
substitute for this real public HTTPS check; this check does not establish an SLA,
capacity ceiling, public stress-test result or shielded receipt latency.

## Local transport checks

```sh
node --test benchmarks/chef/onboarding-public/transport.test.mjs
```

These checks prove shared cap enforcement without pacing, deadline behavior,
single-release accounting and unchanged 429/Retry-After propagation with no
hidden retry. They are not evidence of live acceptance.

## Observed candidate acceptance, 22 October 2026

Both real HTTPS phases passed with candidate Chef 0.3.0, SHA-256
`ef956ae6932f2e5c2a3e819a4527455ab0b409c2df67d42a9f972e8a75128a7c`.
The one-client phase took 18.160 seconds and 11 public attempts. The three-client
phase took 39.951 seconds and 31 public attempts. Every completed request in
those phases returned 200. All four projects matched their complete eight-block
source ranges before and after restart; configured Zebra independently matched
all eight blocks in each phase. These are acceptance durations, not latency
benchmarks. No rate-limit/capacity recovery claim follows from all-200 traffic.

The first real attempt remains a failed trace: the harness stopped its writer
after a progress checkpoint during a subsequent source request. Aborting that
request correctly left the project reconciling and GraphQL returned 503. The
corrected barrier waits for the actual `caught_up` CLI event, during poll sleep,
before stopping. Two earlier setup failures concerned resolution of pnpm's
transitive PostgreSQL dependency and occurred before public traffic.

Cleanup confirmed zero active database connections, removed the owned database
and role, scrubbed generated environments, removed the runtime environment and
passed the resource guard. Existing services, shared resource limits and ingress
configuration remained intact. Peak observed concurrent public requests was one
despite three concurrent independent follower processes; this small staggered
profile does not measure maximum concurrency.

Raw phases, all failures, exact source projections, supervision, guard, cleanup
and frozen harness sources are retained in
`2026-10-22-public-onboarding.json`. Recheck them without network access:

```sh
node benchmarks/chef/onboarding-public/verify.mjs
```

This records the observed candidate. Final registry installation and any later
helper changes have a separate release acceptance responsibility.
