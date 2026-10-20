# Schema and handler evolution

Chef currently supports explicit rebuild into a new project namespace. It rejects
changing the identity of an existing project. This document designs the operator
procedure for moving a running application from v1 to v2 without overwriting v1.
Automated deployment orchestration, a routing registry and atomic routing commands
are proposals; none is implemented by this procedure or its proof harness.

## Existing behavior and identity

Each `project` owns `chef_<project>` in PostgreSQL. `migrate` creates an empty
namespace, or validates an existing marked namespace. Opening, reading and writing
validate its stored configuration fingerprint, model fingerprint, network, start
height and recovery window. A different schema or handler identity cannot silently
reuse the old namespace. Namespace migration is database initialization, not a
data/schema upgrade command.

Field `@index` annotations also participate in model identity. Their addition or
removal uses the same new-namespace procedure in this version, even when the
GraphQL response shape is unchanged. This preserves the existing namespace;
in-place or concurrent online index-policy migration is not implemented. See the
[query-index contract](CHEF_QUERY_INDEXES.md) for supported fields and costs.

The CLI fingerprint includes configuration-file bytes, parsed schema fingerprint,
project, network, start height, recovery window, `handlerVersion` and normalized
Prep URL. Changing comments in the config can therefore change identity. Imported
helper implementations are not recursively hashed: bump `handlerVersion` whenever
their behavior changes. Freeze the whole checkout and dependency lockfiles for
each version; a version string alone does not make replay deterministic.

Handlers must restrict persistent effects to entity operations. An external HTTP
call, payment, message or file is outside block rollback and may repeat during
replay. Treat such effects as a separate delivery system before attempting an
upgrade. Do not replay an application that sends them directly.

The practical advantage is that the operator can inspect a replacement projection
and its new GraphQL contract while the existing projection remains available.
This follows from isolated namespaces and explicit replay; it is not a novelty
claim or evidence of production deployment automation.

## Version contract and shadow preparation

Before building v2, record the old and new commit, lockfiles, full configuration,
schema, handler version, source identity, network, start height, recovery window,
database namespace and API contract. Keep this release manifest local with the
validation record. Do not include credentials in it.

Classify the API change. Adding an entity or nullable field may preserve existing
queries, but renamed/removed fields, scalar or nullability changes, entity-ID
changes and changed business meaning need an explicit consumer upgrade. Even an
added required field needs complete replay values. Check every supported consumer
query against the v2 API, plus negative queries for removed fields. Generate and
typecheck v2 types from its own schema. Never copy v1 JSON into v2 merely because
the database physical tables look identical.

Choose a new unique v2 `project` and a separate loopback GraphQL port. Preserve v1
config and namespace. Use existing commands with the respective frozen checkout:

```sh
zeer-chef codegen --config app-v2/chef.config.ts --json
zeer-chef migrate --config app-v2/chef.config.ts --json
zeer-chef sync --config app-v2/chef.config.ts --to "$target_height" --json
zeer-chef serve --config app-v2/chef.config.ts --port 39471 --json
```

`PREP_URL`, `DATABASE_URL` and API tokens select the intended source/database for
that invocation. Chef requires full-v1 history covering the intended start height;
its CLI accepts height zero when the selected archive covers genesis. A schema change does not authorize changing
the historical start or dropping history needed by the new handler. Verify the
capacity for a second projection and its undo journal before shadow replay. The
v1 and v2 writers use different namespace locks and can run together, but the
experiment's CPU/memory/disk budget still applies.

## Pin, replay and approve

A height by itself is not a pin. Capture a source tuple `(network, epoch, height,
hash)` plus the corresponding v1 checkpoint/hash and source observation. `epoch`
belongs to the selected Prep archive; do not compare epochs across archives as
global consensus identifiers. Record source history coverage, payload kind and
readiness. For a historical snapshot, record that upstream freshness is unknown.

For a bounded validation, pause writers at a known checkpoint or use an immutable
labelled archive. Replay v2 to the same inclusive target. If v1 has already moved
past the chosen target, its normal API cannot return an arbitrary past application
snapshot: choose a new common checkpoint and pause both writers, or perform
independent source-derived comparisons. Do not compare current v1 rows with v2
rows at a different height and call the difference a migration defect.

Validate v2 with an independent oracle for its new semantics, not just equality
with v1 or equality of row counts. Check entity identities, exact values,
aggregates and orphan removal; paginate complete lists. Compare v2 checkpoint
height/hash to the pin. Both the database read gate and API must be ready. An
empty newly migrated namespace can have a `ready` state; it is not eligible until
the required target and application checks pass. Verify authorization and relevant
schema incompatibilities as well.

