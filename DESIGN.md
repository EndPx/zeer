# Zeer website design system

## Live network status panel — 18 October

The console overview uses one compact network panel inspired by the user's
sync-status reference. Reuse panel/bg/line/text/muted/lime/cream tokens, 24px
panel padding, 12px radius, 24px gaps, 14px labels and 12px supporting text.
Two independent meters distinguish whole-history availability (archive block
count / observed source block count, including genesis) from Chef completion
within Prep's available range. Never use indexed height / tip as history coverage
when the archive starts above zero. Incomplete percentages never round to 100%.
Counts use tabular numerals; unknown/stale/disconnected states have explicit text.

An eight-block rail uses actual recent Prep headers, not synthetic chart points.
Each tile shows its full height and block time and links to a one-block query.
Use a four-column rail, two columns below 800px; meter rows and metadata wrap
below 540px. The network title owns attention. Static connector lines explain
the pipeline; no decorative pulse implies receipt of a block. Meters transition
with transform over 240ms only when observed values change, disabled for reduced
motion. Status refreshes every 15 seconds while the document is visible, with
one owned request and cleanup on unmount. Last known data is labeled on failure.

Status: **frontend implementation authorized on 2026-10-17**, following review of the landing and console proposals.

## Current hero craft contract — logo-led revision

Latest motion direction: the user explicitly wants continuous movement, a floating
logo and a dark reflective grid floor inspired by the reference, with no playback
buttons. This supersedes the earlier 4.8-second stop rule. Keep the selected logo
asset. Image and seam particles float together over 7.2s with 14px vertical travel
and at most 0.45 degrees rotation; shadow/ground glow breathe on the same clock.
Floor geometry, atmospheric lighting and the soft reflection remain separate
from the floating group. Decorative layers are clipped and pointer-inert.
Seam particles repeat continuously; the stack repeats its sequence every 6.4s,
including a reading hold at the application stage. All loops pause/stop when
offscreen or the page is hidden, and reduced motion renders the static scene.

The user's latest reference is material/lighting inspiration only. The hero asset
must reproduce the actual Zeer emblem's two interlocking ribbons and diagonal
negative-space cut. `hero-zeer-mark.png` is an original 3D rendering derived from
the selected logo board: graphite faces, polished bevels and pale-lime edge light.
It replaces the earlier three-slab artwork. No annotations or arrows cover the
emblem; the separate StackDiagram owns the architecture explanation.

Favicon: use the same two-ribbon sliced-Z silhouette as the selected brand board,
without the wordmark. The native SVG traces its rounded outer caps, full top/bottom
bars and diagonal negative space, in lime on a charcoal tile, readable at 16–32px.

The hero stays asymmetric: readable headline/CTA on the left, one large sculptural
mark on the right. The illustration and its SVG light particles share a square
frame and one parent transform. Three particles repeatedly traverse the existing
diagonal seam over 3.2s with 0/450/900ms offsets while the whole mark floats.
Motion pauses/stops while hidden/offscreen and is absent with reduced motion.
There is no playback UI or automatic cutoff. Text stays still and readable.
Product tab motion remains; no pinned scroll or independent per-card reveal is added.

Landing refinements use existing brand tokens: 84px maximum desktop hero heading,
18px lead, 14px product descriptions and stack descriptions, 12px secondary
capability captions, 32px hero gap. Capability items gain one explanatory line.
Hero action arrows move 2px up/right over 180ms on hover or keyboard focus.
Below 800px the hero stacks; capability captions remain readable in a two-column
grid, changing to one column below 360px. This contract supersedes earlier hero
geometry and annotation studies.

Implementation contract: Next.js App Router in apps/web; `/` is the marketing
landing, `/app` the console, `/app/prep` and `/app/chef` the separate playgrounds.
The principal motion is a repeating lime data trace over the floating Z illustration that
explains Prep-to-Chef flow; the static content remains visible without motion.
Automatic motion repeats while visible, pauses/stops offscreen and is removed
for reduced motion. No playback controls, scroll pinning or scroll hijacking.
Use server-rendered composition, client islands for tabs/editors, and server-only
fixed-upstream API adapters. Never send deployment tokens to the browser.

