# Zeer Chef (public-data prototype)

Chef reads complete public Zcash data from Prep, invokes trusted TypeScript
handlers, commits application entities to developer-owned PostgreSQL, and serves
an authenticated read-only GraphQL API. This private workspace package is not
published to npm. The current slice has no viewing-key scanner or private memos.

Install the repository with `npm ci`, build with `npm run build:chef`, and follow
the [public example](../../examples/chef-public/README.md). Node 24.14+ is required
for the validated native TypeScript config path. Use erasable TS syntax.

```sh
node packages/chef/dist/cli.js codegen --config examples/chef-public/chef.config.ts
node --env-file=.env packages/chef/dist/cli.js migrate --config examples/chef-public/chef.config.ts
node --env-file=.env packages/chef/dist/cli.js sync --config examples/chef-public/chef.config.ts --to 2048
node --env-file=.env packages/chef/dist/cli.js serve --config examples/chef-public/chef.config.ts
```

Migration is explicit. Each project owns a marked `chef_<project>` namespace.
The framework refuses unmarked existing namespaces and configuration/schema
identity mismatches. One session-level advisory lock admits one writer.
The database operator supplies access and owns backups; no hosting or billing
service is provisioned by Chef.

Block and transaction handlers execute in canonical order. Entity `get`, `set`
and `delete` operate inside one block transaction with before-images and a
checkpoint. A failed block rolls back all its writes; earlier committed blocks
remain. Contexts cannot be used after their transaction finishes. BigInt values
are JS `bigint` in handlers and canonical decimal strings in storage/GraphQL.

Reorg recovery uses retained block hashes and before-images. Reads are unavailable
while the framework reconciles/replays or cannot validate its source, and deep
reorgs enter a rebuild-required state. The caller starts a fresh project namespace
for changed handlers/schema; automatic migration and replay cutover are deferred.
Changes in imported helper modules must increment `handlerVersion` because the
entry-file fingerprint does not discover the whole module dependency graph.

Handlers are trusted executable code, not a sandbox. Supported handlers are
deterministic and use only the entity context for effects; network calls, payments,
email, randomness and wall-clock inputs are outside this supported contract.
There is no transactional outbox in this slice.

GraphQL supports scalar entities, equality filters, ID-order cursor pagination
and `_meta` checkpoint data. It has no mutations, relations, subscriptions,
introspection, fragments or executable directives. A bearer token is required.
See the example for request, response and concurrency bounds. No public
production endpoint or Neon compatibility result is claimed.

```sh
npm run build:chef
# Use a disposable database; integration tests create isolated generated namespaces.
CHEF_TEST_DATABASE_URL=postgresql://... npm run test:chef
```

PostgreSQL tests skip when their environment variable is absent. Such a run is
not a database integration proof. Keep database durability settings, source
coverage and deployment limits explicit in evidence.
