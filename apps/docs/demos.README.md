# Overview illustrations

`static/demos/chef-flow.gif` and `prep-flow.gif` are original diagrams rendered
from `scripts/render-overviews.py`. They use Zeer's colors and the installed
Manrope / IBM Plex Mono fonts. No screenshots or third-party illustrations are used.

Prep shows block records, selection and JSON. Chef shows Prep, TypeScript
handlers, PostgreSQL entities and GraphQL. These are explanatory illustrations,
not execution results or throughput measurements. Each GIF plays once for 4.8
seconds, ending on the complete diagram. Matching PNG frames
are selected through native picture sources for `prefers-reduced-motion`.

To regenerate, install the normal workspace dependencies and use Python with
Pillow, fonttools and Brotli, then run `python apps/docs/scripts/render-overviews.py`.
Build requires only the committed GIF/PNG assets, not Python or a capture service.