The earlier three-slab reference was superseded by the current logo-led contract
above. The actual two-piece Zeer mark owns hero geometry; the supplied sculpture
image is only a material/lighting reference. Keep the hero unannotated, preserve
offscreen/reduced-motion behavior and omit Play/Pause/Replay controls. Architecture
labels and the full direct API branch belong to the separate stack diagram.

Latest user ordering correction: place `The Zeer stack` / `Two layers. One developer
workflow.` before Choose your layer. Order: capability strip → The Zeer stack →
Zeer Prep examples → product tabs → closing CTA. Four bordered nodes
read Zcash → Prep → Chef → Your app, with a separate dashed Prep → Your app path
labeled `Direct API (from Prep)`. Desktop has four equal nodes separated by arrows;
below 700px, nodes stack with downward arrows and a dashed bypass on the right.
Use existing panel/line/lime/cream tokens, 48px section spacing, 24px card padding,
48px desktop heading / 32px mobile heading. Diagram semantics remain visible
without JavaScript or motion. Product tabs and the query explorer remain intact.

Console extension, 2026-10-17: [Developer Console design](docs/DEVELOPER_CONSOLE_DESIGN.md)
owns the Overview / Prep Playground / Chef Playground shell and data-state rules.
It reuses this visual system. The review board is `assets/design/zeer-console-v1.png`;
the depicted historical sample is explicitly disconnected, not a live deployment.

The user requested a website inspired by https://envio.dev/ and reviewed the
design before authorizing implementation. The local Next.js website now follows
this contract; the raster mockups remain design references. Public hosting and
full-chain API availability are separate milestones.

**Network update (16 October): the intended hosted service, Chef demo and
playground target Zcash testnet only.** Add a persistent `Zcash Testnet` label
beside query coverage. Existing mockup numbers derive from historical mainnet
fixtures; replace them with verified testnet examples before implementation
acceptance. Do not relabel mainnet fixture responses as testnet. Full-history
testnet availability and genesis support are goals, not completed capabilities.

## 0. Research log

- Inspected the live Envio homepage in the user's Edge browser: hero, navigation,
  product sections, query examples, developer CTAs and footer. Observed its dark
  surfaces, generous headline spacing, bordered code panels and paired product
  narratives. The rendered hero uses Inter at 72px / 72px, weight 700 at the
  inspected desktop viewport. Zeer's tokens below are original proposals, not
  claimed measurements of Envio.
- Used the selected `assets/brand/zeer-logo-concept-v2.png`: sliced-Z mark,
  lowercase wordmark, charcoal and lime identity.
- Checked README, the Prep query contract, the Chef example schema and quickstart
  to keep product copy aligned with implemented public-data features.
- UI/UX lookup suggested dark developer-tool surfaces and a sans/mono pairing.
  Its FAQ-led landing structure did not fit this product brief and was rejected;
  the user's Envio reference owns the page hierarchy.
- ImageGen produced desktop and mobile concepts. Files:
  `assets/design/zeer-home-desktop-v1.png` and
  `assets/design/zeer-home-mobile-v1.png`. Prompts and review notes are in
  `assets/design/README.md` and `assets/design/generation-prompts.md`.
- The frontend router's `imagegen-frontend-web.md` reference was missing from
  installed skills. The available imagegen skill supplied the mockup workflow.
- Initial research produced raster studies. Implementation and local browser
  verification followed on 17–18 October; see the review status below.
- Revision 2026-10-16: user prefers the supplied Envio tabbed product layout.
  `assets/design/zeer-product-tabs-v2.png` shows Chef-active and Prep-active states
  for review. It supersedes the separate product sections in both v1 homepage
  mockups; the two states appear together only on this review board.
