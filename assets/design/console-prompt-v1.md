# Developer Console design prompt

Built-in ImageGen; existing Zeer logo board used as brand reference.

Use case: ui-mockup. Create a high-fidelity design review board for Zeer Developer Console. Two desktop app screens stacked vertically on a 1536x1536 image, each 1536x740, separated by 48px black margin. The first is Overview, the second Chef Playground. No device frames. This is a product design concept, not a running service. The supplied brand board provides the exact sliced lime Z and lowercase zeer wordmark; use just its logo, not the brand-board layout.
Established palette charcoal #0C0F12, graphite #14191D, off-white #F4F6F2, muted sage-gray #A9B2AC, restrained lime #C1F75B. Clean Manrope-like typography, IBM Plex Mono for code, thin borders, precise 8px radii, no busy gradients. Operational console rather than marketing page; no giant hero art. Subtle green illumination only selected navigation and Run button. Readable generous UI.

Shared app shell both screens:
Narrow 210px sidebar with small Zeer logo at top. Under 'Developer console', menu 'Overview', 'Prep Playground', 'Chef Playground'. Bottom links 'Quickstart ↗', 'GitHub ↗'. Header main area breadcrumb 'Public demo / Overview' or 'Public demo / Chef Playground', at right badge 'Zcash Testnet'. In both screens show a thin neutral notice below header 'Design preview · recorded testnet sample · not connected'. No fake connected/live status.

TOP SCREEN Overview:
Heading 'Your data, from source to API.' Smaller paragraph 'Inspect coverage, query Prep, and explore your Chef entities.'
One full-width horizontal 3-column info strip with hairline dividers:
'Prep archive' prominent '1,000 – 1,002', below 'Historical sample'
'Chef checkpoint' prominent '1,002', below 'Recorded checkpoint'
'Upstream tip' prominent 'Unknown', below 'No live source connected'
Below one broad restrained pipeline graphic 'Prep archive → Chef handlers → PostgreSQL → GraphQL', direct branch from Prep labelled 'Direct API'.
Lower two side-by-side product panels:
'Zeer Prep' with 'Query blocks and transactions.' Features inline 'Range filters · Field selection · Batch lookup'. Link-button 'Open Prep Playground →'.
'Zeer Chef' with 'Query your application entities.' Under it 'BlockSummary' as a small schema label, then 'TypeScript handlers · PostgreSQL · GraphQL'. Link-button 'Open Chef Playground →'.
Bottom slim note 'Public data only. Shielded payloads remain encrypted.' No resource graphs, adoption stats, charts or invented benchmarks.

BOTTOM SCREEN Chef Playground:
Overview inactive, Chef Playground selected in sidebar. Heading 'Chef Playground'. Secondary context line 'BlockSummary · historical testnet sample · blocks 1,000–1,002'.
Editor workspace with one compact toolbar: left 'Query', right 'Copy' and lime 'Run query ▶', disabled-looking with small note 'Connect a demo service to run'. It must be clear this is design preview, not actual execution.
Below toolbar three columns: narrow schema list 18%, query editor 40%, result panel42%.
Schema list title 'Example schema'; expanded 'BlockSummary' with 'id', 'height', 'hash', 'time', 'transactionCount'. These are static example-schema fields, not promised live introspection.
Query editor clean numbered code:
query {
  BlockSummaryList(first: 3) {
    items {
      height
      transactionCount
    }
  }
  _meta { height status }
}
Result panel heading 'Recorded response', code:
{
  "data": {
    "BlockSummaryList": {
      "items": [
        { "height": 1000, "transactionCount": 1 },
        { "height": 1001, "transactionCount": 1 },
        { "height": 1002, "transactionCount": 1 }
      ]
    },
    "_meta": { "height": 1002, "status": "ready" }
  }
}
Bottom panel footer 'Sample output from verified historical replay. No request sent in this preview.'
Make exact text legible, fit screen fully, avoid clipped or overflowing code. Keep UI visually polished and distinctly branded with lime understated accents. Do not add billing, signup, wallet connect, deployments, key entry, subscription support, live counters, invented metrics or more features.

Revision: removed a misleading direct-API arrow to GraphQL and requested valid query braces. The final raster is a layout reference; authoritative query text is in docs/DEVELOPER_CONSOLE_DESIGN.md.
