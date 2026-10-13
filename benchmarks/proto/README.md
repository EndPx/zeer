# Protocol provenance

`compact_formats.proto` and `service.proto` are vendored unchanged from
`zcash/lightwalletd` commit `d16d48124e9ad4157ebc2324b5090c6ba201470c`, directory
`lightwallet-protocol/walletrpc/` (vendored tree `009f94a54f6aab1a6fc549dbd2e1c44a00e6547c`).
See `LICENSE.lightwallet-protocol` for the upstream MIT notice.
`darkside.proto` is from that lightwalletd commit's `walletrpc/` directory;
see `LICENSE.lightwalletd`. No darkside source simulation is used by the first
real-regtest serving experiment.

Generate Python bindings into an ignored runtime directory using the pinned
`benchmarks/requirements-grpc.txt`; do not commit generated Python files.

```sh
python -m grpc_tools.protoc -I benchmarks/proto \
  --python_out=/generated --grpc_python_out=/generated \
  benchmarks/proto/compact_formats.proto benchmarks/proto/service.proto
```
