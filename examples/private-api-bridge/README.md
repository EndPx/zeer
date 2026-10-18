# Operator-only read bridge

`proxy.py` is the forced-command implementation used by the hosted developer
preview. It exposes fixed loopback **read APIs**, not a shell or a node RPC proxy.
Normal self-hosted users can instead connect directly to their own HTTPS Prep
endpoint; this example is not needed for the local Chef quickstart.

An operator installs the script under `/opt/zeer-api-bridge`, owned by root and
not writable by the dedicated SSH account. Its protected `config.json` contains
only source API tokens, for example:

```json
{"prep":{"token":"REPLACE_WITH_PREP_READ_TOKEN"},"chef":{"token":"REPLACE_WITH_CHEF_READ_TOKEN"}}
```

Keep that file outside Git, root-owned and readable only by the account's group.
Create a private writable `state` directory for its concurrency/rate locks.
Use a dedicated account and a root-owned authorized-key entry with `restrict`
and a forced command pointing at this script. The SSH request command must be
exactly `zeer-query`; all other commands are rejected. Never install a root key
in the frontend hosting provider.

Pin the independently verified ed25519 host-key fingerprint on the client.
Constrain the dedicated account's aggregate CPU, memory and task count, in
addition to the per-process limits in this script. Verify denial of shell,
forwarding, unknown routes and wrong host keys before enabling traffic.
The included limits are a shared preview allowance, not a production SLA.

For request framing, environment variables and deployment checks, see
[the web deployment guide](../../docs/WEB_DEPLOYMENT.md).
