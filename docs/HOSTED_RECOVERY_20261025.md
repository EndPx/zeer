# Hosted Chef preview recovery — 25 October 2026

The public preview was restored after documentation activation, under explicit
authorization to bring the demo back. This was operational recovery of the
existing hosted projects, **not a hosted SDK/schema upgrade to 0.7.0**.

## Changes

- Restored the existing demo PostgreSQL container, block-summary HTTP reader and
  follower. Kept their database, configuration, namespace and checkpoint.
- Pointed the legacy loopback Prep socket proxy at the already active optimized
  reader. Updated its unit dependencies accordingly. The application's configured
  Prep URL stayed unchanged, preserving source identity. The inactive historical
  reader was not started, and the active reader/follower were not restarted.
- Corrected the memo reader's stale Docker database address after verifying that
  the existing database contained the expected deliberately published receipt.
- Found another container using the old memo port. Left it running, moved only
  the public memo reader to loopback port 39377 and changed the website's memo
  upstream to match. Restarted the website to load that environment change.
- Preserved private backups of the two proxy units, memo unit and affected
  environment files. Temporary diagnostic overrides were removed.

The existing hosted block-summary and memo packages report version 0.1.0. They
retain their deployed schemas; npm-installed projects use the separately verified
0.7.0 release. No migration, replay from genesis, signing, new transaction or
viewing-key loading occurred in this recovery. The original checkpoint resumed
normally and the follower caught up with Prep.

## Anonymous browser checks

| Example | Final response | Check |
| --- | --- | --- |
| Genesis block | 200 | Block 0 returned |
| Compare two heights | 200 | Blocks 1,000,000 and 2,000,000 returned |
| Latest indexed block | 200 | Current committed block returned |
| Read shielded memos | 200 | One selected receipt, `Hello from Zeer Chef`, 100,000 zatoshi; current-source block checks passed |

At **09:36:13 UTC**, both Prep and the block-summary Chef reported height
**4,539,807**, with a zero observed gap. This is a timestamped observation, not
an ongoing uptime guarantee. The memo projection remains intentionally bounded
to its selected historical receipt at checkpoint 4,523,291.

An initial Genesis validation attempt returned HTTP 429. Its cause was not
classified; it is retained in the evidence. A later fresh-browser traversal,
with normal spacing between actions, passed all four examples. This small
validation does not establish concurrent capacity or an error-free service SLA.

The aggregate **3 CPU / 8 GiB / 60 GiB** guard passed after recovery. Unrelated
applications and the container occupying the old port remained active. Final
publication proof is included in the [0.7.0 release record](CHEF_070_RELEASE.json).
