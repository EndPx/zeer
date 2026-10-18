# Web preview deployment

The primary preview is **https://zeer.endpx.cloud**, hosted on the same VPS as
Prep and Chef. Nginx terminates HTTPS and proxies to a loopback-only Next.js
standalone server. Its server-side source URLs use localhost, avoiding an SSH
handshake on the public request path. Node RPC and PostgreSQL remain private.

The web service runs as a dedicated unprivileged user with a 0.5 CPU / 512 MiB
ceiling inside the existing aggregate Zeer resource slice. Builds run separately
with 0.5 CPU / 1 GiB and two Next.js build workers. Both are covered by the
operator's resource guard. Source tokens are supplied by a protected environment
file; they are never passed during builds or bundled into browser code.

To assemble a Linux release, run the workspace build, copy
`apps/web/.next/standalone` into the release directory, then place `public` and
`.next/static` beneath its `apps/web` directory. Start `apps/web/server.js` with
`NODE_ENV=production`, `HOSTNAME=127.0.0.1`, an operator-selected port, the source
URLs/tokens, and `ZEER_WEB_ORIGIN=https://zeer.endpx.cloud`. Preserve the previous
release for rollback and validate the loopback service before changing Nginx.

The primary API ingress is limited to two requests/second globally with a burst
of eight; the Node adapter independently bounds active upstream requests to two.
Certificates renew through the existing Certbot timer, with a domain-scoped
Nginx reload hook. Changing the website does not reset chain or application data.

## Vercel alternative

The repository's Vercel project uses `apps/web` as its root, Next.js, Node24,
`npm ci` and `npm run build`. `.vercelignore` excludes local operational files,
credentials, datasets and generated build artifacts. A successful web build is
not evidence that its data sources are connected or fully synchronized.

## Source connection

Normal deployments use operator-controlled HTTP/HTTPS `ZEER_PREP_URL` and
`ZEER_CHEF_URL`, with their API tokens kept server-side. The console never accepts
a target URL or credentials from a visitor.

Remote hosting can alternatively use `ssh://prep` and `ssh://chef` with a
dedicated read-only forced-command account. Its private key is an encrypted
server environment variable, **not a root/administrative key**. The SSH client
pins the independently verified ed25519 host-key SHA-256 hex digest. Connection
failure never falls back to an unverified host or plaintext public transport.

The optional SSH adapter reuses one pinned connection per warm process, permits
two request channels, expires idle connections after 30 seconds and retires them
after two minutes when idle. Cancellation closes only its own channel. Results
are never cached by this transport; VPS deployment uses direct loopback HTTP.

Required server variables are listed in `apps/web/.env.example`. The bridge
command is `zeer-query`: one bounded JSON request on stdin and one status/body
envelope on stdout. Only fixed loopback Prep routes and the read-only Chef
GraphQL route are permitted. No shell, SFTP, forwarding or client-selected
upstream destination is granted. Source API tokens stay on the VPS.

The operator must install a root-owned forced-command implementation, root-owned
authorized-key policy, protected source-token configuration, global concurrency
and rate limits, process deadlines and a dedicated resource limit. Our deployment
tests denied shell commands, unsupported routes, forwarding and incorrect host
keys before use. These controls supplement the server's own query bounds.

The [operator bridge example](../examples/private-api-bridge/README.md) provides
the implementation without host-specific credentials or resource configuration.

Set `ZEER_WEB_ORIGIN` to the canonical web URL. The developer Prep protocol routes
deliberately expose public-chain reads through CORS; the website's console
adapters keep their origin checks. Do not reuse this public bridge for private
viewing-key data or arbitrary user application entities.

## Verification

After deployment, use the actual public URL to verify `/api/status`, SDK height
and capability discovery, genesis queries, pagination, transaction lookup and
GraphQL results. Compare sample hashes and raw transactions against the node.
Check failure responses, snapshot-change errors and absence of server secrets
from HTML/browser assets. Retain evidence locally.

Public source operations can be paused during backfill, recovery or storage
migration. The UI must expose this state and actual coverage. A recorded example
must never replace a failed live request.
