# Self-hosting & backups

Run your Chef project in the background with separate follower and API containers. The follower processes blocks and writes entities; the API reads committed data from the same PostgreSQL project. Prep remains an external data service.

New projects generated with **Chef 0.7.0** include the runtime files below. Keep the same configuration, schema, handlers and dependency versions for the follower and API. Upgrading an existing project's SDK does not add these scaffold files automatically.

## Recorded walkthrough

This testnet run creates a public indexer, starts its containers, queries committed data, restores a backup into a fresh database and restarts the follower. It used a local 0.5.0 candidate package and a constrained Docker builder on an isolated deployment. The animation shows selected real commands and their output, with shortened pauses; it is not a speed benchmark.

<picture class="overview-demo">
  <source media="(prefers-reduced-motion: reduce)" srcset="/docs/demos/chef-deployment-recovery.png" />
  <img src="/docs/demos/chef-deployment-recovery.gif" alt="Recorded Chef commands for container startup, querying, backup, restore to a new database and restart with retained state." width="1040" height="600" />
</picture>

<a href="https://zeer.endpx.cloud/docs/demos/chef-deployment.cast.txt" download="chef-deployment.cast">Download the selected terminal events</a>. Timing between selected events is retained. The recording demonstrates the public starter; the shielded setup below has a separate local-key requirement.

## Prepare the project

Use a Linux x86_64 Docker host with Docker Compose v2, Node 24.14+ and pnpm 10.21.0. The image uses Node 24.14.0 on Debian Trixie and pins its digest. Keep `pnpm-lock.yaml`; container installation uses `--frozen-lockfile` and fails if it disagrees with `package.json`. Finish your model and handlers before building a blank starter. Set the Prep URL and any required token in `.env`; the selected service must cover your configured start height.

```sh
pnpm install
pnpm run runtime:build
pnpm run db:up
pnpm run runtime:migrate
pnpm run runtime:check
```

Build generates entity types, checks TypeScript and builds the application image from the retained lockfile. It uses pinned Node and pnpm versions. Secrets, viewing keys and backups stay outside the image. Migration is a separate, explicit step; it initializes only a compatible project namespace.

The recipe uses the included PostgreSQL service and persistent volume. Container connections are assembled from `POSTGRES_PASSWORD` and `CHEF_DATABASE_NAME` (default `chef`). Host commands use `DATABASE_URL`. Keep both database selections aligned, especially after a restore. `runtime:check` runs Chef's read-only `status` command; it checks the namespace and Prep observation without running Doctor's local scanner/key checks.

| Setting | Default | Purpose |
| --- | --- | --- |
| `CHEF_DATABASE_NAME` | `chef` | Database used by containers and backup commands |
| `CHEF_API_PORT` | `39370` | Host loopback port for the API |
| `CHEF_POSTGRES_PORT` | `39472` | Host loopback port for PostgreSQL |
| `CHEF_UID` / `CHEF_GID` | `1000` / `1000` | Non-root runtime identity |
| `CHEF_HEALTH_MAX_AGE_SECONDS` | `60` | Maximum age of the cached source observation for API health |

If you change the PostgreSQL port, update host `DATABASE_URL` too. If you change the API port, update `CHEF_URL` for host queries. Containers continue using PostgreSQL's internal port and the API's internal port.

## Start and inspect

Stop an existing `dev`, `sync` or `follow` process for this project before starting the runtime. Only one writer may own a project.

```sh
pnpm run runtime:up
pnpm run runtime:status
pnpm run runtime:logs
```

Up starts existing images; it does not build or migrate. The API binds `127.0.0.1:39370` on the host by default. Use `pnpm run query` to query it. For intentional remote access, add your own TLS reverse proxy and access policy while keeping database credentials and API tokens server-side.

The API checks source and namespace state before listening. If the source is unavailable or the project is reconciling, startup fails visibly. The follower can continue recovery while Docker's restart policy retries the API. Inspect logs and status rather than treating a restarting container as ready.

