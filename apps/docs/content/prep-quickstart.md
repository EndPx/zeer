# Your first Prep query

This guide retrieves actual testnet block headers. You need `curl` and access to the public preview or a compatible Prep endpoint. No wallet or viewing key is needed.

## 1. Check coverage

```sh
curl --fail-with-body https://zeer.endpx.cloud/api/prep/height
```

Check `ready`, `start_block` and `indexed_height`. The next request needs coverage for blocks 0 and 1. If the service is unavailable, wait for recovery; do not treat an error as an empty successful result.

## 2. Request genesis headers

```sh
curl --fail-with-body https://zeer.endpx.cloud/api/prep/query \
  -H 'Content-Type: application/json' \
  -d '{"from_block":0,"to_block":2,"field_selection":{"block":["height","hash","time"],"transaction":[]}}'
```

`from_block` is inclusive and `to_block` is exclusive, so the requested block heights are 0 and 1. `transaction: []` suppresses transaction records. Find the returned headers in `data.blocks` and inspect `cursor` to determine whether continuation remains.

## 3. Select a public transaction filter

```sh
curl --fail-with-body https://zeer.endpx.cloud/api/prep/query \
  -H 'Content-Type: application/json' \
  -d '{"from_block":0,"field_selection":{"block":[],"transaction":["txid","block_height","version"]},"transaction_filter":{"has_orchard":true}}'
```

This asks for transactions with public Orchard activity, beginning at genesis. It omits the end and scan-size option. Prep captures an available end for the scan and bounds each response automatically.

An early-history response can contain no matching transactions and still have more history to scan. Read the returned progress and continue with its cursor. For a populated example without scanning early history interactively, use **Use verified testnet sample** in the [playground](https://zeer.endpx.cloud/app/prep); the sample fills inputs and still requires **Run query**.

## Continue building

- [Finish a historical scan](/docs/prep/continuation/).
- [Choose fields and filters](/docs/prep/fields/).
- [Review the full request contract](/docs/prep/query/).
- For TypeScript, follow the [package installation instructions](https://github.com/EndPx/zeer/blob/main/docs/PACKAGING.md) before importing `@zeer/prep-client`.
