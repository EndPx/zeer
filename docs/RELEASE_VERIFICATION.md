# Verify a Chef release

Treat npm publication, application upgrades and hosted project deployment as
separate operations. Publishing a package does not migrate an existing project.

1. Build and test the candidate. Run the isolated PostgreSQL checks for changes
   to migrations, entity storage, query semantics or recovery. Record skipped
   external-service checks explicitly.
2. Install the packed candidate into a fresh directory outside the checkout.
   Initialize a project, generate its model and typecheck the generated project.
   Verify the CLI help and an explicit numeric start height without a network.
   Test `latest` against a declared Prep endpoint separately.
3. Exercise an additive upgrade from the previous supported version in an owned
   disposable namespace. Stop its writer before migrating. Check entity values,
   checkpoint, project identity and the promised consumer behavior. An old cursor
   may be invalidated; it must produce an explicit recoverable outcome.
4. After the authorized npm publish, inspect the registry version, dist-tag and
   integrity. Download the registry tarball and compare its bytes/integrity with
   the reviewed candidate. Install the exact version from the registry into
   another fresh directory; do not substitute a workspace link or local tarball.
5. Repeat init, code generation, typecheck and a bounded runtime smoke check using
   that registry installation. The standalone receipt consumer additionally
   checks restart, invalid cursor, source unavailability and orphan removal.
6. Update public install commands and capability/upgrade notes to the verified
   version. Keep old benchmark versions pinned to the SDK actually measured.
   Build the docs, validate links and inspect the served pages before switching
   the docs release. Report hosted namespace upgrades independently.

Use private environment files and disposable database roles. Never record npm
tokens, database passwords, viewing keys or seeds in release evidence. Retain
the reviewed source revision, package integrity, test counts, operating system,
runtime versions and exact limitations. Delete disposable roles only after their
workers and consumers have stopped.
