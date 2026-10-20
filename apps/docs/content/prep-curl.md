# cURL examples

These requests use the shared public Zcash testnet preview. Run them one at a time and handle rate-limit/source-recovery responses. Multiline commands use a POSIX shell, such as WSL on Windows. The preview requires no personal token.

## Check coverage and capabilities

```sh
curl --fail-with-body https://zeer.endpx.cloud/api/prep/height
```

```sh
curl --fail-with-body https://zeer.endpx.cloud/api/prep/capabilities
```

Check readiness and coverage before the following ranges. Configuration presence in capabilities is not a live-source readiness guarantee.

## Fetch genesis headers

```sh
curl --fail-with-body https://zeer.endpx.cloud/api/prep/query \
  -H 'Content-Type: application/json' \
  -d '{"from_block":0,"to_block":2,"field_selection":{"block":["height","hash","time"],"transaction":[]}}'
```

The requested heights are 0 and 1 because the end is exclusive. An empty transaction collection is intentional.

## Read public Orchard or Ironwood activity

```sh
curl --fail-with-body https://zeer.endpx.cloud/api/prep/query \
  -H 'Content-Type: application/json' \
  -d '{"from_block":4515166,"to_block":4515167,"field_selection":{"block":["height"],"transaction":["txid","block_height","orchard_action_count","ironwood_action_count"]},"transaction_filter":{"shielded_pools":["orchard","ironwood"]}}'
```

This uses a previously verified modern testnet sample range. Check that the endpoint currently covers it. `shielded_pools` matches either named pool. Counts describe public structures, including possible dummy components; they do not reveal individual payments, receivers or memo text.

## Find a known public transaction

```sh
curl --fail-with-body https://zeer.endpx.cloud/api/prep/query \
  -H 'Content-Type: application/json' \
  -d '{"from_block":1000,"to_block":1001,"field_selection":{"block":["height","time"],"transaction":["txid","block_height","version","size_bytes"]},"transaction_filter":{"txids":["42096f1b0d0ca49f42ca9e3fba73392378f02a9a3235bd361a1253e7ad613192"]}}'
```

The ID and block are a recorded public testnet example, not a generated placeholder. This is an archive query; a missing row does not imply pending status.

## Observe the configured node

```sh
curl --fail-with-body https://zeer.endpx.cloud/api/prep/mempool
```

This optional route returns a bounded node observation, not a complete pending history. It can be empty or unavailable. Read [Transaction lookup & mempool](/docs/prep/transactions/) before interpreting it.

For longer queries, preserve the original request and continue with the returned cursor. See [the cursor contract](/docs/prep/continuation/) and [API access](/docs/prep/tokens/) for protected deployments.
