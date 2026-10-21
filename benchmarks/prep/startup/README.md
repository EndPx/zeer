# Full-history admission

This study measures opening and validating a prepared archive in a fresh Prep
process. It does not measure archive ingestion, query latency or Chef indexing.
The recorded baseline and candidate source archives are linked from the public
[Prep benchmark evidence](https://zeer.endpx.cloud/docs/prep/benchmarks/).

Build the diagnostic executable in each recorded source tree:

```sh
cargo build --release -p prep-store --features admission-profile --example startup_profile
```

Prepare a frozen archive catalog and retain every referenced immutable segment.
Use an owned copy or hardlinks on the same filesystem; never alter permissions
on hardlinked source files. Retain optional sidecars identically in both trees.
Do not run this against an archive whose retained segments can disappear.

Run each executable in a fresh process against that same snapshot:

```sh
./target/release/examples/startup_profile /path/to/frozen-archive > profile.json 2> progress.jsonl
```

Apply the same CPU, memory, swap and elapsed-time bounds to both runs. The
recorded study used 0.5 CPU, 1 GiB charged memory and no swap under a shared
3 CPU / 8 GiB pipeline. A diagnostic deadline of 1,800 s was separate from the
unchanged 1,200 s readiness acceptance criterion. Production ingestion stayed
active. Caches were not cleared, and the runs were sequential; one sample per
variant cannot establish a median or a cold-disk speedup.

`startup_profile` emits admission-only timings and periodic progress. Unlike
`admission_phases`, it performs no extra full-history scan after opening. The
`admission-profile` feature adds diagnostic timers; build ordinary `prep`
without that feature for service validation. Mandatory checksum, decoded-record
integrity and raw-reference checks remain enabled in both builds.

The raw profiles retain phase calls, per-segment optional-index topology and
Linux process I/O. The publication includes exact native source archives,
binary hashes, the resource-bounded runner and first/middle/modern-tail query
comparisons against the previous reader and independent Zebra headers/TX IDs.

```sh
node apps/docs/scripts/verify-startup-benchmarks.mjs
```

Keep a real HTTP-service startup separate from this pinned diagnostic. Only
route traffic to a candidate after full live-archive readiness, query equality
and the application-consumption acceptance checks pass. Retain a warm rollback.