- Additional user reference: the HyperSync example selector and JSON/cURL/client
  tabs. `assets/design/zeer-prep-query-explorer-v3.png` proposes a separate Prep
  example builder after the product overview; it does not replace the product tabs.

## 1. Atmosphere and identity

A precise developer workspace with generous marketing-page spacing. Charcoal
surfaces and pale lime connect the site to the existing Zeer logo. The signature
is a dimensional sliced-Z data sculpture: public blocks enter Prep, then either
go directly to an application or pass through Chef. The narrative makes these
two routes explicit. The sculpture is decorative; a separate readable diagram
explains the architecture.

Audience: a Zcash application developer choosing a data source or building an
application API. Secondary audience: technical reviewers evaluating what the
project does and how to reproduce its examples.

Primary journey: understand Zeer → choose Prep or Chef → open a runnable
quickstart. Secondary journey: inspect the contracts and source on GitHub.

Site language: English. Review conversation: Indonesian.

Accepted product responsibilities (16 October): Chef corresponds to the
application-indexing framework role; Prep corresponds to the data-source engine
role. The introductory paragraphs in README.md own the canonical product
description. Chef owns schema/TypeScript handler/application entity/GraphQL
work; Prep supplies public chain data and is independently usable by applications.
Database ownership depends on deployment: operator-managed for our hosted demo,
developer-managed for self-hosted installations. Do not imply database-free Chef,
feature parity with Envio, published npm packages, or an unmeasured speed multiplier.
Keep source preparation versus retrieval versus application indexing explanations
in benchmark material rather than adding them to landing-page marketing copy.

Direction selected for review: spacious dark infrastructure site with one
dimensional brand focal point. A dense terminal layout would compete with the
product explanation; a literal kitchen/restaurant theme would obscure it.

## 2. Color

Dark theme only for this proposal; no theme toggle in the first implementation.

| Role | Token | Value | Use |
| --- | --- | --- | --- |
| Charcoal | `surface-base` | `#0C0F12` | Page background, dark button text |
| Graphite | `surface-panel` | `#14191D` | Code panels and navigation |
| Paper | `text-primary` | `#F4F6F2` | Main text |
| Sage gray | `text-muted` | `#A9B2AC` | Descriptions and metadata |
| Lime | `accent-prep` | `#C1F75B` | Primary CTA, Prep links, hero emphasis |
| Cream | `accent-chef` | `#F2D49B` | Chef identification and links |

Derived tokens: subtle rules use Paper at 14% opacity; interactive outlines use
Sage gray at 70%; elevated panels mix Graphite with Paper at 3%; the primary
button hover mixes Lime with Paper at 12%. These are deliberate derived values,
not extra brand colors. Focus is a solid Paper ring with a Charcoal offset.

The hero may use a restrained lime lighting ramp: `#26351B → #6B9337 → #C1F75B
→ #E3FFAD`. This is illustration lighting, never body-text coloring. Code syntax
uses Paper, Sage gray, Lime and Cream; meaning cannot depend on syntax color.

## 3. Typography

- Display and body: **Manrope**, with system sans fallback. The variable Latin
  WOFF2 is self-hosted through Next font loading.
- Code: **IBM Plex Mono**, with system monospace fallback.
- The existing wordmark is artwork; do not recreate it by typing a similar font.

| Role | Desktop size | Mobile size | Weight | Line height |
| --- | --- | --- | --- | --- |
| Hero | 80px | 44px | 750–800 | 1.04 |
| Section heading | 48px | 32px | 700 | 1.12 |
| Product heading | 40px | 30px | 700 | 1.15 |
| Lead | 20px | 18px | 400 | 1.55 |
| Body | 16px | 16px | 400 | 1.6 |
| UI label | 14px | 14px | 600 | 1.4 |
| Code / metadata | 14px | 14px | 400 | 1.5 |