The API health check reads authenticated `/status` without making a new Prep or RPC request. It requires a ready read gate and an available cached source observation no older than `CHEF_HEALTH_MAX_AGE_SECONDS`. Inspect the committed checkpoint and observation timestamp too: a historical checkpoint can be valid while still behind Prep. A healthy container does not prove complete history or network finality.

```sh
pnpm run runtime:stop
pnpm run runtime:up
```

Stop retains PostgreSQL data. A compatible restart resumes the persisted checkpoint. The recipe does not delete volumes automatically. Keep configuration and lockfile versions alongside each deployment so you can reproduce its image.

## Back up and restore

Backups contain this Chef project's namespace, including its entity data and recovery state. Treat shielded receipt backups as private data. Viewing keys are not needed for backup or restore and must be protected separately.

For a recovery drill with an exact comparison, stop the follower and API first. PostgreSQL stays running. Record the source checkpoint and entity snapshot with your database tools, then take the backup while the writer remains stopped. Compare the restore with this recorded state; a source that has resumed indexing may already have advanced.

Choose a new output filename in an existing private directory:

```sh
pnpm run runtime:stop
mkdir -p backups
chmod 700 backups
pnpm run db:backup --file backups/chef.dump
```

The script writes a PostgreSQL custom-format dump and companion `chef.dump.json` project/checksum metadata. It refuses an existing output. Keep both files together, copy them to protected storage and check command success before relying on them. Failed output is marked incomplete. The script is bounded to 180 seconds and a 4 GiB archive; use an operator-managed backup process for a larger database.

You can restart the original runtime after the backup completes. PostgreSQL's dump also supports a consistent online backup; the stopped-writer procedure above provides a fixed reference for the comparison in this drill.

Restore into a **new database**, preserving the source database:

```sh
pnpm run db:restore --file backups/chef.dump --database chef_restored
```

Restore checks the project metadata and checksum, refuses an existing target and creates the new database. It does not drop databases or overwrite the running project. A failed restore leaves its target available for diagnosis; choose another fresh name when retrying.

Confirm that restore completed, then compare the restored namespace's identity, checkpoint and entities with the backup/source records using your database tools. Keep the original database. After these checks, stop the project's follower and API, set `CHEF_DATABASE_NAME=chef_restored` and update the database name in host `DATABASE_URL` to match. Run `runtime:check`, then start the runtime and query its checkpoint and entities. Verify continued indexing before retiring the original database. Restored checkpoints still undergo normal source and canonicality checks.

## Shielded inbox

A shielded project automatically includes `compose.shielded.yaml` in the runtime commands. Set `ZEER_ACCOUNT_ID`, `ZEER_KEY_FINGERPRINT` and the absolute `ZEER_VIEWING_KEY_FILE` path in `.env`. The image installs the pinned watch-only scanner; no key enters the build. The follower alone receives the existing viewing-key file through a read-only bind mount. Set `CHEF_UID` and `CHEF_GID` to match its non-root host owner and keep the file mode `0600`. Missing files fail; Compose does not create a replacement directory.

The API and one-shot status/migration tools receive the configured account and key fingerprint so they can load the same project identity. They receive neither the key file nor its path. A successful `runtime:check` therefore does not establish key readability or successful note decryption; check the follower's actual output and a known receipt. Prep receives no viewing key. The database, API responses and backups can contain decrypted notes, amounts and memos, so authorize their readers accordingly. Scope labels do not identify the sender, and a receipt is an observation rather than a settlement instruction.

## Troubleshooting

| Symptom | First check |
| --- | --- |
| Build fails | Installed project dependencies, retained pnpm lockfile, schema and TypeScript errors |
| Migration required | Run `runtime:migrate` explicitly before starting the services |
| Prep connection fails | URL, token, coverage, readiness and source observation time |
| Identity mismatch | Config/schema/source identity; use a fresh namespace for intentional changes |
| Writer already active | Stop the other follower or dev process for this project |
| Empty entities | Filter, source range and committed checkpoint |
| No readable notes | Local key fingerprint, birthday, file owner and known transaction |
| API unavailable | Cached source observation, read gate and recovery state |
| Restore refuses the target | Use a new database name and matching backup metadata |

[Quickstart](/docs/chef/quickstart/) · [Recovery](/docs/chef/recovery/)
