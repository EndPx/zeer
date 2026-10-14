# Public mainnet input oracle

This fixture contains public chain input facts for heights 1 through 2048:
block identities, transaction order and exact integer transaction metadata.
It contains no benchmark timings, rankings, logs or run outcomes.

The data was captured independently through the Chef benchmark preparation
script (`benchmarks/chef/indexing.mjs`). Its source head is recorded in the
compressed document and checked against `mainnet-transactions-v1/manifest.json`.
This is an early-mainnet fixture, not modern shielded coverage or a whole-chain dataset.

The original compressed bytes are preserved. SHA-256:
`fd230e62f1f4909f394c3a2c21f6cc9f0e651bc707bc05e924701a8a82a7cc73`.

The retrieval and batch regression suites use this committed input so a fresh
checkout does not require the operator's local benchmark results.
