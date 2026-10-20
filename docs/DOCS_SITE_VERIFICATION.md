# Documentation site verification

Verified 21 October 2026. Public URL: [zeer.endpx.cloud/docs](https://zeer.endpx.cloud/docs/).

## Delivered scope

The Docusaurus workspace publishes 35 English pages: shared introduction and
architecture, Prep query/data guides, Chef application-indexing guides, and
Shielded & Memos nested under Chef. No additional console product/menu or public
viewing-key form was added. Existing website `/docs` links enter the new site.

The site uses the Zeer design system, local page search with Ctrl/Cmd+K, code copy,
responsive product navigation, section headings, metadata, sitemap, self-hosted
fonts and generated LLM references. Font notices accompany the static assets.
Search index download starts on user action; search terms remain in the browser.

`apps/docs/pages.mjs` is the publication allowlist. Concise public chapters live
in `apps/docs/content` and link to the full API, quickstart, scanner, evolution
and index contracts in the repository. Edit links point
at the actual source. The generator removes only its validated generated-docs
directory before writing, preventing retired pages from remaining routable.

## Functional verification

Commands from the repository root:

```sh
npm run build:docs
npm run serve -w @zeer/docs
npm run check -w @zeer/docs
npm run check -w @zeer/docs -- https://zeer.endpx.cloud
npm run typecheck -w @zeer/web
npm run build:chef
```

All commands passed during the initial publication/onboarding work. The current
editorial revision reran the docs build and browser checks; unchanged web and Chef
packages were not rebuilt for this docs-only revision. Real Chrome verified:

- HTTP 200 and the correct heading for all 35 pages; no missing same-page anchors.
- Explicit Overview, Quickstart and Quickstart with AI order in each product
  sidebar, with Getting Started and Clients next in Prep; AI guide navigation.
- No document-level overflow at 375, 768 and 1440px on the memo guide.
- Zero automated axe WCAG 2/2.1 A/AA findings on that guide at those widths.
- Ctrl+K search, memo-result navigation, empty-search feedback, Escape dismissal
  and focus return. The search index was not requested during ordinary browsing.
- Code clipboard copy and touch copy-control visibility without hover.
- Mobile drawer navigation between products and long-reference reflow with
  reduced motion enabled.
- Chef and Prep overview GIF loading, reduced-motion PNG selection, and zero
  automated axe findings on both overviews at 375px.
- Desktop primary navigation starts beyond the sidebar boundary at 1024, 1440
  and 1920px, with the brand still at the original left inset.
- Chef precedes Prep in desktop product navigation. The quickstart, client and
  benchmark pages pass reflow and automated axe checks at 375px and 1440px.
- The benchmark evidence link returns the actual JSON snapshot with 18 Prep
  samples and both recorded Chef runs.
- The existing website's Get started link navigates into the new documentation.

The real public Prep example returned genesis headers 0 and 1, with the requested
exclusive end of 2 and a completed cursor. The public Chef genesis entity's hash
matched the Prep genesis hash. This validates those public read examples; it is
not a new private memo-decryption or whole-chain performance experiment.

Build checks reject broken internal links. A regression check planted a retired
generated page, ran the actual generator, and confirmed the retired page was gone
while the then-current manifest pages were regenerated. `npm ci --dry-run --ignore-scripts`
accepted the final lockfile. Production JavaScript contained neither react-grab
nor react-scan; those tools are development-only.

## Independent review

The OMC Review standards and intent axes ran separately. Intent passed with no
actionable finding. Standards found one P2 stale-generated-page issue, which was
fixed and independently reverified. The final standards verdict was pass.

A further independent review inspected the final desktop/mobile memo-page
screenshots plus the search, font-preload and publication code. The rendered
design verdict passed for those supplied views. These bounded reviews do not
claim that all possible pages, devices, assistive technologies or upstream
dependency behaviors have been manually tested.

The concise-content review found one P2: optional Docker setup appeared to make
namespace migration optional for existing PostgreSQL users. The guide now makes
only `db:up` conditional and requires `migrate` and `status` for both choices.

## Supplementary diagnostics and limits

The initial 26-page publication's final single-run Lighthouse sample through real
Chrome against the public docs entry page reported:

| Profile | Performance | Accessibility | Best practices | SEO |
| --- | ---: | ---: | ---: | ---: |
| Mobile | 96 | 100 | 100 | 100 |
| Desktop | 100 | 100 | 100 | 100 |

These are lab samples, not multi-run medians, field Core Web Vitals, full WCAG
conformance or a claim that every performance target passed. Mobile performance
remains below the frontend skill's ideal 100 target. Earlier measurements varied
with verification load; do not interpret a score as a throughput guarantee.
The subsequent 35-page onboarding expansion was functionally reverified; this
table is retained as the initial release's sample rather than a new measurement.

React Doctor reported zero errors and one heuristic warning about fetching in an
effect. Source review and the browser request check establish that the effect
only registers a keyboard listener; fetching happens when the user opens search.
No data-fetching dependency was added to silence that heuristic.

Patched Tinypool and serialize-javascript are pinned through root overrides and
the lockfile. The final npm audit still reports 43 affected package entries
(28 high, 15 moderate, zero critical), through three underlying build-tool
advisories: braces, postcss-selector-parser and uuid. This is not a zero-advisory
dependency claim. Only static output is deployed; the Node development/preview
server and its dependency tree are not public services.

## Publication and evidence

The onboarding expansion adds nine guides: Chef and Prep Quickstart with AI,
Prep Getting Started, Clients, cURL examples, API access/tokens, Supported
networks, Troubleshooting, and Chef benchmark methodology. Home-page sidebars
link both starting paths; existing URLs and descriptive article titles remain.

The Prep client guide's JavaScript block was copied without alteration into a
fresh consumer, installed from the actual local tarball, and run against the
public endpoint. It returned block heights 0 and 1, `next_block: 2` and a null
cursor. All three query bodies in the cURL guide were executed against the
public API, checking genesis headers, modern pool counts and the known testnet
transaction ID. The AI prompts were reviewed against actual interfaces; this is
not a claim of a new autonomous database or private scanner execution.

The static release is served by a dedicated `/docs/` Nginx location, with gzip for
text assets and an immutable release directory behind a docs-only symlink. HTTPS
routes, `nginx -t` and the existing resource guard passed. The prior release and
vhost configuration remain available for rollback. Prep, Chef and the existing
Next.js service were not restarted by documentation publication.

Detailed screenshots, browser reports, public query responses, Lighthouse output
and deployment helpers remain local under `.deploy-local/docs-site-20261021/`.
The additional client/cURL verification and publication helper are under
`.deploy-local/docs-onboarding-20261021/`.
The current revision keeps Supported networks to one chain/network/Prep-URL
table plus notes. All 35 chapters were shortened around their named topic.
Chef and Prep overviews now use original explanatory diagrams rendered by
`apps/docs/scripts/render-overviews.py`, replacing the playground captures.
Each GIF plays once for 4.8 seconds and settles on the complete diagram. Prep
shows block selection and JSON; Chef shows handlers, entities and GraphQL.
These are illustrations, not execution or throughput measurements. Static
frames replace animation for reduced-motion preferences. The earlier screenshot
evidence remains under `.deploy-local/docs-concise-20261021/`; final browser screenshots are under the
site verification directory above. The three cURL bodies were reverified.
No viewing keys, local environment, private receipt output or third-party research
corpus is part of the published static release or this commit.

## Quickstart, wording and npm release preparation

Envio's HyperIndex quickstart was opened in the user's browser and copied with
its Copy page control. It informed the prerequisites → installation →
configuration → run/query → generated files → next steps structure. Its EVM
import wizard, videos and performance claims are not Zeer features.

All 35 chapter sources were reviewed from the perspective of a new developer.
The manual and AI paths now agree, basic entity/checkpoint/reorg terms are
explained where introduced, the core schema/handler/GraphQL examples share the
starter's BlockSummary entity, and standalone recovery/evolution commands use
the generated environment-loading npm scripts. Two independent review axes
identified setup/release consistency issues; their fixes were checked in source.
Both final review verdicts passed. This was a developer-perspective review and
browser walkthrough, not a study with outside users.

Both npm manifests are prepared for public release with package-specific source,
license, registry and documentation metadata. The SDK's 33 tests and the 31
selected Chef CLI/schema/scaffold tests passed; the final scaffold wording change
also passed its three tests. Local tarballs were installed in a fresh Windows
consumer, both public client-guide scripts returned actual heights 0 and 1,
and an independent generated project passed codegen and strict typechecking.
This is package/source validation, not a new database or Linux integration run.

Registry publication is **not complete**. The signed-in account is `endpx`;
the requested `@zeer` scope belongs to the separate `zeer` npm account. The
browser lists `adelos` and `atfi` as the signed-in account's organizations.
The real publication attempt stopped at npm's WebAuthn/security-key challenge;
no package version was published. No 2FA settings, passwords or permissions were
changed. A scope decision and user-controlled passkey verification remain.
The public quickstarts therefore retain working source/tarball installation
instead of advertising unverified registry commands. Prepared registry-based
drafts and release verification stay in `.deploy-local/docs-release-20261021/`.

## Published historical benchmark evidence

The owner's 21 October request authorizes publication of the sanitized
20 October testnet snapshot. All 18 Prep samples and both Chef result objects
were matched to their original local files; four source SHA-256 values also
match. `node apps/docs/scripts/verify-benchmarks.mjs` recomputes the displayed
aggregates. Prep reports three-run medians; Chef reports one run per profile.
Worker/support-process quotas, prepared archive, loopback transport, empty
Orchard scan and timing exclusions are stated alongside the tables.
No benchmark process was relaunched for this documentation revision.
