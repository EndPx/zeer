# Envio documentation review for Zeer

Review date: 20 October 2026 (Asia/Jakarta).

This is a documentation study, not an implementation plan approval or an Envio runtime benchmark. It supplements the earlier [package and architecture investigation](ENVIO_HYPERINDEX_RESEARCH.md), which has its own pinned date and evidence. No Envio package, indexer, cloud deployment, wallet operation, or payment was run for this review.

## Scope and reading evidence

Discovery started with the official [documentation index](https://docs.envio.dev/llms.txt), [sitemap](https://docs.envio.dev/sitemap.xml), navigation, and internal links. Individual Markdown pages were cross-checked against the current consolidated text. A further link pass found the three product-specific consolidated references. A final pass found no additional unaccounted documentation destinations in the collected links.

| Surface | Entries | Review method |
| --- | ---: | --- |
| Current HyperIndex, including Cloud, Solana and Fuel guides | 76 | Full page text, including examples and tables |
| Current HyperSync, including Solana and HyperFuel | 19 | Full page text, including query/response field references |
| Current HyperRPC | 2 | Full page text and network table |
| HyperIndex V2 archive | 65 | Existing current-page content plus all distinct archived text; version differences recorded |
| Product-specific consolidated references | 3 | Previously read content deduplicated, then remaining text and FAQs reviewed |
| Linked static EVM configuration schema | 1 | Full JSON schema |
| Landing, tag, showcase and video-summary pages with extracted content | 22 | Extracted page text; videos themselves not watched |
| Blog/tag listing routes with no extracted article body | 6 | Navigation/fetch inventory only |
| Supporting blog articles | 87 | Catalogued and cached; **not all read in full** |
| **Total inventoried entries** | **281** | See the per-entry ledger |

The technical-documentation scope is 97 current pages, 65 archived pages, three consolidated references and one linked schema: **166 entries**. This count includes duplicates represented as separate official resources; it is not a claim of 166 independent feature specifications.

The [coverage ledger](research/envio-docs-coverage-20261020.csv) records every entry's URL, category, reading method, extracted character count and SHA-256. Exact duplicate text was not reread merely to inflate coverage. For the archive, whitespace and V2 URL-prefix normalization identified already reviewed lines. For the two later consolidated references, Markdown link labels were also normalized. Unique text was reviewed, rather than treating a successful download as completed reading.

The original corpus and working notes remain in an ignored local research cache. They are not republished in this repository. This report contains our analysis and source pointers.

**Boundary:** the review covers the discovered technical documentation and the supporting page text described above. It does not claim that every blog article, video, screenshot, outbound repository, SDK API site or externally linked service was exhaustively examined. The media/link inventory contains 511 distinct referenced image/video URLs, including variants; those are references, not 511 watched or visually inspected items. The 87 blog articles are explicitly outside the completed full-reading count.

## 1. The documentation follows product responsibilities

Envio's top navigation separates HyperIndex, HyperSync, HyperRPC and Envio Cloud. These are entry points into different developer jobs:

| Entry point | Developer job | Documentation emphasis |
| --- | --- | --- |
| HyperSync | Retrieve and filter raw chain data | Query structure, fields, filters, joins, clients, pagination, streaming and coverage |
| HyperIndex | Build application entities from chain data | Config, schema, handlers, local development, tests, persistence and GraphQL |
| HyperRPC | Keep an existing JSON-RPC integration | Supported read methods, compatibility limits, authentication and endpoints |
| Cloud | Operate a hosted indexer | Deployment, production promotion, monitoring, access controls and plan limits |

These are related layers, not interchangeable names for the same API. HyperRPC is a supported-method, read-only compatibility surface over HyperSync; it is not a complete replacement for every node operation. HyperIndex adds application processing and persistence above the raw data layer. Sources: [HyperSync overview](https://docs.envio.dev/docs/HyperSync/overview), [HyperIndex overview](https://docs.envio.dev/docs/HyperIndex/overview), [HyperRPC overview](https://docs.envio.dev/docs/HyperRPC/overview-hyperrpc), [Cloud overview](https://docs.envio.dev/docs/HyperIndex/hosted-service).

For Zeer, the useful correspondence is **Prep for public source-data queries, Chef for developer-owned processing and queryable entities**. This is a documentation analogy, not a claim that Zeer implements all Envio features.

Shielded receipt scanning, viewing-key use, note decryption and readable memos belong under **Zeer Chef**. Public shielded metadata and filters belong under **Prep**. Neither needs to become a third product or a new top-level application menu. The developer's local viewing-key example remains a Chef workflow; a public playground must not imply that public metadata alone reveals private notes or memos.

## 2. The strongest pattern is the learning sequence

The docs move from a concrete outcome into progressively more detail:

1. Explain which product solves the task.
2. Run the smallest useful query or indexer.
3. Show the files that control it.
4. Show the output query and expected meaning.
5. Add filters, relationships, external reads and more advanced processing.
6. Test the logic and then explain deployment, recovery and monitoring.

The three-file model makes HyperIndex approachable: configuration selects source events, the schema defines stored entities, and handlers transform the former into the latter. The beginner can first use a template or contract import; the reference remains available when they need precise syntax. Sources: [quickstart](https://docs.envio.dev/docs/HyperIndex/quickstart), [configuration](https://docs.envio.dev/docs/HyperIndex/configuration-file), [schema](https://docs.envio.dev/docs/HyperIndex/schema), [event handlers](https://docs.envio.dev/docs/HyperIndex/event-handlers).

The best tutorials are task-oriented rather than a tour of controls. The ERC20 guide leads to largest transfers and recipient activity; Uniswap V4 explains why pool identifiers matter; the Fuel example builds a player leaderboard. These show both the input and the useful application entity. Sources: [ERC20 transfers](https://docs.envio.dev/docs/HyperIndex/tutorial-erc20-token-transfers), [Uniswap V4](https://docs.envio.dev/docs/HyperIndex/example-uniswap-v4-multi-chain-indexer), [Fuel leaderboard](https://docs.envio.dev/docs/HyperIndex/tutorial-indexing-fuel).

For Zeer, judge-facing examples should similarly show a real question, a valid query, actual returned fields and a clear interpretation. A range with no matching rows should explain how far the scan advanced. A publicly visible shielded transaction and a privately decrypted note are different demonstrations.

## 3. Query semantics deserve their own reference

HyperSync's main query reference specifies inclusive starts, exclusive ends, field projections, selection logic, response limits, relationship joins and a continuation block. Omitting an optional result-count parameter does not make every response unbounded. The server can stop on its time or response-size budget, complete its current block group and return a continuation. Sources: [query reference](https://docs.envio.dev/docs/HyperSync/hypersync-query), [stream tuning](https://docs.envio.dev/docs/HyperSync/stream-config-tuning).

This is directly relevant to the earlier Zeer discussion about `limit`. Developer freedom and bounded transport are compatible: hide unnecessary fixed-block scan controls from the main experience, document the real API contract, and make continuation reliable. Do not describe a query starting at block zero as downloading every block and every field in a single response.

The protocol distinctions also matter. Solana filters, instruction paths, optional values and transaction indices have semantics that differ from EVM examples. Its available history does not necessarily begin at genesis. Fuel has its own receipt/input/output model and client limitations. Sources: [Solana query](https://docs.envio.dev/docs/HyperSync/solana-query), [Solana configuration](https://docs.envio.dev/docs/HyperIndex/solana/configuration), [HyperFuel query](https://docs.envio.dev/docs/HyperSync/hyperfuel-query).

Zeer therefore needs Zcash-specific field definitions. Fields such as transaction position, coinbase status, public pool activity and private receipt values must be explained from the actual Zeer API and Zcash data model. An EVM `from`/`to` example cannot simply be relabelled as a shielded Zcash transfer.

## 4. Fast indexing has several separate causes

The docs attribute historical speed to the combination of a prepared data source, source-side filtering and projection, concurrent fetching, batched entity reads, ordered processing, cached external reads and efficient storage writes. These are independent costs; a fast raw scan alone does not establish fast application indexing. Sources: [HyperSync as source](https://docs.envio.dev/docs/HyperIndex/hypersync), [preload optimization](https://docs.envio.dev/docs/HyperIndex/preload-optimization), [effect API](https://docs.envio.dev/docs/HyperIndex/effect-api), [database performance](https://docs.envio.dev/docs/HyperIndex/database-performance-optimization).

V3 preload runs handlers in two phases: optimistic parallel reads, followed by processing in order. The first phase suppresses entity writes. External side effects require care because database replay and rollback do not undo a webhook or payment. Effects support batching/caching, but a developer still has to choose the right cache identity and historical input. This is an architectural lesson, not a suggestion to add payouts to an indexer handler.

For Zeer performance reporting, distinguish:

- Raw Prep filtering/scanning throughput.
- Chef transformation plus committed database writes.
- Delay from source head to queryable entities.
- GraphQL response latency during ingest.
- Local private trial-decryption work and the number of relevant receipts.

Keep correctness, resource ceilings and concurrent read load visible. Envio's open benchmark page reports a ground-truth-checked comparison with scenario-specific results, including a scenario where another HyperSync consumer leads. That is more useful than adopting a universal multiplier. Sources: [benchmarks](https://docs.envio.dev/docs/HyperIndex/benchmarks), [benchmarking guide](https://docs.envio.dev/docs/HyperIndex/benchmarking).

## 5. Operational explanations are part of the developer API

Envio distinguishes liveness, indexing progress and readiness. Its `_meta` reference distinguishes data committed transactionally with entity batches from fields updated separately and throttled. The observability guide connects source, processing, storage and backpressure metrics to likely bottlenecks. Source: [observability](https://docs.envio.dev/docs/HyperIndex/observability).

Zeer's documentation should preserve the same distinctions using Zeer's own implemented fields: source tip, Prep coverage, Chef configured range, Chef committed checkpoint, active/paused/error state, and time checked. A fixed demonstration range reaching 100% does not establish full-history coverage or current network readiness. An unavailable source tip must stay unavailable rather than turning into a fabricated zero gap.

Reorganization handling also needs a precise scope. HyperIndex's documentation describes bounded history and entity rollback; the raw HyperSync user owns continuation and near-head rollback handling. Database rollback cannot retract external effects. Sources: [HyperIndex reorgs](https://docs.envio.dev/docs/HyperIndex/reorgs-support), [HyperSync rollback guard](https://docs.envio.dev/docs/HyperSync/hypersync-query#rollback-guard).

Cloud documentation is a separate operating model: a new deployment can replay while the old production endpoint continues serving, then promotion changes the served deployment. Local checkpoint resume and a fresh deployment replay should not be presented as the same action. Source: [Cloud deployment](https://docs.envio.dev/docs/HyperIndex/hosted-service-deployment).

## 6. Version differences and documentation defects to avoid copying

These are observations about the fetched documentation, not claims that the deployed Envio runtime is defective.

| Observation | Why it matters for Zeer |
| --- | --- |
| V2 uses `networks`, generated contract imports and different testing helpers; V3 uses `chains`, a unified indexer API and the newer testing framework. | Version labels must accompany examples, migrations and generated output. |
| The linked static `/schemas/config.evm.json` still contains V2 fields such as `networks`, `output` and `preload_handlers`. Current V3 reference describes their replacements/removal. | A schema explorer and prose reference must be generated or checked against the same supported version. |
| Current local-running/troubleshooting prose still contains instructions or assumptions inherited from V2. V3 migration/CLI documentation distinguishes normal resume from explicit reset. | Put the actual checkpoint-preserving restart command next to an explicit destructive reset explanation. |
| `envio stop` and migration setup can delete local data. Some surrounding beginner material describes stopping more casually. | Name destructive commands clearly and explain their consequences before the command. |
| Some source overview tables suggest no rate limiting, while the token documentation describes real authentication and budget enforcement. | Keep authentication, server transport bounds and plan limits in one authoritative place. |
| The consolidated HyperIndex FAQ still suggests enabling `unordered_multichain_mode`, although the V3 migration says that opt-in was removed. | Consolidated/AI docs need the same freshness checks as browser pages. |
| The consolidated HyperSync FAQ calls Go an official client, whereas the client-specific page distinguishes community support. | State maintenance/support status consistently. |
| Some snippets omit a token or use older optional fields/import patterns even when surrounding prose requires newer behavior. | Validate copyable examples against the supported interface. |
| A performance explanation combines thousands of calls with a very small time estimate while its example also specifies a restrictive rate limit. | Publish measured workload and limits rather than illustrative arithmetic as a guarantee. |
| Price-data and error-handling examples sometimes use fallback zero/partial values or mutable process state. | Do not use such shortcuts for receipt accounting or financial decisions. |

Sources: [V3 migration](https://docs.envio.dev/docs/HyperIndex/migrate-to-v3), [CLI reference](https://docs.envio.dev/docs/HyperIndex/cli-commands), [running locally](https://docs.envio.dev/docs/HyperIndex/running-locally), [configuration reference](https://docs.envio.dev/docs/HyperIndex/config-schema-reference), [linked JSON schema](https://docs.envio.dev/schemas/config.evm.json), [API tokens](https://docs.envio.dev/docs/HyperSync/api-tokens), [client support](https://docs.envio.dev/docs/HyperSync/hypersync-clients), [price-data guide](https://docs.envio.dev/docs/HyperIndex/price-data), [HyperIndex consolidated reference](https://docs.envio.dev/docs/HyperIndex-LLM/hyperindex-complete), [HyperSync consolidated reference](https://docs.envio.dev/docs/HyperSync-LLM/hypersync-complete).

The internal-link audit observed **37 failed URL fetches** across the initial and follow-up passes: 35 documentation-reference paths and two image paths. This includes obsolete directory routes and `.mdx` links; it is not 35 missing feature guides, since working canonical pages often exist. The short `/docs/contract-import` and `/docs/overview` pages were checked separately and contain browser redirects to already reviewed canonical pages. Broken source links should be fixed or redirected rather than reproduced in Zeer.

## 7. Documentation infrastructure observed

Fetched browser HTML identifies **Docusaurus v3.4.0** in its generator metadata. The site uses separate product navigation, a versioned HyperIndex sidebar, contextual right-hand headings, search, code examples, admonitions and linked tutorial media. Text is available to agents through the index, individual `.md` routes, consolidated bundles and an MCP documentation endpoint. This is observed site infrastructure, not a recommendation to install an old framework release. Sources: [documentation site](https://docs.envio.dev/docs/HyperIndex/overview), [LLM index](https://docs.envio.dev/llms.txt), [MCP guide](https://docs.envio.dev/docs/HyperIndex/mcp-server).

The reusable lesson is to maintain one set of supported facts with several reading surfaces. Browser docs, quickstarts, query examples and AI-readable text should agree. Automated broken-link checks, version-compatible snippets and generated API reference checks would prevent several of the inconsistencies above.

## 8. Implications for Zeer documentation

These are recommendations for the next design discussion, not implemented navigation:

| Area | Content justified by this study |
| --- | --- |
| Start here | What Zeer does, Prep versus Chef, the source-to-API path, prerequisites and a short first success |
| Prep | Queries, fields, public transaction categories, public shielded metadata, continuation/streaming, coverage and errors |
| Chef | Config, entity schema, handlers, PostgreSQL/GraphQL, checkpoints, replay and tests |
| Chef → Shielded & Memos | Local viewing-key setup, supported scanning/decryption, private receipt entities, readable memos, replay and privacy boundary |
| Guides | Real public-data examples and a separately labelled local private-memo example |
| Operations/reference | Authentication, status meanings, restart versus reset, reorg behavior, performance evidence and troubleshooting |

For the Chef memo guide, explain the difference between an encrypted memo, a successfully decrypted note, the actual received amount, and the memo text interpreted by application logic. Zeer can provide indexed evidence; an application such as ZeeSwap owns its order matching and payout policy. Building a private ZeeSwap Chef remains outside this Zeer task.

Do not advertise an Envio feature as a Zeer capability solely because this review found it useful. Before publishing each Zeer example, check the current implementation, run the actual query or local workflow, and label any unsupported or planned behavior. Keep the public playground examples in the existing Prep/Chef experience.

## Review result

The discovered current technical docs, V2 differences, consolidated technical references and linked schema have been studied. Their major API contracts, developer learning sequence, operational boundaries and inconsistencies are recorded above. Supporting article and media coverage is explicitly limited in the scope table. No new Zeer docs framework, page navigation, backend feature or deployment was introduced by this research.
