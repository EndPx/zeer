# Product section mockup prompt

Built-in ImageGen; user-provided screenshots are layout references. This is a design-only revision.

Use case ui-mockup. Design a precise high-fidelity Zeer landing-page PRODUCT SECTION, adapting the two supplied Envio reference screenshots. Make one 1536x1536 design review board showing TWO states of THE SAME tabbed section vertically: top Chef active, bottom Prep active, separated by generous black whitespace and a subtle divider. This is not an entire homepage. No hero illustration, 3D object, navigation bar, phone, or browser chrome.
Follow reference layout closely: centered section heading and one-line subtitle, centered segmented toggle, then a 38% left descriptive column / 62% right large code panel. Black charcoal #0C0F12, near-black #111618 cards, fine gray borders, white headings, legible muted-gray body, restrained lime #C1F75B accents. Active tab is lime with black text and a very faint lime glow. Inactive tab is dark with gray text. Cards 10px radius. Clean Manrope-like sans typography, IBM Plex Mono-like code. No orange or purple. Crisp abundant breathing space, realistic developer website, not poster.
TOP STATE:
Centered heading 'From Zcash data to your application.'
Subtitle 'Build your API with Chef, or query public chain data directly with Prep.'
Tabs exactly 'Zeer Chef' active and 'Zeer Prep' inactive.
Left top summary card title 'Zeer Chef', body 'Turn public Zcash data into application APIs.'
Left below one card divided into THREE rows:
'Write your logic in TypeScript' / 'Typed handlers turn blocks and transactions into entities.'
'Keep your own PostgreSQL' / 'Your data model, stored in your database.'
'Serve it through GraphQL' / 'Query your entities through an authenticated API.'
Right code panel title bar 'chef.config.ts — handler excerpt' and copy icon; clean readable code:
async block({ block, context }) {
  await context.entities.set("Block", {
    id: String(block.height),
    hash: block.hash,
    time: BigInt(block.time),
    transactionCount: 0,
  });
}
Small muted footer in panel 'Handler excerpt from the public-data example.'
Below panel links 'Chef documentation ↗' and 'View full example ↗'.
BOTTOM STATE:
Same heading/subtitle/toggle positions repeated compactly, tabs 'Zeer Chef' inactive and 'Zeer Prep' active.
Left summary card title 'Zeer Prep', body 'Query complete public Zcash blocks and transactions.'
Three rows:
'Choose a block range' / 'Read history in bounded, resumable requests.'
'Select the fields you need' / 'Return the data your application uses.'
'Backfill, then follow' / 'Track new blocks from a configured source.'
Right large panel title 'POST /query' with copy icon; code:
{
  "from_block": 1687106,
  "to_block": 1687109,
  "field_selection": {
    "block": ["height", "hash"],
    "transaction": ["txid", "block_height", "index"]
  }
}
Panel footer 'Example request · public data only.'
Below panel links 'Prep documentation ↗' and 'Query examples ↗'.
Keep identical card alignment and reserved code-panel height across both states. Precise readable code and text. No Run button, performance numbers, invented endpoints, customer logos, live status or npm publication claims. Render only a design mockup, no annotations or claims of a running service.
