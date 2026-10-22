# Chef and launcher 0.6.1

Documentation patch prepared on 23 October 2026 (Asia/Jakarta). Publication and
registry verification are pending until the release result is recorded below.

The Chef README no longer excludes entity relationships. The launcher pins Chef
0.6.1. Prep client stays 0.1.0. No runtime, schema, handler, database or API behavior
changes are included. An unchanged existing project needs no migration or replay
for this patch.

## Candidate checks

- Packed Chef and launcher through their normal npm lifecycle.
- Compared every file with the anonymous registry 0.6.0 artifacts: Chef changed
  only `package.json` and `README.md`; launcher changed only `package.json`.
  All 62 other Chef files and all three other launcher files are byte-identical.
- Three launcher tests passed with no skips.
- An independent Linux project installed the Chef 0.6.1 candidate tarball without
  a workspace symlink. Newly generated Blank/Public/Shielded projects all passed
  typechecking; public/shielded codegen passed, and blank codegen correctly
  rejected the empty schema. All three refused overwrite and retained their
  generated credentials. Shielded used a test fingerprint; no key was loaded.

This patch does not claim a new 187-test Linux/native/PostgreSQL run or a new live
latency measurement. The [0.6.0 acceptance](CHEF_060_ACCEPTANCE.md) remains the
functional release evidence for the byte-identical runtime. The
[documentation audit](DOCS_060_AUDIT.md) separately checks current examples.

Candidate hashes and detailed logs are retained in the ignored local release
directory. No wallet operation, settlement or hosted namespace migration is part
of this patch.
