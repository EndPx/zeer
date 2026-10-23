# Anonymous judge journey — 23 October 2026

Result: **PASS**. A fresh real-Chrome context, without an existing browser profile
or saved storage state, exercised the public site through visible links/buttons.
No request mocking or response substitution was used. The visitor started and
finished with zero cookies; first-party requests carried neither cookies nor an
Authorization header. No developer account, wallet or viewing key was supplied.

## Discovery

| Visitor path | Result |
| --- | --- |
| Homepage → Read the docs → Chef Quickstart | Two link clicks; current 0.6.1 instructions and prerequisites visible |
| Docs product navigation → Prep → Quickstart | Published Prep client 0.1.0 instructions found |
| Homepage → Open App → Prep Playground | Query controls available without authentication |
| Console Quickstart → docs onboarding | Both products' quickstart choices visible |
| Mobile console menu → Quickstart → Chef Quickstart | Passed at 390 × 844; no document horizontal overflow |

## Real examples executed

All ten POST requests returned **HTTP 200 on the first attempt**, with successful
JSON results. No retry was needed.

| Product | Examples |
| --- | --- |
| Prep | Block headers from genesis; verified modern Orchard activity |
| Chef | Browse, next example page, genesis, height filter, two-height comparison, checkpoint, latest indexed block, published shielded memo |

Prep and Chef returned the same genesis height, hash and timestamp. Chef list
pagination advanced to different records. The published receipt returned
`Hello from Zeer Chef`, `100000` zatoshi, pool `ironwood`, height `4523289` and
`origin: unknown`. The browser reported no uncaught page errors. Fifteen navigation
and query steps completed, including desktop and mobile quickstart discovery.

The Prep sample button fills a known starting point and retains a captured-head
scan with bounded pages; it does not restrict the output to three headers. An
initial harness assertion expecting exactly three rows was corrected against the
visible UI/API contract. Its recorded request succeeded with HTTP 200. That
harness correction was not a product or service failure.

## Scope

This is one point-in-time visitor check, not a sustained-availability test, load
benchmark, fresh native decryption test or production-readiness claim. The hosted
demo projects retain their own schema; they do not expose every feature of the
npm SDK. The selected memo is deliberately public and does not expose arbitrary
wallet data. Local private indexing still follows the viewing-key setup guide.

No application runtime change was needed for this check. Screenshots, the exact
browser driver and full network/query evidence remain in the ignored local
`judge-check-20261023` evidence directory. The compact machine-readable results
are [recorded separately](JUDGE_PREFLIGHT_20261023.json).
