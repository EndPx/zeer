# Zeer homepage concept v1

## Current selected hero — logo-derived revision

The user's latest instruction uses the supplied metal-Z image as craftsmanship
inspiration only. The runtime asset is now `apps/web/public/hero-zeer-mark.png`,
generated from the actual selected Zeer logo board: two interlocking ribbons with
a diagonal negative-space cut, rendered as graphite with lime edge lighting.
It does not reuse the user's reference image or the earlier three-slab geometry.
The hero has no overlaid labels/arrows. Three native SVG light packets follow the
diagonal seam in the same coordinate frame and now repeat continuously, per the
latest user direction. The mark floats above a CSS perspective grid, reflection,
shadow and lime glow. Offscreen/hidden/reduced-motion guards remain; no playback
controls return. Previous hero assets are retained as unused design history.

## Earlier reference correction — superseded

The user reaffirmed the original exploded three-slab Z hero and the four-node
workflow diagram shown in this concept. That revision's runtime illustration was
`apps/web/public/hero-layered.png`, reconstructed with built-in ImageGen from the
user-supplied desktop reference. It has a transparent background and no raster
labels; HTML/SVG supplies the Zcash, Prep, Chef and Your app labels/connectors.
The former `hero.png` is retained as an unused earlier variant.

`StackDiagram` renders the requested Zcash → Prep → Chef → Your app diagram and
the dashed direct Prep → app branch. Following the latest ordering correction,
it appears before the Choose your layer product section, after the capability strip.
The diagram is real responsive HTML
and SVG, not a screenshot of the concept. DESIGN.md records the responsive rules.

Network direction updated 2026-10-16: public preview and query playground will
use **Zcash Testnet**. Existing raster query heights reflect earlier fixture
examples and must be replaced with captured testnet requests/responses before
release. Display network and real indexed coverage in the implemented UI.

## Product-section revision v2

User direction on 2026-10-16: use the Envio-style Chef / Prep tabbed layout.
`zeer-product-tabs-v2.png` shows the two alternative states on one review board.
On the actual page there will be one section and one visible selected panel.
This replaces the separate Prep/Chef blocks in the older homepage mockups.
The rest of the homepage remains a proposal pending review.

Chef tab: summary + typed handlers / developer PostgreSQL / authenticated
GraphQL feature rows on the left; real block-handler excerpt on the right.
The full source is `examples/chef-public/chef.config.ts`; the excerpt is not a
complete standalone config. Prep tab: range / field projection / source following
feature rows; documented `POST /query` request. Both use lime selection styling.

Motion proposal: 200ms sliding lime selection, 160ms panel fade, no autoplay;
immediate state change with reduced motion. See DESIGN.md for keyboard/mobile rules.

The mockup's generated Chef signature has punctuation artifacts. Authoritative
source below must be used as real text during implementation:

```ts
async block({ block, context }) {
  await context.entities.set("Block", {
    id: String(block.height),
    hash: block.hash,
    time: BigInt(block.time),
    transactionCount: 0,
  });
}
```

## Original homepage review package

Design-only review package, 2026-10-16. Reference: https://envio.dev/.

- `zeer-home-desktop-v1.png`: desktop homepage composition.
- `zeer-home-mobile-v1.png`: mobile composition study.
- `../../DESIGN.md`: authoritative typography, tokens, components and responsive rules.
- `generation-prompts.md`: prompts used with built-in ImageGen.

The images are generated mockups, not screenshots of a running application.
Code panels and response rows illustrate the intended design. The desktop small
Prep label has a raster spelling artifact; final text must read **Zeer Prep**.
Mobile spacing must follow DESIGN.md rather than scale the whole image down.

## Approved-copy proposal

Hero: **Zcash data. Ready to build.**

Description: Query public chain data with Prep. Turn it into application APIs with Chef.

Prep: **The data you need. Ready to query.**

Chef: **Your logic. Your database. Your API.**

Quickstart: **Build your first Zcash data app.**

Scope note: Historical fixture walkthrough. Shielded payloads remain encrypted.

## Navigation and CTA destinations for implementation

| Control | Destination |
| --- | --- |
| Start building / Open quickstart | https://github.com/EndPx/zeer/blob/main/examples/quickstart/README.md |
| Explore the stack | Homepage `#stack` |
| Explore Prep | https://github.com/EndPx/zeer/blob/main/docs/PREP_QUERY.md |
| Explore Chef | https://github.com/EndPx/zeer/blob/main/docs/CHEF_PUBLIC_MVP.md |
| Documentation / Developers overview | https://github.com/EndPx/zeer#readme |
| GitHub | https://github.com/EndPx/zeer |
| Public-data scope | https://github.com/EndPx/zeer#status |

These map to existing local repository paths; validate public links during build.
Products can be a two-item menu linking to homepage `#prep` and `#chef`.
Do not add an empty pricing, sign-in, cloud console or API-key acquisition page.

## Exact example copy

Prep request, based on `docs/PREP_QUERY.md`; `to_block` is exclusive:

```json
{
  "from_block": 1687106,
  "to_block": 1687109,
  "field_selection": {
    "block": ["height", "hash"]
  }
}
```

Chef query, using the public example's Block entity:

```graphql
query {
  BlockList(first: 3) {
    items { id hash }
  }
}
```

For shipped examples, capture the actual fixture response and label its range.
Do not reuse the mockup's shortened invented hash values as real evidence.

## Content boundaries

Public-data prototype; self-hosted tooling. No claims of whole-chain coverage,
production availability, private memo decryption, npm publication, customer
adoption, independent consensus validation or public hosted endpoint. Benchmark
results remain local-only and are not part of this site proposal.

## Review outcome

The hierarchy, two-product separation, existing brand palette and direct Prep
path are visible in both concepts. Raster text precision and exact spacing are
controlled by DESIGN.md and this file. Interaction, responsive behavior and
screen-reader compatibility remain untested until actual implementation.

No website code, dependencies, service deployment or Git push was performed for
this design package. Existing unrelated `plan.md` edits are preserved.
