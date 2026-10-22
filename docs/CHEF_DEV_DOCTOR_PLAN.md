# Chef dev and doctor

Baseline `ddc0d9f`. The user approved dev supervision, setup diagnostics, registry
acceptance and consistent documentation in one release. Scope remains Zeer;
there is no signer, funded transfer or ZeeSwap settlement work.

1. Extract existing config/schema validation and project fingerprint calculation
   into a shared loader. Preserve byte input, defaults and JSON field order in
   the fingerprint; no database-format or namespace migration is introduced.
2. Doctor performs bounded, read-only setup checks: project/model/handler,
   source compatibility and coverage, PostgreSQL namespace/identity, API token,
   port, and optional scanner/key permissions/protocol/identity. Results use
   fixed codes and guidance, never credential values, key contents or raw errors.
   An invalid project skips dependent checks explicitly. Reconciling state is
   recoverable by the follower; blocked state is not forced open. Doctor never
   creates schema, runs codegen, starts Docker or changes durable read gates.
3. Dev generates types and checks TypeScript using the installed project's
   compiler when tsconfig.json exists. JavaScript-only projects are labelled.
   It reuses Doctor before starting the API, waits for actual listening, then
   starts the follower. Both run the same installed CLI with JSON events.
   The supervisor emits only bounded known status fields. A child failure stops
   its peer and exits nonzero; Ctrl+C/SIGTERM stops both, with a bounded forced
   process-tree shutdown fallback. Existing canonicality/read gates stay intact. A ready checkpoint known to be
   ahead of Prep must reconcile using follow before dev may start its API;
   already closed gates may recover in dev.
4. Default dev requires an already migrated compatible namespace. Explicit
   `dev --migrate` may call the existing migration path only if migration is the
   sole blocking diagnostic; it never resets incompatible or unmarked data.
   Compatible namespaces need no migration. No package installation or Docker
   startup occurs implicitly. Generated scripts load the local .env and SDK.
5. Verify real child lifecycle on Windows and Linux, port conflicts, type errors,
   missing migration, blocked/identity-mismatched projects, source interruption,
   peer failure, cancellation, restart and unchanged existing fingerprints.
   Standalone public/blank/private fixture projects must use installed packages.
   Keep public-chain and unfunded private-fixture observations distinct.
6. Publish matching Chef and launcher releases after review/audit; verify the
   exact registry bytes and generated projects. Update the existing Quickstart,
   AI guide, CLI reference, README and roadmap against actual evidence. Historical
   failures retain their labels. Public docs deploy after registry acceptance;
   hosted indexer namespaces and source services are not upgraded by this task.

Shared module contract for parallel implementation:

- `project.ts`: `loadProject(configPath) -> LoadedProject` with `configPath`,
  `bytes`, `config`, `model`, `reorgWindow`; `projectFingerprint(project, prepUrl)`;
  `projectEnvironment(project)` returns optional `prepUrl`, `prepToken`,
  `databaseUrl`; `envName` and `assertRunnable` preserve the existing rules.
- `doctor.ts`: `inspectProject({configPath, project?, host, port, signal?,
  store?, client?}) -> DoctorReport`; reports `command: doctor`, `ready`,
  `status: ready|not_ready`, `checks`, optional project/checkpoint/source metadata.
  Checks have `name`, `status: pass|warn|fail|skipped`, fixed `code` and `help`.
  Only `MIGRATION_REQUIRED` failures allow the explicit migration retry.
- The supervisor's tests and CLI integration belong to the root agent. The
  shared loader/Doctor implementation is isolated from docs/acceptance edits.
