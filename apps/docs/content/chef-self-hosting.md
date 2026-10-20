# Self-hosting & troubleshooting

Run one writer and a separate authenticated reader against your PostgreSQL project. Use the same frozen configuration, schema, handlers and dependencies for both.

| Symptom | First check |
| --- | --- |
| Prep connection fails | URL, token, coverage and readiness |
| Range rejected | Available start and indexed height |
| Identity mismatch | Config/schema/source identity; use a fresh namespace for intentional changes |
| Empty entities | Filter, source range and checkpoint |
| No readable notes | Local key fingerprint, birthday and known transaction |
| API unavailable | Source validation and recovery state |
| Missing GraphQL field | This project's schema |

Keep database credentials and API tokens server-side. Bind local/private readers to loopback; configure TLS and access control for intentional remote access. Provide database backups and a process manager for continuous operation.

[Quickstart](/docs/chef/quickstart/) · [Recovery](/docs/chef/recovery/)
