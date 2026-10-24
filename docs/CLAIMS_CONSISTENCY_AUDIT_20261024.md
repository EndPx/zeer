# Website, documentation and repository consistency audit

Reviewed on 24 October 2026 (Asia/Jakarta). Scope: the public landing page and
Prep/Chef playgrounds, all **45 documentation pages**, the root and three package
READMEs, current API/storage/receipt/operations contracts, release records and
the planning entry point. Historical experiments retain their original versions,
failures and measurement boundaries. This audit checks claims and runnable
instructions; it is not another full SDK/native-scanner test run or benchmark.

## Claim matrix

| Claim | Implementation or evidence checked | Boundary retained |
| --- | --- | --- |
| Chef/CLI 0.6.1; Prep client 0.1.0 | Anonymous npm metadata, package manifests and exact launcher dependency | 0.6.1 retains the 0.6.0 runtime; hosted namespaces are separate |
| Prep provides public blocks and transactions | Full source/query implementation, advertised capabilities and four live documented scripts | Coverage and source readiness are explicit; Zeer does not validate consensus |
| Prep scans a finite captured range | Client continuation implementation, quickstart and browser query/pagination | `stream()` does not subscribe to new blocks |
| Chef runs TypeScript handlers and persists entities | Runtime, PostgreSQL store, starter configs and recorded application acceptance | Trusted deterministic handlers; external side effects are outside rollback |
| GraphQL supports relations and bounded lists | Schema parser, relation resolver and six executed documented queries | Read-only API, limits, revision-bound cursors and bounded recovery remain |
| Public and private observations have distinct access | Public adapters, local receipt contract and published memo query | Public Prep accepts no viewing key; the demo exposes only a deliberately selected receipt |
| Local UFVK permits readable testnet notes | Scanner/receipt contract, local configuration and release evidence | Sapling/Orchard/Ironwood profile; no Sprout, spendability, sender identity or settlement permission |
| Transparent analytics uses observed outpoints | Address example and recorded 512-block application study | Incomplete funding history remains unresolved; totals are not wallet balances |
| CLI setup has three starters | Eight actual command help calls and three registry-installed generated projects | Init does not install dependencies, load keys or start services |
| Template page/batch defaults differ | Actual public/blank/shielded generated configs | Public 1,000/32; blank and shielded 16/1 |
| Benchmarks describe measured workloads | All eight published artifact verifiers | Historical versions and resource allocations retained; no universal speedup or default promotion |
| Hackathon video is under two minutes | Public showcase release and asset metadata | Recorded 115-second explanatory animation, not a live execution or performance recording |

## Corrections made

- Clarified that the public console includes one published demo receipt and
  accepts no visitor viewing keys. The Chef page now identifies its hosted demo
  schema rather than implying visitors can query their own application there.
- Removed wording that could imply Prep's finite paging client automatically
  follows new data.
- Updated the launcher README's reproducible example from 0.5.0 to 0.6.1.
  Completed the Chef README's supported public filter/reference-index lists
  and distinguished the three starters' defaults.
- Updated the GraphQL upgrade guide to the current documentation patch and
  linked the current application study without relabeling historical timings.
- Corrected the engine guide's obsolete npm-publication exclusion, route/filter
  list, 10,000-segment limit and fixed-only query description. The current
  source permits 30,000 segments; adaptive scanning has separate time/byte caps.
- Updated the plan, delivery and operations entry points to distinguish current
  genesis-following public coverage from the historical fixed-range demo,
  the authorized 60 GiB envelope from its earlier 40 GiB scope, and published
  curated benchmark evidence from private raw logs.
- Made previous-release `latest` statements explicitly historical. Labeled the
  old three-minute local fixture walkthrough separately from the 1:55 submission
  video, and the original benchmark specification as a historical planning baseline.

## Executed checks

- Anonymous npm metadata matched Chef/CLI **0.6.1**, the exact launcher-to-Chef
  dependency and Prep client **0.1.0**, including their different Node engines.
- The independent registry-installed Chef 0.6.1 SDK passed **eight CLI-help
  checks** and generated **three starter projects**. All typechecked; public
  and shielded codegen passed, while blank codegen correctly rejected its empty
  model. Shielded used a fixture fingerprint and loaded no viewing key.
- **Five schema snippets**, **six GraphQL queries** and **two full TypeScript
  configs** passed against that SDK. GraphQL snippet checks used an empty test
  store and do not constitute new PostgreSQL integration evidence.
- **Four documented Prep scripts** ran against bounded real public testnet data:
  headers, client paging, transparent output matching and transaction inspection.
- All **eight benchmark artifact verifiers** passed. This recomputes recorded
  evidence; it does not rerun those benchmarks or competitors.
- All **45 built documentation pages** passed the browser checker, including
  navigation, search, clipboard, local anchors, reduced motion and tested
  375/768/1440-pixel reflow. Axe reported zero violations at those checked widths.
- A fresh real Chrome context with no saved cookies completed **15 public
  reviewer steps and 10 real Prep/Chef queries**, including the published memo.
  The final post-deployment run passed **16 steps and 10 queries**, adding
  assertions for the corrected hosted-schema, receipt and finite-paging copy.
- The website production build, TypeScript check and **six disconnected-source
  HTTP acceptance tests** passed. The first local HTTP invocation had no server
  on its default port and failed with connection refusals; the actual acceptance
  rerun used the built isolated preview with no upstream credentials.

The updated static docs and website are deployed with rollback targets. Every
public docs page matched its local production build after activation; the final
anonymous reviewer journey passed against the updated website. Only the website
runtime was restarted; node, Prep, Chef and database state were preserved. The
existing resource guard passed before and after activation.

## Remaining scope limits

No material contradiction remained in the claim matrix above at this audit.
That is a scoped review, not a guarantee that every repository sentence is
future-proof or every workload is production-ready. Recorded heights are
observations; consumers must query current readiness and coverage.

The immutable npm **0.6.1 tarballs** retain their original READMEs, including the
launcher example pinned to 0.5.0 and Chef's previously abbreviated filter/default
paragraphs. Their repository READMEs and current docs are corrected here. Runtime,
templates, versions and package integrity are unchanged. Publishing corrected
tarball READMEs would require a separate patch release; this audit does not claim
that such a release occurred.

Historical benchmark rejections, controlled reorg fixtures, six live receipt
samples, full-history startup and the later public application test remain
separate evidence. Organizer eligibility, final submission form and deadline
verification are outside this consistency audit.
