# Protocol provenance

`service.proto` and `compact_formats.proto` are copied without modification from
`zcash/lightwalletd` commit `d16d48124e9ad4157ebc2324b5090c6ba201470c`,
vendored `lightwallet-protocol/walletrpc` tree
`009f94a54f6aab1a6fc549dbd2e1c44a00e6547c`. The upstream MIT notice is in
`LICENSE.lightwallet-protocol`. Their copies in the older benchmark harness
remain historical fixture dependencies; production crates do not import the harness.

`prep.proto` is original experimental Zeer code. It serves immutable historical
snapshots, not the complete lightwalletd wallet API. Upstream server bindings
are generated to test importer failure handling; the Prep executable serves
only the separate `zeer.prep.v1.Prep` service.
