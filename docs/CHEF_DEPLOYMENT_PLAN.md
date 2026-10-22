# Chef deployment and recovery

Approved 22 October 2026: a generated-project deployment recipe, verified
backup/restore with continued indexing, and a walkthrough from real execution.
Baseline is Chef/launcher 0.4.0 at `2f2e30e`. Existing hosted namespaces, signer
and settlement behavior are outside this delivery. No new navigation product.

## Contract

- Ship matching Chef/launcher 0.5.0 after verification. Prep client and database
  format stay unchanged. Reuse `sync --follow`, `serve`, `status`, and `migrate`.
- Generate `Dockerfile`, `.dockerignore`, `compose.runtime.yaml`, `runtime.mjs`,
  `healthcheck.mjs`, `runtime-control.mjs` and `backup.mjs` in new projects.
  Shielded projects additionally receive `compose.shielded.yaml`.
- Base `compose.yaml` retains the existing dedicated PostgreSQL service. Runtime
  overlay adds follower/API and opt-in one-shot migrate/check tools. Pin the Node
  image digest and pnpm version; require a retained pnpm lockfile. Build generates
  types on the host and checks types in the builder; runtime never installs deps.
- Public/blank runtime images contain application code and production deps only.
  Shielded builds may install the pinned watch-only scanner without any key.
  Context/layers must exclude env files, key files, private state and backups.
- Runtime is non-root, read-only with bounded tmpfs, capability-free, no Docker
  socket, explicit CPU/memory/PID limits. API port is loopback-only on the host.
  PostgreSQL data uses its existing persistent volume. No implicit volume delete.
- Runtime entry assembles the container PostgreSQL URL with proper password
  encoding using POSTGRES_PASSWORD and CHEF_DATABASE_NAME (default `chef`). It
  calls the installed CLI in the same process. Serve first calls readonly status
  to reject blocked/unavailable/known-ahead state without requiring a scanner key.
- API receives only DB/API/source credentials and non-secret project/key identity, never
  the viewing-key mount or its path. Follower alone receives the protected local
  UFVK as a read-only file mount. Use matching host UID/GID for owner-only files.
- Source credentials permit the API's normal Prep readiness/canonicality checks;
  they grant no shielded viewing access. Protect them alongside the API token.
- API health uses authenticated cached GET /status, with explicit freshness and
  read-gate semantics. Running containers alone do not establish indexing readiness.

## Script interface

`runtime-control.mjs <build|migrate|check|up|stop|logs|status>` owns Compose argv
without a shell. Generated scripts use `node --env-file=.env ...`. Standard
Compose files: `compose.yaml`, `compose.runtime.yaml`, optional shielded overlay.
Build runs local codegen/typecheck first. Migrate is a separate explicit action.
`up` never migrates or rebuilds; it starts existing images. No default `down -v`.

`backup.mjs backup --file NEW_FILE` writes a custom-format dump of this project's
namespace using the dedicated postgres service. Write mode 0600, exclusive target,
bounded child execution, failure leaves a labeled incomplete artifact. Never log
credentials or dump bytes. Record checksum/project metadata without keys.

`backup.mjs restore --file FILE --database NEW_DATABASE` refuses an existing
database/current `chef` database, creates a fresh database, then restores without
owner/ACL changes or destructive clean flags. Never drops a target on failure.
Archive metadata must match the configured project before creating the target.
Retain original DB; switching CHEF_DATABASE_NAME and host DATABASE_URL is explicit
after verification. Backup operations never need viewing keys.

## Ownership and verification

Root owns scaffold/package integration, runtime-control, resource admission,
disposable deployment/restore acceptance, walkthrough artifact and release.
Runtime asset unit owns Docker/Compose/runtime/health assets plus deployment.ts.
Backup unit owns backup.mjs and focused tests, following the interface above.

Verify real containers, protected key only in worker, image/context secret canary,
stop/restart with retained state, consistent dump, restore to a fresh database,
entity/checkpoint identity and continued catch-up. Keep fixture private scanning
distinct from public testnet observations. Failed cases retain their labels.
Use bounded jobs under the existing 3 CPU/8 GiB/60 GiB shared envelope. Admit and
charge any temporary containers/images explicitly; no node/source restart or
unrelated cleanup. Remove only owned disposable resources, retain local reports.

Update existing self-hosting/quickstart/operations chapters. Record a terminal
walkthrough from actual commands; redact/omit secrets, label replay honestly.
Do not invent external developer feedback. Complete independent review and
registry/package acceptance before public docs delivery and one grouped push.

## Delivery record

Chef and launcher 0.5.0 are published; anonymous registry bytes match the audited
candidates. All 178 Linux SDK tests passed with PostgreSQL and the published
scanner. Fresh registry installs verified the three starters and the launcher;
refreshed pnpx selected 0.5.0 and captured Prep height 4,528,727.

Real candidate containers passed public indexing, restart and fresh-database
backup/restore with continued indexing. The private fixture produced six notes
across three pools with follower-only key access. Saved image layers were decoded
before secret/canary scanning. The recorded walkthrough labels its local-package
transport and accelerated excerpts. The extra registry-locator Docker rebuild was
not executed; it must not be presented as a passed container test.

The no-source-restart operational target was breached by the temporary monitor:
image storage was initially undercounted, then a stale-name race triggered a
pipeline halt during cleanup. Both incidents are retained in the local evidence.
The original guard was restored and the prior services recovered, including
validated RPC credentials and the legacy memo reader's changed PostgreSQL host.
Fresh verification at 11:30 UTC covered ready source metadata, a node-matching modern
header, public overview and published memo. Temporary follower CPU allocation was
restored to 50%; test Docker resources and admission hooks were retired. No
settlement, signer, wallet spending or hosted namespace upgrade was introduced.

Public docs activation and grouped delivery use the verified package bytes.
Detailed reports remain local; see PACKAGING.md for the bounded release record.
