# Zeer CLI

Create a Zeer Chef project without a global installation:

```sh
pnpx @zeer-dev/cli init
```

Choose **Blank project**, **Public chain indexer** or **Shielded payment inbox**.
Requires Node 24.14+. `pnpm dlx @zeer-dev/cli init` is equivalent; npm users can run
`npx @zeer-dev/cli@latest init`.

The `@zeer-dev/cli` package is a small entry point to the matching published
`@zeer-dev/chef` version. It uses Chef's actual wizard, signal handling and error
reporting. It does not maintain a separate scaffold or download a viewing key.
Each release pins its Chef dependency; publish both together when Chef changes.

`pnpx @zeer-dev/cli@latest init` explicitly requests the npm `latest` tag. pnpm may reuse
its dlx cache. On pnpm 10+, a fresh dlx resolution can be requested with:

```sh
pnpx --config.dlx-cache-max-age=0 @zeer-dev/cli@latest init
```

Keep an exact version for reproducible automation:

```sh
pnpx @zeer-dev/cli@0.3.0 init --template public --dir my-indexer --project my_indexer --start-height latest --json
```

Generated projects pin their SDK version and retain their own lockfile. Running
a newer launcher does not upgrade an existing project. Init creates files;
install the generated dependencies and follow its README to configure your
database and run the indexer. Shielded keys remain in protected local files.

[Quickstart](https://zeer.endpx.cloud/docs/chef/quickstart/) ·
[CLI reference](https://zeer.endpx.cloud/docs/chef/cli-commands/)