Headings use -0.04em tracking; body uses normal tracking. Keep hero to two or
three balanced lines depending on viewport. Product names use title case in
final HTML: **Zeer Prep**, **Zeer Chef**. Do not copy raster text artifacts.

## 4. Spacing and layout

Base unit: 4px. Spacing steps: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128px.
Maximum content width: 1248px. Desktop outer gutter: 48px; tablet: 32px;
mobile: 24px. Section separation: 96px desktop / 64px mobile. Component
padding: 24–32px desktop / 16–24px mobile. Corner radii: 8px controls,
12px panels, pill only for the preview badge. Touch controls: at least 44px.

At 1024px and above, hero and product sections have two columns. Below 1024px,
stack text then visual. At 768px and below, navigation becomes a menu, primary
CTAs span the content width, and architecture steps stack vertically. Avoid
fixed-height text areas. Long code scrolls within its own panel; the document
itself never scrolls horizontally.

Homepage order:

| Section | Content and purpose |
| --- | --- |
| Header | Existing logo; Products; Developers; GitHub; Start building |
| Hero | `Zcash data. Ready to build.`; product description; two CTAs; Z sculpture |
| Capability strip | Complete public blocks; TypeScript handlers; Your PostgreSQL; GraphQL APIs |
| Stack | `Two layers. One developer workflow.`; automatic Zcash → Prep → Chef → app sequence; direct Prep branch |
| Prep examples | Example selector; parameter controls; synchronized JSON/cURL/TypeScript snippets; copy and local-run documentation |
| Products | One Chef / Prep tabbed section; left summary and three feature rows; right code panel and documentation links |
| Quickstart | Reproducible historical-fixture walkthrough and scope note |
| Footer | Documentation; GitHub; public-data scope |

The product section heading is `From Zcash data to your application.` with
subtitle `Build your API with Chef, or query public chain data directly with Prep.`
Centered tabs read `Zeer Chef` then `Zeer Prep`; Chef is the initial selection.
Both states share the same desktop layout: 38% description / 62% code with a
24px gap. Left: summary card then one divided card with three feature rows.
Right: filename/route header, copy control, readable code and source caption;
documentation links sit underneath. Use a shared content-driven minimum panel
height across tab states on desktop; allow expansion for zoom and long content.
No reversed Chef layout or duplicate standalone product-introduction section.
The separate Prep example builder below is an interactive exploration section.

Mobile keeps the two tabs visible, then stacks summary, feature rows, code and
links. No shrinking code to fit: use panel-local overflow. The redundant capability strip
can collapse to two columns or be omitted on small screens because the next
sections repeat its information. The architecture explanation remains present.

### Prep query examples

Heading: `Zeer Prep`. Subheading: `Explore the query. See the code.` Supporting
copy: `Choose an example, adjust the inputs, and copy it into your project.`

Desktop: 248px example sidebar, 24px gap, flexible main column. Main column has
a description/input panel followed by the code panel. Language tabs: JSON,
cURL and TypeScript. Show only implemented client usage; TypeScript uses the
local unpublished `@zeer/prep-client`, with setup linked from the example.

| Example | Actual Prep capability | Copy boundary |
| --- | --- | --- |
| Block headers | `/query`, block height/hash/time, `transaction: []` | No full transaction payloads requested |
| Transaction metadata | `/query`, txid/block_height/index/version/size_bytes | Public metadata; no private balance inference |
| Transactions by ID | `/transactions`, bounded range and txids | Missing means absent only within a successfully completed range |
| Transparent output address | `/query`, `transparent_output_addresses` | Matches output address projection only; not input/sender history |
| Sapling activity | `/query`, `has_sapling: true` | Public bundle presence; no recipient/amount/memo decryption |
| Orchard activity | `/query`, `has_orchard: true` | Public action presence; no recipient/amount/memo decryption |

All snippets derive from one validated example/query model. Fields are allowlisted
choices, not a freeform text entry. Range controls label the exclusive upper bound.
Errors stay next to their control; invalid input disables Copy and explains why.
Switching language preserves query inputs. Switching example restores that
example's valid defaults. No silent user-data requests or public token inputs.

