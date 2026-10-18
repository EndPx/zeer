# Zeer Developer Console — design proposal

Updated: 2026-10-18 (Asia/Jakarta). Implementation contract for the local preview.
This replaces the Activity Explorer as DX2's proposed consumer demonstration.

## Purpose and boundaries

One operator-managed public-data Zcash testnet demo. A developer can inspect
coverage, query Prep and read application entities through Chef. The console
does not deploy user projects, manage billing, accept viewing keys, or modify
the database. Developer-owned installations still run their own Chef/PostgreSQL
against a selected Prep endpoint.

Visual reference: `../assets/design/zeer-console-v1.png`. Its upper/lower frames
are separate Overview and Chef Playground routes, not one scrolling page.
The existing Prep example design (`zeer-prep-query-explorer-v3.png`) supplies
the Prep Playground content inside this shared shell. DESIGN.md owns tokens.

## Navigation and layout

- Routes: Overview, Prep Playground, Chef Playground. Footer links: Quickstart,
  GitHub. Persistent network label: Zcash Testnet.
- Desktop: 216px sidebar, 64px header, flexible content region; 24px content
  padding and gaps. One scroll owner for Overview content. Playground query and
  result panes own their bounded scroll; the toolbar remains visible.
- At widths below 1024px: sidebar becomes a disclosure; schema list collapses.
  Below 768px: stack controls; use Query/Response tabs instead of squeezing two
  code panes together. At least 44px touch targets and 14px code text.
- Next.js App Router supplies the shell and server-rendered pages. Playground
  islands own their inputs and response state; server adapters own credentials.
- Use restrained lime on selected navigation, focus and primary actions. No
  continuously animated status dots implying a connected source. UI feedback
  follows DESIGN.md; reduced motion disables nonessential transitions.

## Overview

Implemented network-status refinement: two separate progress meters for history
available from genesis to the observed tip, and Chef indexing within the available
Prep window. A late-start archive must not be presented as complete history.
The recent-block rail contains eight actual headers from Prep; its links open
single-block queries. No fabricated throughput, address totals or activity chart.
Status refreshes every 15 seconds while visible, without overlapping requests.
Stale source observations suppress source-tip percentages. Design tokens,
responsive geometry and motion behavior are specified in DESIGN.md.

Show these independently, with the observation time:

| Value | Source / meaning |
| --- | --- |
| Network and Prep range | Prep `/height`, actual archive start and indexed height |
| Prep source mode/readiness | Source metadata; historical snapshot is not live following |
| Chef checkpoint/read gate | Chef `_meta`; query can be unavailable during reconciliation |
| Upstream tip | Only when valid source metadata supplies it; otherwise Unknown |
| Chef lag to Prep | Only for compatible network/coverage observations; never substitute node lag |

The reference image uses recorded historical testnet sample 1000–1002 and
checkpoint 1002 from local onboarding acceptance. These values do not describe
the current VPS archive. Unknown upstream tip stays Unknown. Do not show Zebra's
growing node height as Prep coverage. Do not embed VPS host details or private logs.

The pipeline illustrates Prep → Chef handlers → PostgreSQL → GraphQL. A separate
Prep action opens its direct API playground; direct Prep reads do not go through
Chef's GraphQL. Two product panels explain this choice and link to each route.

## Prep Playground

Reuse the approved example selector/input/code/response pattern. Examples must
match discovered capabilities. Range upper bounds are clearly exclusive. JSON,
cURL and TypeScript examples derive from one validated query model. The backend
chooses configured upstream URLs; arbitrary target URL input is not included.

Initial sample mode supports changing example/code only. Recorded responses must
remain labeled with their original exact query, never as a result of edited input.
Connected mode enables Run and displays the actual response, status, pagination
and request timing. Do not report a first page as a complete unbounded scan.

Response refinement: keep the existing bordered code-panel primitive, with native
Table / JSON pressed buttons and Copy JSON. Table shows the requested public block
or transaction fields; long hashes remain selectable and scroll within the table.
Use 14px mono values, 12px metadata, 16px cell padding, the existing panel/line/text
tokens, and a 384px maximum scroll region. Empty arrays get an explicit zero-row
state. Raw JSON retains the complete response, including cursor and snapshot data.
Show measured browser-to-adapter response time separately from source coverage;
it is a request duration, not an engine benchmark. A cursor indicates more pages,
without automatic background pagination. Edited inputs label previous results.
Opening a recorded sample cancels an in-flight request so late results cannot
replace or mix with the sample. Chef also exposes Copy response and request time.

## Chef Playground

Show the example model, query editor, and response. The schema sidebar derives
from our public example schema, not runtime introspection (Chef does not currently
support introspection). Label it Example schema. Use these real supported fields:

```graphql
query {
  BlockSummaryList(first: 3) {
    items { height transactionCount }
  }
  _meta { height status }
}
```

The recorded fixture has three rows at heights 1000, 1001 and 1002 with one
transaction each, and `_meta.height = 1002`, `_meta.status = "ready"`. Mark this
as Recorded response when not connected. Actual live responses replace sample
content only after a successful request; never silently fall back to samples.
Generated raster code has punctuation artifacts: use the validated text above,
not OCR or code copied from the image.

Queries remain within Chef's existing limits. No mutations, subscriptions,
fragment support or schema introspection are promised. Copy copies editor text.
Ctrl/Cmd+Enter runs only when a real configured service is available.

## Connection and request states

| State | Required UI |
| --- | --- |
| Design/sample | Explicit banner; Recorded response; Run disabled with explanation |
| Configured idle | Show source mode and coverage; Run enabled for a valid query |
| Running | In-flight indicator, cancel, prevent duplicate execution |
| Success / empty | Actual response and coverage; empty is valid, not an error |
| Invalid query | Inline explanation; preserve query for correction |
| Unauthorized / unavailable | Sanitized actionable error; no tokens or internal connection strings |
| Rate limit / overload | Retry guidance from the actual server; no retry storm |
| Reorg / changed snapshot | Discard invalid continuation; ask for fresh query explicitly |
| Stale / reconciling / blocked | Distinct state; do not display old output as a fresh success |

Changing request inputs marks previous output outdated. Cancellation must stop
forwarding work where supported and must not overwrite a later response. Polling
status uses bounded frequency and pauses while hidden.

## Integration plan and acceptance

Server-side adapters keep Prep/Chef tokens out of browser bundles. Expose only
configured read paths with bounded request/response size, timeout and admission.
Do not expose a generic authenticated HTTP proxy. Public deployment remains a
separate action after local review and integration checks.

1. Review the console design and the meaning of each displayed status.
2. Implement reusable shell/controls; test mobile, keyboard and reduced motion.
3. Connect a bounded historical testnet Prep archive plus the installed Chef
   starter to the UI. Verify displayed output against captured source data.
4. Exercise disconnected, empty, invalid, unauthorized and reconciliation states.
5. Connect the hosted testnet services when available and show actual coverage.

The local console is implemented and connected to a bounded historical testnet
demo. No public endpoint, completed node sync or production readiness follows
from local acceptance. Performance results and detailed QA evidence stay local.