Immediately before a routing decision, re-read Prep identity/readiness and the
target block hash/epoch. Revalidate both projections against the approved tuple.
Any epoch change invalidates the approval record even if the target hash happens
to match: reconcile and inspect the current source, then make a fresh pin and
approval. Chef reconciles within its retained window through normal `sync`; an
operator must never edit `state`, call `markReady` manually or copy undo records.

For a running source, advance v2 to a newly agreed common checkpoint after initial
backfill. Pause both writers briefly, verify that checkpoint and route, then resume
the chosen writers. Alternatively keep both following and repeat approval if the
pin moves. This design does not make the observations and external routing update
one transaction, and a pause does not freeze a live canonical chain. Check again
after routing and monitor reorg/readiness changes through the running writers.

## Cutover choices and request consistency

Existing Chef servers serve the namespace they were configured with. Chef has no
mutable `activeProject` record, readiness lease, global routing transaction or
cross-version request pinning. The operator owns the application's URL switch.

| Option | Behavior and limit |
| --- | --- |
| Update application endpoint configuration | Available today through the application's own deployment/config mechanism. Different clients can refresh at different times; no global atomic switch is implied. |
| Change an operator-managed reverse proxy upstream | Possible outside Chef after separate proxy validation. Reload/request-boundary semantics belong to that proxy. Keep each request on one server; this alone does not make a multi-request session version consistent. |
| Versioned URLs, with clients choosing v1/v2 | Makes the contract explicit and enables gradual adoption. Consumers own version selection and stateful pagination must stay on the same version. |
| Transactional routing record read once per request | Proposed automation requiring a new router/registry, compare-and-swap version, validated release manifest and durable audit trail. A PostgreSQL update can be atomic for that record; it does not atomically coordinate other processes, source reorgs or client caches. |

Record the actual endpoint/version selected and retain the prior routing
configuration. Validate representative reads immediately after the switch. A
single Chef response has an existing repeatable-read snapshot; a cutover cannot
extend that consistency guarantee across multiple requests or across versions.
Finish old in-flight requests on v1 or drain them using the chosen gateway's
documented behavior. Restart pagination on v2 rather than reusing a v1 cursor:
list cursors are entity IDs and do not encode a deployment version.

## Rollback and failures

Rollback means routing to a validated v1 service, not undoing v2 database tables.
Retain both namespaces, code/configurations and evidence until the rollback
window ends. Keeping the old writer following improves rollback readiness but
requires its own health and capacity monitoring. A stopped old writer can remain
`ready` while stale. Before rollback, run v1 sync against the expected source,
validate current height/hash, recovery status and its API contract, and establish
a new pin. If v1 falls beyond its retained window, rebuild a separate v1 namespace
from the original code and available source history; never route to the blocked
or stale namespace merely to restore an old UI quickly.

| Failure | Required operator response |
| --- | --- |
| v2 handler/schema validation failure | Retain its last committed prefix and failure record. Continue serving v1. Correct behavior in a new version/namespace if identity changes; do not relabel partial replay as complete. |
| Source outage, wrong network/kind, unavailable history | Defer approval. Diagnose source identity/coverage, restore it, and reconcile through sync. `status` alone does not mutate the read gate. |
| Reorg during replay or approval | Invalidate the old pin; reconcile supported depth, independently verify replacement effects, and approve a fresh tuple. |
| Beyond-window `REBUILD_REQUIRED` | Keep the blocked namespace, create a new namespace and replay; follow the operator guide. |
| Consumer incompatible with v2 | Retain versioned v1 access or coordinate consumer release. A correct v2 database does not prove consumer compatibility. |
| Failed/ambiguous routing operation | Inspect the routing owner's actual state and test requests before retrying. Both API processes being alive does not prove where traffic goes. |
| v2 fails after routing and v1 is stale | Gate or restore reads through the routing owner as appropriate; reconcile/rebuild v1 before rollback. There is no Chef automatic failover promise. |

No namespace deletion, destructive reset, public deployment or production routing
change is part of shadow validation. Cleanup removes only explicitly identified
disposable proof resources; operational retirement needs a separate retention and
backup decision.

## Reproducible PostgreSQL proof

See [the proof recipe](../benchmarks/chef/evolution/README.md). It exercises
existing `PostgresStore`, `syncStep` and loopback GraphQL against a labelled
synthetic full-v1 source. It proves namespace isolation, identity rejection,
different v2 schema/semantics, atomic interrupted replay with a complete prefix
oracle, independent exact-value validation, readiness/network gates, epoch-only
pin invalidation, complete replacement-row checks and reconciliation of v1 before
rollback eligibility. It performs no routing change and does not prove
live-node consensus, deployment-level atomicity or production capacity.
