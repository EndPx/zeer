# cURL examples

Run one request at a time in a POSIX shell. The public testnet endpoint requires no personal token.

## Coverage and capabilities

```sh
curl --fail-with-body https://zeer.endpx.cloud/api/prep/height
```

```sh
curl --fail-with-body https://zeer.endpx.cloud/api/prep/capabilities
```

## Block headers

```sh
curl --fail-with-body https://zeer.endpx.cloud/api/prep/query \
  -H 'Content-Type: application/json' \
  -d '{"from_block":0,"to_block":2,"field_selection":{"block":["height","hash","time"],"transaction":[]}}'
```

## Orchard or Ironwood activity

```sh
curl --fail-with-body https://zeer.endpx.cloud/api/prep/query \
  -H 'Content-Type: application/json' \
  -d '{"from_block":4515166,"to_block":4515167,"field_selection":{"block":["height"],"transaction":["txid","block_height","orchard_action_count","ironwood_action_count"]},"transaction_filter":{"shielded_pools":["orchard","ironwood"]}}'
```

## Transaction by ID

```sh
curl --fail-with-body https://zeer.endpx.cloud/api/prep/query \
  -H 'Content-Type: application/json' \
  -d '{"from_block":1000,"to_block":1001,"field_selection":{"block":["height","time"],"transaction":["txid","block_height","version","size_bytes"]},"transaction_filter":{"txids":["42096f1b0d0ca49f42ca9e3fba73392378f02a9a3235bd361a1253e7ad613192"]}}'
```

## Mempool observation

```sh
curl --fail-with-body https://zeer.endpx.cloud/api/prep/mempool
```

**Notes:** Check coverage before using sample ranges. Ends are exclusive. Pool counts are public components, not payment counts. The mempool route requires a configured live source. Use the returned cursor for [continuation](/docs/prep/continuation/).
