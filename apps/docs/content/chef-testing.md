# Testing your indexer

## Framework checks

From the repository root:

```sh
npm ci
npm run build:chef
npm run test:chef
```

Database/native integration cases require explicit environment configuration. Skipped cases are not execution evidence.

For the published 0.6.0 release, the [acceptance record](https://github.com/EndPx/zeer/blob/main/docs/CHEF_060_ACCEPTANCE.md) reports 187 Linux SDK tests with no skips, three launcher tests and a separate registry-installed testnet project. Those are recorded release checks, not tests automatically executed by `init` or evidence that every developer's environment is ready.

## Application checks

1. Pin a small source range and target hash.
2. Generate types and typecheck the project.
3. Index into a fresh namespace.
4. Compare complete entity values and checkpoint hashes with independent source data.
5. Restart and verify that committed work is not duplicated.
6. Exercise relevant failure and reorg recovery cases.

Use isolated test databases/namespaces. See the [test suite](https://github.com/EndPx/zeer/tree/main/packages/chef/test) and [shielded example](https://github.com/EndPx/zeer/tree/main/examples/shielded-inbox) for setup.
