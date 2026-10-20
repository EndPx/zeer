# API access & tokens

| Endpoint | Authentication |
| --- | --- |
| Public testnet preview | No personal token required |
| Protected Prep deployment | Operator-issued bearer token when `PREP_API_TOKEN` is configured |

## Configure the client

For a protected deployment, read credentials from your backend environment:

```js
import { PrepClient } from "@zeer-dev/prep-client";

const client = new PrepClient({
  url: process.env.PREP_URL,
  token: process.env.PREP_API_TOKEN,
});
```

**Notes:**

- Use HTTPS for remote access. Keep private tokens out of frontend bundles, source files and shared URLs.
- `CHEF_API_TOKEN` protects Chef's GraphQL API separately. A viewing key belongs to [local receipt scanning](/docs/chef/shielded/local/), not API authentication.
- The public endpoint has [shared preview limits](/docs/prep/public-api/).
