# Prep query example builder — design v3

User requested the HyperSync-style example list, editable parameters and code
format tabs, in addition to the Chef/Prep overview. This is a design-only addition.

Mockup: `zeer-prep-query-explorer-v3.png`.
Authoritative behavior and content: `../../DESIGN.md`, Prep query examples.

Initial preset uses this supported header-only query:

```json
{
  "from_block": 1687106,
  "to_block": 1687109,
  "field_selection": {
    "block": ["height", "hash", "time"],
    "transaction": []
  }
}
```

Evidence checked: `docs/PREP_QUERY.md`, `packages/prep-client/README.md`.
The client exposes `get`, finite cursor `stream`, `getTransactions`,
`getCapabilities` and `getHeight`. Do not present `stream` as an endless live
subscription or imply that packages are already published on npm.

Initial mockup is example mode. The code-generation interactions are proposed;
no frontend has been implemented. A connected Run query state is specified in
DESIGN.md for future endpoint integration. No request or response is fabricated.

Image review: the selected example, parameter fields, JSON tab and code match
the intended layout. Generated blue links should use the existing lime link
token in implementation. The rendered Fields input represents an allowlisted
field selector, not arbitrary freeform input. Desktop raster only; mobile and
keyboard requirements remain specifications awaiting implementation checks.
