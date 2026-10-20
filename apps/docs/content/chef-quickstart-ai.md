# Quickstart with AI

Open a working directory in your coding assistant and paste this prompt. You need Node 24.14+, Linux/WSL2 and PostgreSQL. The assistant should follow the same [Quickstart](/docs/chef/quickstart/) you would use manually.

```text
Create a standalone Zeer Chef testnet project in a fresh directory.

Read https://zeer.endpx.cloud/docs/chef/quickstart/ and
https://zeer.endpx.cloud/docs/chef/configuration/ before writing code.

1. Follow the Quickstart's installation method and run Chef init with
   start-height 0, a fresh directory and a new project name.
2. Install the generated project's dependencies, generate types and typecheck.
3. Configure the public testnet Prep URL and the intended PostgreSQL database.
   Keep credentials in the generated private environment file.
4. If the database is available, migrate the new namespace, serve GraphQL,
   and index through inclusive height 1. Compare entities/checkpoint with Prep.
5. Restart the same sync and confirm committed work is not duplicated.

Do not overwrite existing projects or databases. Keep handlers deterministic.
If a runtime dependency is missing, report that check as pending. Show the
commands and observed results separately from files merely prepared.
```

See [Quickstart](/docs/chef/quickstart/) for manual setup or [Local viewing-key setup](/docs/chef/shielded/local/) for authorized shielded receipts.
