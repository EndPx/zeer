# Continuous consumer and scanner distribution

Baseline: `f893d97`, published Chef 0.2.0. Scope is Zeer observation and developer
onboarding. No signer, new funded transaction or ZeeSwap settlement is required.

1. Preserve the existing bounded RangeConsumer. Add continuous windows for
   block-scoped observations: immutable historical windows may be sealed only
   through Chef's reported undo floor. Reconcile the entire visible mutable tail
   atomically, including a shorter chain and removed/reincluded IDs. Persist
   progress and staged cursors, fence concurrent writers, bound each request,
   window and total storage. Unknown/decreasing recovery horizons, changed
   generations and recovery beyond sealed history must stop explicitly.
2. Test more than 1,000 blocks / 10,000 rows across windows, restart, cursor and
   generation changes, same output re-inclusion, source freshness, connection
   failures and storage budgets. Generic use requires block-scoped observations;
   mutable aggregate entities require a different reconciliation contract.
3. Distribute a versioned Linux x64 scanner for Linux/WSL2. Verify its checksum
   before execution, then check the keyless protocol/capabilities. Keep the
   scanner IPC compatible with Chef 0.2.0. Validate a fresh outside-repository
   install with the registry SDK and the released binary. Unsupported platforms
   retain the source build path. Keys are never downloaded or uploaded.
4. Run a bounded 3,600-second continuous-consumer study while production Prep
   ingestion remains active, inside the existing 3 CPU / 8 GiB pipeline. Backfill
   at least 1,200 real modern blocks and 12 public block-scoped entities per block
   (synthetic application rows, not decrypted receipts), then follow live blocks.
   Inject owned follower/API/consumer interruptions, verify resumption and final
   source equality. Record every availability/restart outcome, lag, resources and
   storage; do not equate this with shielded latency or a public API SLA.
5. Review code and evidence independently, publish the tested scanner assets and
   update the existing Chef guides. Preserve prior evidence. Batch related code,
   tests and measured acceptance into a reviewed release commit. Publish the
   immutable scanner tag against that source commit; group the subsequent
   public-delivery and documentation verification into one final record.
