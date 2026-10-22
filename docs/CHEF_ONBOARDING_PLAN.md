# Unified Chef onboarding

Baseline: `10b8f15`. The user approved CLI onboarding, bounded public-Prep
acceptance, then npm/docs release, and explicitly requested a blank option.

1. Add `blank`, `public` and `shielded` init templates. Guided setup asks for a
   template, project, directory, source and start height. Existing fully supplied
   scripts retain the public default unless `--template` is given. Public/blank
   default to one captured latest height; shielded requires an explicit numeric
   wallet birthday. Never collect key contents, download a key or start services.
2. Blank creates configuration, an empty schema and handler module, environment,
   local database recipe and documentation. No fabricated model or sample
   handler is inserted. Typechecking works; codegen/indexing gives actionable
   guidance until the developer defines a model and handler.
3. Shielded reuses the released scanner installer and existing reference
   consumer/query files through an explicit packaged template file list. It
   includes typed receipt handlers, exact note values, local-key configuration
   and pnpm scripts. Keep the protocol and financial-authority boundary.
4. Verify every generated template outside the repository, strict typechecking,
   codegen and actual PostgreSQL/CLI/query/restart where applicable. Test scanner
   fixture compatibility with the candidate package, with no funded transaction.
5. Separately exercise one then several consumers through public HTTPS Prep,
   under declared duration/request/resource budgets while production ingestion
   continues. Preserve 429/503 and retry outcomes. Compare complete output to
   independent source observations. No performance claim from loopback evidence.
6. Review both intent and standards, audit package contents and secrets, publish
   the next compatible Chef version, verify fresh registry installation and
   update existing docs chapters. Preserve the installed hosted services; this
   release does not migrate their namespaces. If npm requires user authentication,
   finish all independent work and request only that external verification.
