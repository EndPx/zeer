# Supported networks

The hosted developer preview documented here targets **Zcash testnet**. Read the source's reported network and coverage before running an example.

## Hosted networks

| Network | Identifier | Prep API base URL | Access |
| --- | --- | --- | --- |
| **Zcash Testnet** | `testnet` | [https://zeer.endpx.cloud/api/prep](https://zeer.endpx.cloud/api/prep) | Public developer preview; no personal API token |

`testnet` is the value of Prep's network field. Use it to check the endpoint's identity. It is not an EVM numeric chain ID.

The hosted archive follows testnet history from genesis. Read its current available range and readiness at [GET /height](https://zeer.endpx.cloud/api/prep/height); the indexed end changes as the follower progresses. Use [Prep Playground](https://zeer.endpx.cloud/app/prep) to try public queries or [Chef Playground](https://zeer.endpx.cloud/app/chef) to inspect the public application projection.

## Zcash Testnet endpoints

| Method | URL | Purpose |
| --- | --- | --- |
| GET | [Height and coverage](https://zeer.endpx.cloud/api/prep/height) | Network identity, available history and source status |
| GET | [Capabilities](https://zeer.endpx.cloud/api/prep/capabilities) | Supported fields, filters, routes and bounds |
| POST | `https://zeer.endpx.cloud/api/prep/query` | Public block and transaction queries |

Use the base URL in the table for `PrepClient`. These routes use Prep's HTTP JSON contract. See [cURL examples](/docs/prep/curl/) for request bodies.

## Verify identity and coverage

```sh
curl --fail-with-body https://zeer.endpx.cloud/api/prep/height
```

Inspect the network, available start, indexed height and readiness. A dataset with a late start is not genesis-complete merely because its indexed height is large. A historical snapshot can be usable while a fresh source-tip observation is unavailable.

## Self-hosted sources and fixtures

A self-hosted Prep endpoint serves its configured archive's network, payload profile and available range. Older repository fixtures include explicitly labelled historical mainnet data; those fixtures are not a hosted mainnet endpoint.

The code may recognize multiple network identifiers for archive/configuration validation. That is not evidence of a running public endpoint for each network. Do not relabel historical mainnet fixture results as testnet or assume mainnet hosting from a supported identifier.

## Use testnet with Chef

Choose `network: "testnet"` in the Chef configuration and supply the Prep base URL through the project's environment:

```sh
PREP_URL=https://zeer.endpx.cloud/api/prep
```

Follow [Chef Quickstart](/docs/chef/quickstart/) for the complete configuration and PostgreSQL setup. Prep coverage and Chef's committed checkpoint are reported separately.

## Protocol-specific features

Sapling, Orchard and Ironwood are shielded-pool/protocol features within Zcash, not three independent blockchain networks. Public component presence depends on actual transaction data and activation history. A format version alone does not prove a pool was used.

The optional watch-only receipt scanner currently has its own experimental **testnet-only** profile. Its scope is documented under [Chef → Shielded & Memos](/docs/chef/shielded/overview/). It does not turn the public API into a wallet-scanning service.

Use [the coverage contract](/docs/prep/public-api/) and [public shielded reference](/docs/prep/shielded/) for the exact boundaries.
