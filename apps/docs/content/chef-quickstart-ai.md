# Quickstart with AI

Open the Zeer checkout in your coding assistant and paste this prompt. You need Node 24.14+, Linux/WSL2 and PostgreSQL for the runtime steps.

```text
Create a standalone Zeer Chef testnet project in a fresh directory.

Read docs/CHEF_QUICKSTART.md, docs/PACKAGING.md, packages/chef/README.md
and the actual starter before writing code.

1. Build and pack the local Prep client and Chef tarballs, then run Chef init
   with start-height 0 and a fresh project namespace.
2. Install both tarballs in the new project. Generate types and typecheck.
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
