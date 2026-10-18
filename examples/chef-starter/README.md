# Standalone Chef acceptance

Use [Run your own Chef project](../../docs/CHEF_QUICKSTART.md) for the developer
workflow. `zeer-chef init` generates the application; this folder contains its
installed-package integration verifier rather than a second handwritten template.

## Reproduce the integration check

On Linux x86_64 / WSL2, prepare the two version 0.1.0 tarballs with
`examples/package-consumer/verify.mjs`. Provide a disposable Postgres database,
a protected full-data testnet Prep archive covering 1000–1002, and an independently
captured fixture JSON:

```text
{ network: "testnet", blocks: [{ height, hash, decoded: { time, tx: [...] } }, ...] }
```

Preserve source JSON types and record capture provenance; do not construct expected
results from Chef output. Set PREP_URL, PREP_API_TOKEN and DATABASE_URL through the
environment. The verifier generates its own GraphQL token in the new project.

```sh
node examples/chef-starter/verify.mjs \
  --artifacts /absolute/path/to/package-artifacts \
  --fixture /absolute/path/to/captured-testnet-blocks.json \
  --output benchmarks/results/starter-unique-run \
  --port 39473
```

The output directory must be new. The verifier installs real package tarballs,
executes init, checks the generated schema/types, explicitly migrates a unique
database namespace, syncs one block, queries GraphQL, stops the server, resumes
two more blocks and queries again. It also exercises the generated query command,
checks unauthorized requests and repeats sync to prove no additional block commits.

It stops its own GraphQL child; it does not stop externally supplied Prep or
Postgres, drop schemas, or delete the consumer. A successful run writes
acceptance.json; other output is not a pass. Files remain under ignored local
results. This is historical public testnet replay, not whole-chain benchmarking.
