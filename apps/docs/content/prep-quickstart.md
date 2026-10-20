# Your first Prep query

Run these commands in a POSIX shell, such as WSL on Windows.

## 1. Check coverage

```sh
curl --fail-with-body https://zeer.endpx.cloud/api/prep/height
```

Check `ready`, `start_block` and `indexed_height`. The next request needs blocks 0 and 1.

## 2. Fetch block headers

```sh
curl --fail-with-body https://zeer.endpx.cloud/api/prep/query \
  -H 'Content-Type: application/json' \
  -d '{"from_block":0,"to_block":2,"field_selection":{"block":["height","hash","time"],"transaction":[]}}'
```

Read the headers from `data.blocks`. `to_block` is exclusive, so this requests heights 0 and 1. `transaction: []` omits transaction records.

**Notes:** A non-null `cursor` means more of the requested range remains. See [continuation](/docs/prep/continuation/) or [cURL examples](/docs/prep/curl/) for other requests.
