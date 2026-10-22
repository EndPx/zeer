# Chef 0.6.0 documentation audit

Reviewed on 23 October 2026 (Asia/Jakarta). Scope: every page in the 44-page
`apps/docs/pages.mjs` manifest, its generated search/LLM descriptions, current
package READMEs and the linked Chef schema, consumption and receipt contracts.
The audit compares instructions with the published Chef/CLI 0.6.0 API, generated
templates and Prep client 0.1.0. Historical plans and measurements keep their
original dates and versions.

## Corrections

| Area | Correction |
| --- | --- |
| Overview and discovery | Identify the current Chef/CLI release, retain Prep client's separate version, expose relationships and the transaction breakdown example in feature/search descriptions |
| Starter defaults | Public uses 1,000-block pages and 32-block commits; blank and shielded use 16 and 1 |
| Start height | Only public/blank default to latest; shielded requires an explicit numeric birthday |
| Environment | Generated project/birthday are config literals; `.env` copies are references. Correct API origin, account/fingerprint, local query override and port settings |
| GraphQL | Clarify single-reference equality, nullable equality versus ordering, BigInt range exclusions and request limits |
| Relationships | Document reference indexes, inverse-list cost and paginated child-query recovery consistently |
| Transaction handlers | Describe all four transparent helpers, precise values, unresolved history and core versus public prefetch bounds |
| Evidence | Separate 0.6.0 acceptance from historical 0.1.3/0.2.0 benchmarks and the 0.5.0 deployment recording |
| Linked contracts | Mark the first public-data slice as historical; link the current relation extension from the consumption contract |

Chef remains a generic application-indexing framework. Public dashboards and
explorers do not require viewing keys. Shielded receipts remain a local,
experimental testnet workflow. Notification delivery, wallet state, signing,
order validation and settlement remain application responsibilities.

## Executed checks

- Registry metadata confirms Chef and CLI `latest: 0.6.0`, the exact launcher
  dependency and Prep client `latest: 0.1.0` with their respective Node engines.
- Eight command-help checks against the independently registry-installed SDK.
- Three newly generated starter directories against that installed SDK:
  typechecking passed for Blank/Public/Shielded; public/shielded codegen passed;
  blank codegen correctly rejected an undefined model. Tests reused the registry
  project's dependencies; they were not another fresh dependency installation.
  Shielded used a syntactically valid test fingerprint and loaded no viewing key.
- Five documented schema snippets parsed; six documented queries were accepted
  by the 0.6.0 HTTP GraphQL server against an empty snapshot test store. This
  checks the documented query contract, not new PostgreSQL integration evidence.
- Two complete TypeScript configuration examples passed codegen and typecheck.
- Four Prep scripts ran against bounded public testnet data: quickstart, client,
  transparent address outputs and transaction inspection.
- All seven published benchmark-artifact verifiers passed. These are checks of
  recorded data, not new live transfers or new performance measurements.

Production-build, browser and deployment outcomes are retained with the
page-by-page source hashes under the ignored local audit evidence directory.
The browser check covers every route, local anchors, navigation, search, copy,
mobile reflow, reduced motion and accessibility at 375, 768 and 1440 pixels.
No core runtime code, hosted namespace or financial execution changes belong to
this documentation audit.

Final outcome: the production build and all 44-page browser checks passed,
including zero reported axe violations at the three checked viewport sizes.
All 47 checked cross-page anchors and repository targets resolved. The static
docs release `20261023-docs060-audit-v1` was activated with a retained rollback
target and passing pre/post resource checks; application services were not
restarted. Every one of the 44 public HTML pages returned 200 and matched the
verified local build byte for byte.

## Published package README limitation

The immutable Chef 0.6.0 tarball contains a legacy sentence excluding relations,
despite its later section correctly documenting the feature. The repository
README is corrected by this audit, as is the public documentation. Updating the
README bundled in npm requires a new package version; this audit does not
overwrite 0.6.0 or claim to have published a patch. Its release manifest and
integrity hashes continue to identify the original published artifact.
