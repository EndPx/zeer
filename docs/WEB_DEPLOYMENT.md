# Web preview deployment

The repository's Vercel project uses `apps/web` as its root, Next.js, Node24,
`npm ci` and `npm run build`. `.vercelignore` excludes local operational files,
credentials, datasets and generated build artifacts. A successful web build is
not evidence that its data sources are connected or fully synchronized.

## Source connection

Normal deployments use operator-controlled HTTP/HTTPS `ZEER_PREP_URL` and
`ZEER_CHEF_URL`, with their API tokens kept server-side. The console never accepts
a target URL or credentials from a visitor.

The hosted preview alternatively uses `ssh://prep` and `ssh://chef` with a
dedicated read-only forced-command account. Its private key is an encrypted
server environment variable, **not a root/administrative key**. The SSH client
pins the independently verified ed25519 host-key SHA-256 hex digest. Connection
failure never falls back to an unverified host or plaintext public transport.

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
