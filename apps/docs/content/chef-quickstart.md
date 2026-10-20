# Run your own Chef project

Requirements: Linux x86_64 or WSL2, Node 24.14+, npm and PostgreSQL. Docker is optional for the included local database.

## 1. Prepare the packages

From the Zeer checkout:

```sh
npm ci
mkdir -p .tmp/chef-packages
npm pack ./packages/prep-client --pack-destination .tmp/chef-packages
npm pack ./packages/chef --pack-destination .tmp/chef-packages
```

Record the absolute paths to both tarballs. The packages are currently unpublished.

## 2. Create a project

```sh
node packages/chef/dist/cli.js init \
  --dir /absolute/path/to/my-indexer \
  --project my_indexer \
  --start-height 0
cd /absolute/path/to/my-indexer
npm install /absolute/path/to/zeer-prep-client-0.1.0.tgz /absolute/path/to/zeer-chef-0.1.0.tgz
npm run codegen
npm run typecheck
```

Choose a new directory and project namespace. Init creates the config, schema, handlers, environment file and example queries.

## 3. Configure the source and database

Edit the generated `.env`:

```sh
PREP_URL=https://zeer.endpx.cloud/api/prep
PREP_API_TOKEN=
```

Set `DATABASE_URL` to your database. For the included local PostgreSQL configuration:

```sh
npm run db:up
```

With either database option, initialize the project namespace and check its status:

```sh
npm run migrate
npm run status
```

## 4. Index and query

Run these in separate terminals:

```sh
# Terminal 1
npm run serve

# Terminal 2: inclusive end
npm run sync -- --to 1

# Terminal 3
npm run query
```

Use `npm run follow` to continue with new blocks. Restarting the same compatible project resumes its checkpoint.

**Notes:** Check Prep coverage before syncing. Keep tokens private. Use a fresh namespace for [schema or handler changes](/docs/chef/evolution/). The [full starter guide](https://github.com/EndPx/zeer/blob/main/docs/CHEF_QUICKSTART.md) includes database ports and setup details.
