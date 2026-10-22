# One-time CLI launcher

Recorded 22 October 2026, Asia/Jakarta. Baseline `5526333`.

The published entry package is `@zeer-dev/cli@0.3.0`, with one `zeer` executable
and exact dependency `@zeer-dev/chef@0.3.0`. Developers can run
`pnpx @zeer-dev/cli init` or select `@latest` without a global installation.
The launcher resolves and imports the real Chef CLI in the same Node process.
It preserves arguments, terminal detection, cancellation and sanitized errors;
no extra shell, child process, package downloader or scaffold is implemented.

An initial attempt to publish unscoped `zeer` was rejected by npm with E403:
the name was considered too similar to `bser` and `user`. That candidate was
never published. Direct `pnpx @zeer-dev/chef` also fails executable selection
because Chef retains two legacy aliases; the single-bin scoped launcher avoids
changing that compatibility contract.

The four-file scoped package contains only LICENSE, README.md, cli.mjs and
package.json. An anonymous registry download matched the accepted candidate:
SHA-256 `20ff140c79335c4b8aa362db07ae9b1476b9bba9c9137ef21179403b446cec0f`.
Three launcher tests pass: help/version, all scaffold choices and no-overwrite,
and sanitized nonzero failures. Independent review found no remaining issues.

Candidate and final registry installations were tested outside the checkout on
Windows and Linux. All three choices generated projects pinned to Chef 0.3.0.
Blank typechecks while empty and reports an actionable codegen error. Public
and shielded projects pass codegen and strict typechecking. No key, scanner,
database or chain payment is needed for this launcher-only test. The shielded
fingerprint is a placeholder used only for type-generation validation; this
does not count as a new receipt/decryption check. The separate SDK release
retains its own full integration evidence.

Actual Linux terminals displayed the wizard, handled SIGINT with exit 130 and
left no cancelled directory, both before and after publication. Actual `pnpx`
commands also initialized public/blank projects through bare and `@latest`
package specifications on Linux pnpm 9 and Windows pnpm 10.21.

pnpm manages its own dlx cache; `@latest` is a tag selection rather than an
unconditional registry request on every run. The cache-refresh option is
version-dependent: pnpm 9 rejects it as a pnpx prefix, so the docs qualify the
advanced form for pnpm 10+. Existing generated projects retain their lockfile
and SDK pin. No hidden updater or trust-policy bypass is included.

Retained setup failures include a Windows dependency-fetch timeout, a Python
test filename shadowing the standard `tty` module, and initial package-manager
404 responses after publication. Later standard registry installs passed.
No production indexer/database services were changed. The resource-bounded
Linux test jobs are inactive; no disposable database was required. Known
operator key/seed bytes were checked against publication candidates, with zero
matches. Machine-readable proof is retained beside this report.
