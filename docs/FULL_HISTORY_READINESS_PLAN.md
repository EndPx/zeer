# Full-history readiness and uninterrupted receipt consumption

Baseline: `d35d2eb`, published Chef 0.2.0 and the existing live full-data archive.
Production keeps serving while isolated readers run. The aggregate 3 CPU / 8 GiB
envelope and candidate 0.5 CPU / 1 GiB ceiling remain unchanged.

1. Reuse opt-in admission profiling. Separate segment checksum, record I/O,
   decompression, raw-reference reconstruction, payload checksum, integrity
   decode, optional indexes and manifest compaction. Retain periodic progress.
   A diagnostic-only 1800-second cap permits classifying work that exceeded the
   prior readiness gate; it does not raise the 1200-second activation criterion.
2. Pin one full catalog using copies of metadata and hardlinks to immutable
   source files in a new owned snapshot. Never chmod hardlinked source files.
   Both profile variants use that identical catalog and retained segments.
   Do not clear host caches or claim cold-disk timings. Record source identities,
   fresh-process startup, CPU, I/O and memory, plus ongoing production ingestion.
3. Change only a measured expensive path. Verify every original integrity rule,
   corrupt/truncated/changed input rejection, snapshot identity and query equality.
   A candidate must reach readiness within 1200 seconds at unchanged limits and
   serve equivalent first/middle/modern-tail queries. Preserve failed attempts.
4. Test observer failure handling before new live transactions: transient/fatal
   storage errors, interrupted connections, source unavailability and deadline
   supervision. Logs retain safe error codes/stages without credentials or notes.
5. Run six new owned testnet self-transfers, selected external note 100,000 zatoshi,
   fee at most 10,000 each, aggregate fee at most 60,000. Bind exact operation IDs;
   keep local viewing/spending keys off hosted services. No ZeeSwap driver/payout.
   Resolve each original broadcast before progressing. Require six future mined
   blocks in one uninterrupted observer run; catch-up cannot satisfy that gate.
6. Report separate source/decryption/commit/consumer stages in seconds with all
   errors and waits. Recheck canonical block hashes and restart/deduplication.
   Upgrade the public Prep upstream only after full live-archive readiness and
   equality checks, retaining the warm original for rollback. Package/schema
   migrations are separate. Batch reviewed code, evidence and docs for publication.
