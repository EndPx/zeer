# Testing your indexer

## Framework checks

From the repository root:

```sh
npm ci
npm run build:chef
npm run test:chef
```

Database/native integration cases require explicit environment configuration. Skipped cases are not execution evidence.

## Application checks

1. Pin a small source range and target hash.
2. Generate types and typecheck the project.
3. Index into a fresh namespace.
4. Compare complete entity values and checkpoint hashes with independent source data.
5. Restart and verify that committed work is not duplicated.
6. Exercise relevant failure and reorg recovery cases.

Use isolated test databases/namespaces. See the [test suite](https://github.com/EndPx/zeer/tree/main/packages/chef/test) and [shielded example](https://github.com/EndPx/zeer/tree/main/examples/shielded-inbox) for setup.
