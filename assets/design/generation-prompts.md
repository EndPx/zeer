# Image generation record

Mode: built-in ImageGen. Outputs are design mockups for review only.

## Desktop initial prompt

Use case: ui-mockup. Create a meticulously designed high-fidelity desktop website screenshot for Zeer, a Zcash developer infrastructure project. This is a DESIGN CONCEPT, not a dashboard and not a photograph of a device. Render one continuous full homepage at 1536 x 2304, straight on, crisp legible typography. Use supplied brand board only as reference for the existing lime sliced-Z symbol and lowercase zeer wordmark; reproduce the mark faithfully, do not reproduce the whole board. Original composition inspired by developer-infrastructure websites with dark spacious sections and real code panels.

Art direction: charcoal #0C0F12 background, graphite #14191D panels, off-white #F4F6F2 text, muted sage-gray #A9B2AC, electric pale lime #C1F75B primary accent, warm cream #F2D49B restrained Chef accent. No orange-purple gradients. Typography: very bold clean geometric sans headlines, readable neutral sans body, monospaced code. Thin technical rules, precise generous spacing, small 8px corner radii. Subtle depth and lime edge-light only on hero visualization, not a neon cyberpunk poster. No excessive cards.

Layout:
1. Slim inset header at top: logo left, 'Products' 'Developers' 'GitHub' center/right, lime 'Start building ↗' button. Small discreet 'Public-data preview' status text under or beside brand.
2. Large sophisticated hero in two columns. Left about 55% width: huge three-line headline exact 'Zcash data.\nReady to build.' with Ready to build. in lime. Small paragraph 'Query public chain data with Prep. Turn it into application APIs with Chef.' Primary lime button 'Start building ↗', secondary outlined 'Explore the stack ↓'. Small understated text 'Open source. Self-hosted. Built for Zcash.'
Right is a memorable luminous technical sculpture derived from the sliced Z: three floating graphite slabs with sharp chamfered edges, subtle lime inner edges and tiny block-data grids, arranged like a clean architectural data-processing machine. Integrated restrained labels 'Zcash', 'Prep', 'Chef', 'Your app' along a fine branching path; show Prep direct-to-app branch as well as through Chef. No physical cooking imagery.
3. Narrow full-width horizontal information band: 'Complete public blocks' / 'TypeScript handlers' / 'Your PostgreSQL' / 'GraphQL APIs'. Text and line separators only; not fake customer logos.
4. Product overview heading 'Two layers. One developer workflow.' and one horizontal diagram 'Zcash → Prep → Chef → Your app' with secondary path from Prep labeled 'Direct API'. Compact, clearly readable.
5. Prep feature section in two unequal columns. Left: small 'ZEER PREP', large headline 'The data you need.\nReady to query.' Body 'Read public blocks and transactions through a focused data API.' Three quiet feature rows: 'Range queries and filters', 'Selected fields, smaller responses', 'Backfill and follow new blocks'. Link 'Explore Prep ↗'. Right a large graphite code panel with tabs 'Request' 'Response', tag 'Example query', simple JSON code with only these fields: { "from_height": 1687106, "to_height": 1687109, "fields": ["height", "hash"] }. Caption 'Illustrative query · exact syntax in documentation'. Do not show fake speed numbers, uptime badges, live indicators or a Run button.
6. Chef feature section reversed emphasis: left large code-to-table panel with labels 'TypeScript → PostgreSQL → GraphQL', a simple GraphQL snippet 'query { blocks { height hash } }' visibly labeled 'Illustrative schema'. Right small 'ZEER CHEF' in warm cream, large 'Your logic.\nYour database.\nYour API.' Body 'Write handlers in TypeScript. Shape public chain data into the entities your app needs.' Feature rows 'Typed handlers and entities', 'Developer-owned PostgreSQL', 'Authenticated GraphQL'. Link 'Explore Chef ↗'.
7. Final spacious call to action 'Build your first Zcash data app.' paragraph 'Start with the public-data quickstart.' Lime 'Open quickstart ↗' button. Small note 'Historical fixture walkthrough. Shielded payloads remain encrypted.'
8. Minimal footer logo and 'Documentation' 'GitHub' 'Public-data scope'.