Example mode is the initial design: changing parameters generates code locally;
it does not query a service. `View sample response` expands a captured historical
fixture response labeled with the exact original query and coverage. It must not
pretend that edited inputs were executed. If no captured response exists for a
preset, omit that disclosure. `Run locally` opens the existing quickstart.

A future connected-demo state may expose `Run query` once an actual bounded
endpoint is integrated. Its design must show source mode/coverage and distinguish
idle, running/cancellable, successful (including empty), rate-limited, error,
unavailable and changed-snapshot states. Data is displayed only from the actual
response; edited parameters invalidate old results. This is a future integration
state, not a current public API claim or an instruction to deploy one now.

Mobile: replace the sidebar with a labeled native example select; stack inputs
and keep the three language tabs above independently scrollable code. Copy has
a 44px target. Sample output expands in normal flow. Switching examples does
not scroll the page or remove keyboard focus.

## 5. Components

These primitives are implemented in `apps/web/src/components`. The playgrounds
serve as state harnesses for actual, recorded, empty, invalid and stale responses.
The response table and duration rules are defined in the console design contract.

| Primitive | Anatomy / variants | States and behavior |
| --- | --- | --- |
| Site navigation | Logo, two navigation groups, GitHub, primary CTA | Desktop dropdowns; mobile disclosure; Escape closes; focus returns to trigger |
| Action link | Primary lime; secondary outline; inline underlined | Hover color; press offset 1px; visible focus; real destination; no dead controls |
| Preview badge | Neutral outline + text | Static `Public-data preview`; no green heartbeat implying live service |
| Section header | Product label, title, short description | Balanced wrapping; no clipped text |
| Product tabs | Chef / Prep segmented control and associated panel | Lime selected surface for either product; dark inactive surface; tablist/tab/tabpanel semantics; aria-selected; roving focus; Left/Right and Home/End; focus stays on tab |
| Code example | Title, tabs, preformatted code, copy action, caption | Keyboard tabs; copy confirmation in polite status; clipboard failure shown locally |
| Query example selector | Vertical list of buttons; mobile native select | Current selection announced; lime edge plus text state; keyboard reachable; no auto-execution |
| Query parameter fields | Labeled range/ID/address fields and field checklist | Valid/invalid/disabled; inline messages; tokens never requested in example mode |
| Language tabs | JSON / cURL / TypeScript plus Copy | Shared query state; keyboard navigation; visible selected underline |
| Sample response disclosure | Labeled historical fixture, exact query and source scope | Expand/collapse; aria-expanded; never labeled live query success |
| Architecture flow | Four labeled nodes, edges, direct Prep branch | Static semantic text list; decorative lines hidden from assistive technology |
| Feature row | Consistent line icon, title, optional description | Informational; no hover affordance unless actually linked |
| Quickstart banner | Heading, scope note, CTA | Links to existing instructions; no fake installation success |

There is no public query runner in the current design baseline. Product tabs switch static documented
handler/request examples and their feature descriptions together. No additional
nested request/response tabs in this section. Chef links to its full example;
Prep links to its query contract. Any future live runner requires separate connection,
coverage, authentication, loading, empty, failure and stale-source designs.
Never embed private deployment tokens in browser JavaScript.

## 6. Motion and interaction

18 October motion update: the stack repeats a 6.4-second explanatory cycle
while visible: Zcash (0ms), Prep (1100ms), Chef/direct branch (2200ms),
application (3300ms), then a reading hold until the next cycle. Active cards get a
lime border/glow; packets travel along existing connectors. Playback controls
and the explanatory playback footer are removed at the user's request.
Hidden/offscreen state stops the sequence; cleanup removes timers and observers.
Reduced motion keeps the complete static diagram. This is an illustration,
never actual ingestion status. Hero particles follow the logo's diagonal seam
continuously; visibility and live media preference changes remove the SVG
animation nodes and pause CSS float/ground loops. Product selection uses a
200ms sliding lime indicator rather than an instant background switch.

