# Query example mockup prompt

Built-in ImageGen. User screenshot used as layout reference.

Create a high-fidelity DESKTOP WEBSITE SECTION mockup for Zeer Prep based on the supplied screenshot's query-example layout. Single wide 1536x1024 canvas, flat straight-on browser content, not a device or a poster. This section will appear below a separate Chef/Prep product overview. Original Zeer branding: charcoal #0C0F12 page, graphite #14191D cards, off-white #F4F6F2 headings, readable muted #A9B2AC body, lime #C1F75B selected accents, thin gray rules, small 8px rounded corners. No Envio logo, orange-purple gradient or navigation bar. Typography clean Manrope-like sans, IBM Plex Mono-like code. High design fidelity and careful alignment, generous margins.
Centered heading 'Zeer Prep' with Prep in lime. Subtitle 'Explore the query. See the code.'
Small centered support line 'Choose an example, adjust the inputs, and copy it into your project.'
Below, left vertical sidebar width 250px titled 'Examples' with 6 rows: 'Block headers' SELECTED with a narrow lime left indicator and dark tinted background; 'Transaction metadata'; 'Transactions by ID'; 'Transparent output address'; 'Sapling activity'; 'Orchard activity'.
Right wide column:
Top descriptive card title 'Block headers', paragraph 'Read block heights, hashes, and timestamps without full transaction payloads.'
Three aligned clearly labeled controls: 'From block' value '1687106'; 'To block (exclusive)' value '1687109'; 'Fields' value 'height, hash, time'.
Small muted line below inputs 'Public-data example · choose a range covered by your Prep archive.'
Below, a large code panel. Toolbar left tabs 'JSON' ACTIVE 'cURL' 'TypeScript'; right a copy icon and text 'Copy'. Below toolbar small file label 'POST /query'. Code exactly:
{
  "from_block": 1687106,
  "to_block": 1687109,
  "field_selection": {
    "block": ["height", "hash", "time"],
    "transaction": []
  }
}
Do not add or omit any JSON braces. Keep code readable and comfortable.
Bottom of code panel a small neutral outline badge 'Example mode' and the plain statement 'No request has been sent.'
Below panel links 'View sample response ↓' at left and 'Run locally ↗' 'API documentation ↗' at right. View sample response is a disclosure for an example, NOT a live Run button.
Quiet bottom scope note spanning right column 'Shielded recipients, amounts, and memos stay private.'
No response table, no performance values, no live service badge, no public endpoint, no API tokens, no fake response execution. Do not advertise unsupported Rust/Go/Python SDKs. This should feel like a beautiful practical query builder in a developer landing page. Keep green glow minimal near selected JSON tab and sidebar highlight, never glowing body text.
