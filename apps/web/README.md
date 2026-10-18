# Zeer web

Next.js landing page and Developer Console. Uses the reviewed charcoal/lime
identity, self-hosted fonts and continuous visible-only motion with reduced-motion support.

Landing order: hero → capability strip → The Zeer stack → Zeer Prep examples →
product tabs → CTA. The stack repeats its illustrated flow every 6.4 seconds, with
a reading hold at the final stage. Playback controls remain removed at the user's request.
Offscreen/hidden/reduced-motion state stops it; reduced motion leaves the complete
static diagram. The hero uses a logo-derived sliced-Z sculpture; native SVG
light packets travel continuously through its diagonal seam. Image and packets
float together on a 7.2-second cycle above a reflective grid floor, soft ground
shadow and lime atmospheric light. All loops pause/stop offscreen, while hidden,
or with reduced motion. There is no five-second cutoff.
These are product explanations, not live chain activity indicators.

```sh
# Repository root, Node 24.14+
npm ci
npm run build:web
npm run start -w @zeer/web
```

Open http://127.0.0.1:3000. Use `npm run dev:web` for development.

- `/`: landing, product selector and query examples.
- `/app`: actual backend status, with Unknown/Not connected when unavailable.
  A network panel separates full-history coverage from Chef completion within
  Prep's current window, shows both lag values and observation time, and displays
  eight real recent block headers with one-block query links. Visible tabs refresh
  every 15 seconds; failures retain explicitly labeled last-known observations.
- `/app/prep`: bounded range/field examples, request runner, Table/JSON results,
  explicit empty/stale states and response coverage.
- `/app/chef`: editable GraphQL query, example model, copyable results and
  Ctrl/Cmd+Enter execution.
- `/docs`: local developer quickstart and installation boundaries.

## Data modes

Without configuration the application is explicitly disconnected. No request is
simulated. The application playgrounds display backend results or errors; they
do not offer recorded-response controls. Connected Prep defaults are selected
from the ready archive's actual coverage. Explicit user ranges are preserved.
The landing page's optional recorded response contains historical testnet blocks
1000–1002, captured from Zebra 7.0.0-rc.0 and independently compared during the
Chef starter integration. It is not the output of edited inputs or live indexing.

To connect a testnet demo, copy `.env.example` to `.env.local` and configure the
actual server-side Prep/Chef base URLs and tokens. Restart the web server. Never
use NEXT_PUBLIC for credentials. The Chef URL omits `/graphql`; Prep must return
testnet network metadata. Chef must be the operator's testnet BlockSummary project.
No arbitrary user-supplied upstream URLs, viewing keys or wallets are accepted.

Adapters allow only fixed query/status routes, reject cross-origin writes,
disable redirects, bound requests to 16 KiB/responses to 8 MiB, use 15-second
deadlines and two upstream requests per server module instance. This is a local
demo control, not a distributed per-user quota. Public hosting still needs an
operator-managed ingress quota/TLS policy and deployment review.

Prep runs one bounded page. Inspect `cursor`/`next_block`; a page is not complete
history. The client does not silently drain unlimited pages. The TypeScript
example refers to the currently unpublished local Prep-client package.
Chef serves existing read-only operations; no introspection/subscriptions are added.
Displayed round-trip duration measures the browser request through the adapter
until JSON decoding finishes; it is not an engine benchmark. Recorded samples
have no fabricated timing. Opening a sample cancels the current request.

## Verify

With a production server running and upstream variables unset:

```sh
node --test apps/web/tests/http.test.mjs
npm run typecheck -w @zeer/web
```

Run `node apps/web/tests/connected.mjs` from the repository root after building
for isolated adapter checks against an explicitly synthetic local upstream.
It does not validate blockchain data. Real connected acceptance additionally
compares returned Prep blocks and Chef entities to the captured testnet fixture.

Browser checks cover the four routes at desktop/tablet/mobile/narrow widths,
selection/deep links, invalid input, recorded output, menu keyboard handling,
continuous loops/offscreen pause/reduced motion and JS-disabled landing copy. Reports/screenshots are local.
No public endpoint or deployment follows from a production build.

React Grab/Scan are gated to development only; React Doctor is a development
dependency for static review. Generated hero artwork is decorative and was made
with built-in ImageGen; the brand mark is a CSS crop of the existing selected
logo asset. Real controls/text/diagrams are HTML, not the raster design mockups.
