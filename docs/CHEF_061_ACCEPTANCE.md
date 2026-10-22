# Chef and launcher 0.6.1

Chef and launcher 0.6.1 were published and registry-verified on 23 October 2026
(Asia/Jakarta). Both latest tags select 0.6.1. Anonymous tarball downloads match
the audited candidates; the launcher pins Chef exactly 0.6.1.

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

## Registry verification

A fresh independent Linux project installed the published launcher from npm and
verified the corrected Chef README in its dependency. Blank/Public/Shielded
projects each installed dependencies from the registry, pinned SDK 0.6.1,
passed typechecking and refused overwrite. Public/shielded codegen passed; blank
correctly rejected its empty schema. No viewing key was loaded. An actual
`pnpm dlx @zeer-dev/cli@0.6.1 --version` returned `0.6.1`.

Current documentation commands target 0.6.1 while the 0.6.0 acceptance and older
benchmark records retain their original versions.

The production documentation build passed. The static release
`20261023-chef061-docs-v1` was activated with passing pre/post resource checks and
a retained rollback target. All 44 public HTML pages returned 200 and matched the
verified local build byte for byte. Application services were not restarted and
hosted namespace schemas were not changed. Machine-readable integrity and install
results are in [the release record](CHEF_061_RELEASE.json).