Make hierarchy gorgeous, precise enough for a design handoff. Fit all sections with ample breathing room. No invented testimonials, metrics, benchmarks, pricing, customers, npm installation commands, hosted API, trading UI, wallet connect or claims of production readiness. All words spelled cleanly. Hero is the dominant distinctive moment.

## Desktop content correction

Edit this Zeer website design with surgical content corrections only. Keep exact overall composition, elegant charcoal/lime palette, typography, Z sculpture, proportions, sections, logo and all other text.
1. Small eyebrow above Prep section must read exactly "ZEER PREP", not TEER PREP.
2. Prep JSON panel must use real API keys, displayed cleanly:
{
  "from_block": 1687106,
  "to_block": 1687109,
  "field_selection": {
    "block": ["height", "hash"]
  }
}
Keep "Example query" label.
3. Chef panel should show this real GraphQL query instead of blocks/height:
query {
  BlockList(first: 3) {
    items { id hash }
  }
}
Right-hand small table header "id" and "hash", only THREE rows with ids 1687106,1687107,1687108 and short abstract hash placeholders. Explicitly label this table "Example response" so values are not live claims.
4. In capabilities band change "Access canonical chain data" to "Read public chain data".
5. Remove green live-looking dot from header status and render 'Public-data preview' as a neutral outline pill.
6. Make product section small captions and footer comfortably readable; do not add new sections or claims.

## Desktop small-label correction attempt

Change only the small lime TEER PREP label to Zeer Prep; preserve composition. The generated output retained a small-letter artifact. DESIGN.md and README.md specify the correct final text.

## Mobile prompt

Create the MOBILE RESPONSIVE design version of this supplied Zeer desktop homepage. Keep same existing Zeer sliced-Z logo, charcoal background #0C0F12, lime #C1F75B, off-white text, crisp sans typography, thin graphite borders, gentle technical depth. Produce one tall high fidelity flat mobile webpage mockup, approximately 780x2340 pixels (390 CSS px wide at 2x); no phone hardware frame, no side-by-side desktop, no collage.
It must be a thoughtful mobile reflow, with readable text and generous 24 CSS px gutters, buttons at least 44 CSS px tall. Top compact header logo left, hamburger right. Hero: small neutral 'Public-data preview' pill; huge white 'Zcash data.' then lime 'Ready to build.'; paragraph 'Query public chain data with Prep. Turn it into application APIs with Chef.' Full-width lime 'Start building ↗' and text link 'Explore the stack ↓'. Below that, smaller atmospheric sliced-Z graphite sculpture from reference as hero art without dense tiny labels.
Then heading 'Two layers. One workflow.' with four compact full-width vertical steps 'Zcash' 'Prep' 'Chef' 'Your app', thin arrows. Include small visible note 'Use Prep directly, or build with Chef.'
Then product sections stacked vertically:
Small label EXACT 'Zeer Prep' spelled Z E E R P R E P. Heading 'The data you need. Ready to query.' Short description 'Query public blocks and transactions.' One compact real code panel with legible monospace:
{
 "from_block": 1687106,
 "to_block": 1687109,
 "field_selection": {
   "block": ["height", "hash"]
 }
}
Label 'Example query'. Link 'Explore Prep ↗'.
Next label 'Zeer Chef' in cream. Heading 'Your logic. Your database. Your API.' Description 'TypeScript handlers. Your PostgreSQL. GraphQL for your app.' compact visual row 'TypeScript → PostgreSQL → GraphQL', link 'Explore Chef ↗'. No data table on mobile.
Final compact CTA 'Build your first Zcash data app.' Lime button 'Open quickstart ↗'. Small 'Public data only. Shielded payloads stay encrypted.' Footer Zeer logo, Docs, GitHub.
Fit all this naturally in tall canvas with real website hierarchy. Avoid fake live status, invented statistics, testimonials, smartphone mockup, cramped text. This is a design concept. Do not add extra headings or decorative cards.
