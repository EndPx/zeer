# Product overview illustrations

The current `static/demos/prep-flow.gif` and `chef-flow.gif` are original Remotion
compositions from [tools/product-visuals](../../tools/product-visuals). They use
Zeer's existing SVG mark, Manrope and IBM Plex Mono. No website screenshots or
third-party illustrations are used.

Prep shows one explicit testnet block range and selected fields becoming a
projected response. Chef shows Prep → TypeScript handlers → PostgreSQL, then a
GraphQL query over the developer-defined transaction example. Numeric fields
come from the recorded public testnet acceptance; animation timing is illustrative,
not execution evidence or a speed measurement.

Each animation plays once for approximately 4.8 seconds and stops on the complete
result. The matching PNG poster is selected for `prefers-reduced-motion`. Both
product canvases remain 1040 × 600 and retain the existing overview picture markup.
The historical deployment recording is separate and retains its original provenance.

To regenerate the current product diagrams, follow the Remotion tool's README.
`npm run render -- --stills` generates just the static posters. The older
`scripts/render-overviews.py` is retained as the previous illustration source;
it is not the canonical renderer for the current assets. Building the docs uses
the committed final GIF/PNG files and requires neither Remotion nor FFmpeg.
