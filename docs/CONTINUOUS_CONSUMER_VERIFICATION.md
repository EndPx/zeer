# Continuous consumer and scanner verification

Recorded 22 October 2026, Asia/Jakarta. Baseline `f893d97`; published Chef 0.2.0
and Prep client 0.1.0 remain unchanged. This delivery changes the standalone
reference consumer, scanner distribution and existing documentation chapters.

## Application consumption

The new continuous mode handles immutable, block-scoped observations. Historical
windows advance only through Chef's retained undo floor. The complete visible
mutable tail is replaced atomically after a compatible traversal. Generation
changes, unknown/decreasing recovery horizons, recovery below sealed history and
storage limits stop explicitly. The original bounded RangeConsumer remains.
This is not an arbitrary aggregate cache, durable change feed or settlement
engine. The total-row budget still bounds local storage.

Local Node checks: 21 passed, one POSIX signal case skipped on Windows. Fresh
pnpm installation outside the checkout: 17 consumer tests passed on Linux,
including the actual SIGTERM and deadline paths. The installed package is Chef
0.2.0 from npm; pnpm's internal package symlink is not a workspace import.

Actual published CLI, PostgreSQL and consumer recovery passed in 12 bounded-mode
and 15 continuous-mode processes. The continuous fixture includes a sealed
prefix, shorter replacement branch and a previously observed ID re-included at
another height; final projection 468 rows. These controlled branches are
synthetic. They do not establish natural network-reorg behavior.

## One-hour operational study

The separate live run lasted 3,600.996 seconds after 49.203 seconds of bootstrap.
It backfilled 1,200 modern real headers and followed 143 more, generating twelve
synthetic application observations per block: 16,116 rows, zero duplicate IDs.
Every final row matched an independent projection from Prep headers; 32 evenly
spaced headers, including both endpoints, also matched configured Zebra RPC.

Four declared interruptions completed: consumer SIGKILL, API pause, stale-source
producer pause and producer SIGKILL. Persisted observations survived and the
consumer resumed. The artifact retains 18 stale-source and 11 transport waits.
No viewing key was loaded and no transactions were broadcast for this study.

The job shared 0.5 CPU / 1 GiB, with an external 4,500-second process-group cap,
inside the existing 3 CPU / 8 GiB pipeline while production ingestion continued.
Group CPU was 53.024771 seconds; charged memory peak 201,216,000 bytes; no OOM
kill. These counters include bootstrap, monitoring and finalization. Supporting
Prep and PostgreSQL are outside that job's counters. Sampling is discrete and
does not establish per-block latency, a public API SLA or maximum throughput.

The raw artifact retains source, row digest, faults, setup failures, corrected
sample capture timestamps, resource counters and standalone acceptance:

- `apps/docs/static/benchmarks/2026-10-22-chef-continuous-testnet.json`
- `node apps/docs/scripts/verify-continuous-benchmarks.mjs`

All seven documentation evidence verifiers passed, including prior failed
studies whose outcomes remain unchanged.

## Scanner delivery acceptance

Target: Linux x64 glibc, including WSL2 Ubuntu 24.04. Release tag:
`scanner-v0.1.0-testnet.1`. Protocol 1, experimental testnet watch-only profile;
other targets retain the source build path. The native binary is 1,750,872 bytes,
SHA-256 `1a24bcc9f066466ec9dab902b21d8619c8a4a5fffdd1a2c2d8fc099b3fa6b00c`.

Native Linux validation passed six tests with one fixture-regeneration case
ignored, plus clippy and release build. Windows source validation passed five
tests with that fixture case ignored. Missing toolchain components required an
initial setup retry; Cargo subsequently ran offline. No fully offline toolchain
bootstrap or reproducible-build claim is made.

Standalone acceptance verified all asset hashes, keyless installation,
idempotence, corruption rejection before execution and foreign-UID directory /
binary rejection on the real Linux filesystem. A fresh pnpm registry install
then ran actual CLI codegen/migration/sync/API, the packaged memo query and two
consumer invocations. All six notes across Sapling, Orchard and Ironwood matched.
This uses a public unfunded cryptographic fixture with synthetic chain context,
not a mined network receipt.

Separately, the same binary ran inside local WSL against a previously mined
owned note and matched its memo/value. The operator UFVK remained on the
developer computer; the temporary WSL key copy was removed. No new transfer was
needed. Checksums rely on the release publisher; there is no independent
signature or attestation.

## Review, cleanup and documentation

Independent standards and intent reviews both reported no remaining verified
findings. They assessed retained operational evidence rather than rerunning the
hour. Publication audit checked 100 files including archive members against
operator key/seed bytes and runtime credentials, with zero matches; the public
unfunded fixture is intentionally included.

The isolated study database and role `zeer_continuous_20261022` were removed after
confirming zero active connections. Temporary runtime credential files were
removed; production source credentials and original local wallet were retained.
The resource guard passed after cleanup; the temporary systemd job is inactive.

The docs production build and local browser check passed for all 44 pages,
anchors, search/navigation and clipboard flows, responsive layouts and automated
accessibility checks. Scanner publication, anonymous download/install validation
and public docs activation are recorded separately after delivery; this record
does not substitute for those steps.
