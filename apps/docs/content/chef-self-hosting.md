# Self-hosting & troubleshooting

Chef runs in your environment with a compatible Prep endpoint and your PostgreSQL database. Running Chef does not require operating a local Zebra node when a suitable Prep source is available.

## Separate the writer and reader

The quickstart provides commands for migration, indexing/following and GraphQL serving. Run one writer per project namespace. The API reader is a separate process and can serve committed prefixes while indexing runs.

Use your own process manager and database backup policy when operating continuously. Keep the configuration, schema, handler version, package artifacts and lockfile together as a release. Use protected environment files for source/database credentials and bearer tokens.

## Keep private endpoints private

Bind a local GraphQL API to loopback unless you intentionally configure remote access with TLS and authentication. Private receipt and memo projections belong in the developer's own environment. The public website's adapters are not a gateway for your viewing key or arbitrary private Chef entities.

## Diagnose the actual state

| Symptom | First check |
| --- | --- |
| Cannot connect to Prep | URL, credentials, `/health`, `/height` and source readiness |
| Source range rejected | Available `start_block` and `indexed_height` |
| Project identity mismatch | Frozen config, schema, source URL and `handlerVersion`; use a fresh namespace for intentional changes |
| No matching public entities | Handler filter, activation/range and `_meta.height` |
| No readable shielded notes | Local scanner/key fingerprint, wallet birthday and known transaction |
| API unavailable during recovery | Status/read gate, source availability and the recovery window |
| GraphQL field does not exist | This project's schema, generated query names and supported API profile |

## Resource and performance expectations

Shared public Prep access is bounded. Source fetches, full transaction bytes, trial decryption, entity processing and database writes consume different resources. Plan for database and undo-history storage as well as CPU/RAM; measure the full workflow your application actually runs.

Start with [the standalone quickstart](/docs/chef/quickstart/) and use [checkpoints and recovery](/docs/chef/recovery/) before changing a running projection.
