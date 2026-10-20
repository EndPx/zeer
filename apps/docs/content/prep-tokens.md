# API access & tokens

The public testnet preview and a protected self-hosted Prep deployment can have different access policies. Use the policy of the endpoint you actually connect to.

## Public testnet preview

The base URL is `https://zeer.endpx.cloud/api/prep`. No personal API token or wallet connection is required. Requests share the published [preview quotas](/docs/prep/public-api/); this is not a dedicated capacity allocation.

The public routes read public chain data. A viewing key is not an API token and is never accepted by public Prep.

## Protected Prep deployment

An operator can configure the Prep server with `PREP_API_TOKEN`. When enabled, its routes require the deployment's bearer token. The operator supplies that credential through their own access process; this preview does not provide a token-creation dashboard.

Use HTTPS for remote access and keep credentials on a trusted backend. Configure the client from your protected environment:

```js
import { PrepClient } from "@zeer/prep-client";

if (!process.env.PREP_URL || !process.env.PREP_API_TOKEN) {
  throw new Error("Configure the intended private Prep URL and token.");
}
const client = new PrepClient({
  url: process.env.PREP_URL,
  token: process.env.PREP_API_TOKEN,
});
console.log((await client.getHeight()).ready);
```

Install the client through [Clients](/docs/prep/clients/) first. Do not put a private token in a public browser bundle, share URL, source file, screenshot or assistant prompt. Redirects are rejected by the client to avoid silently forwarding credentials elsewhere.

## Prep and Chef credentials are separate

A Prep token authorizes source-data reads. `CHEF_API_TOKEN` protects the application entity API. A UFVK authorizes local note viewing. None is a spending key, and none should be substituted for another.

For rejected requests, verify the target URL and its policy without printing the credential. For overload or source problems, follow [Troubleshooting](/docs/prep/troubleshooting/) rather than replacing a failed request with sample data.