Mechanism reference: beui.dev/r/animated-badge/raw (read 18 October): separate
the opacity-only glow layer from readable state labels; reduced motion settles
labels without layout projection. The stack's four-stage choreography is
project-specific and uses existing React/CSS/SVG rather than adding Motion/GSAP.

- Control feedback: 140ms ease-out, color/opacity only plus optional 1px press.
- Menu and example-tab transition: 180ms ease-out; preserve layout dimensions.
- Product switch: lime selection indicator translates between tabs in 200ms;
  panel opacity and at most 4px translation transition in 160ms. No typewriter
  effect or automatic cycling. A faint lime glow surrounds the selected tab;
  code/body text remains unlit. Reduced motion switches state immediately.
- Hero entrance: one 450ms opacity/8px translation, not a looping loading state.
- Optional illustration data path: one short explanatory trace on entry. It is
  not a live network indicator. No continuous particle background or scroll hijack.
- Reduced motion: all content visible immediately; diagram and illustration static.
- Sticky navigation may use an opaque fallback; anchored sections need scroll offset.
- Mobile menu is operable by tap and keyboard, never hover-only.

## 7. Depth and surface

Use graphite panels with a 1px subtle border and a faint inner top highlight.
Code is on a slightly darker inset surface. Navigation may use a very restrained
shadow for separation. Keep the rich material treatment concentrated in the hero:
dark beveled slabs, thin lime edge light, soft occlusion between layers, a faint
ground grid. No glow behind body text or every card.

The raster mockups are review references. Do not ship a screenshot as the website.
Text, navigation, diagrams, code panels and controls become real accessible UI.
The decorative hero illustration may be a separately exported optimized bitmap;
it does not require WebGL. Use the approved existing logo asset or a separately
reviewed vector export rather than silently redrawing the brand.

## 8. Accessibility and review status

Implementation target: WCAG 2.2 AA, 4.5:1 normal-text contrast, 3:1 large-text
and essential control boundaries, visible focus, 44px touch targets, meaningful
headings, skip link, keyboard navigation and reduced-motion support. Decorative
hero gets empty alternative text because adjacent prose/diagram conveys its meaning.
These are acceptance requirements, not a claim that a generated image passes WCAG.

Review checklist for implementation: 375/390px, 768px and 1440px; 200% zoom;
long labels; code overflow; keyboard menu and tabs; clipboard denied; reduced
motion; no private tokens; no broken links or unsupported marketing claims.

Concept review found two raster limitations: the desktop Prep eyebrow may render
as `TEER PREP`, and mobile artwork uses wider margins than the specified 24px.
The authoritative label is `Zeer Prep`; final mobile layout follows Section 4.
Do not port either artifact into HTML. Raster sample hashes are illustrative,
not verified query output. Actual code and response examples come from the repo.

Local implementation is available under `apps/web`. Landing and Open App remain
separate; a configured local Prep/Chef/PostgreSQL stack serves captured testnet
blocks 1000–1002, explicitly labeled historical replay. Updated playground result
states were checked at 1440, 768, 390 and 320px with no document overflow or
automated WCAG 2.1 AA axe findings. This is bounded browser evidence, not full
WCAG conformance or public deployment acceptance.

Current implementation refinements: code uses 13px IBM Plex Mono, response tables
use 14px, and compact metadata uses 12px. The green panel surface is `#111713`,
rules are `#29322b`, and line numbers use `#91a18f`; these extend the original
charcoal palette for code readability. On narrow screens, examples remain visible
as a wrapping two-column button group and Chef panes stack vertically.

Remaining delivery work: public hosting and ingress controls, published package
distribution, wider testnet archive coverage, and a recorded walkthrough. Synthetic
performance scores must be measured and reported separately from engine benchmarks.
