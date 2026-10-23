# Zeer product visuals

Original Remotion compositions for the repository and developer docs. They use
the existing Zeer mark, self-hosted Manrope/IBM Plex Mono and selected values from
the [verified testnet breakdown](../../docs/CHEF_060_TESTNET.json). No website
screenshots, narration, private keys or third-party artwork are used.

## Render

Use Node 24.14+ and an installed FFmpeg executable:

```sh
cd tools/product-visuals
npm ci
npm run typecheck
npm run render
```

If FFmpeg is not on PATH, set `FFMPEG_PATH` to its absolute executable path.
Remotion obtains its compatible Chrome Headless Shell when one is not cached.
`npm run render -- --stills` exports only the PNG posters. Render intermediates,
the copied local font files and the asset hash manifest stay in `.cache/`.

| Composition | Final assets |
| --- | --- |
| `RepositoryOverview` | `assets/readme/zeer-overview.gif` and `.png` |
| `PrepOverview` | `apps/docs/static/demos/prep-flow.gif` and `.png` |
| `ChefOverview` | `apps/docs/static/demos/chef-flow.gif` and `.png` |

All compositions are 144 frames at 30 fps. GIFs use 12 fps, at most 96 colors,
play once and stop on the settled diagram. Each has a 3 MiB size budget. The docs
retain their 1040 × 600 dimensions; the repository overview is 1280 × 720.
Reduced-motion picture sources use the matching static final frame.

The animations explain processing. They are not a new live execution, timing
measurement or performance claim. The Chef query assumes the developer-defined
transaction example schema, rather than the hosted block-summary schema. See
[DESIGN.md](DESIGN.md) for the composition and motion contract.

Zeer's mark is copied unchanged from `apps/web/src/app/icon.svg`. Font packages
contain their OFL licenses; regeneration copies those into the local render
assets. Zeer's original illustration source and outputs use the repository's MIT
license.
