import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export class ScaffoldError extends Error {
  constructor(readonly code: string) { super(code); }
}

/** Creates a new project only. It does not install packages, connect or migrate. */
export async function scaffoldProject(options: { directory: string; project: string; startHeight: number }) {
  const { project, startHeight } = options;
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(project)) throw new ScaffoldError("INVALID_PROJECT_NAME");
  if (!Number.isInteger(startHeight) || startHeight < 0 || startHeight > 0xffff_fffe) throw new ScaffoldError("INVALID_START_HEIGHT");
  const directory = resolve(options.directory);
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const password = randomBytes(24).toString("hex");
  const token = randomBytes(32).toString("hex");
  const env = (secret: boolean) => `# Select an actual full-data Zcash TESTNET Prep endpoint. No hosted endpoint is assumed.
PREP_URL=
PREP_API_TOKEN=
# Local development only; use your own DATABASE_URL for an existing Postgres service.
POSTGRES_PASSWORD=${secret ? password : "REPLACE_WITH_RANDOM_PASSWORD"}
DATABASE_URL=postgresql://chef:${secret ? password : "REPLACE_WITH_RANDOM_PASSWORD"}@127.0.0.1:39472/chef
CHEF_API_TOKEN=${secret ? token : "REPLACE_WITH_AT_LEAST_16_RANDOM_BYTES"}
`;
  const launch = "node --env-file=.env node_modules/@zeer/chef/dist/cli.js";
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: project.replaceAll("_", "-"), private: true, type: "module", engines: { node: ">=24.14.0" },
      scripts: { codegen: "zeer-chef codegen", typecheck: "tsc --noEmit", migrate: `${launch} migrate`,
        sync: `${launch} sync`, follow: `${launch} sync --follow`, status: `${launch} status`, serve: `${launch} serve`, query: "node --env-file=.env query.mjs",
        "db:up": "docker compose up -d --wait postgres", "db:stop": "docker compose stop postgres" },
      dependencies: { "@zeer/chef": manifest.version, "@zeer/prep-client": manifest.dependencies["@zeer/prep-client"] },
      devDependencies: { typescript: manifest.devDependencies.typescript } }, null, 2) + "\n",
    "chef.config.ts": `import { defineConfig } from "@zeer/chef";
import type { ChefEntities } from "./chef.generated.ts";

export default defineConfig<ChefEntities>({
  project: ${JSON.stringify(project)},
  network: "testnet",
  startHeight: ${startHeight},
  schema: "./schema.graphql",
  handlerVersion: "1",
  reorgWindow: 100,
  indexer: {
    async block({ block, context }) {
      await context.entities.set("BlockSummary", {
        id: String(block.height), height: block.height,
        hash: block.hash, time: BigInt(block.time), transactionCount: 0,
      });
    },
    async transaction({ transaction, context }) {
      const id = String(transaction.blockHeight);
      const summary = await context.entities.get("BlockSummary", id);
      if (!summary) throw new Error("Block summary must exist before transactions");
      await context.entities.set("BlockSummary", { ...summary, transactionCount: summary.transactionCount + 1 });
    },
  },
});
`,
    "schema.graphql": "type BlockSummary {\n  id: ID!\n  height: Int! @index\n  hash: String!\n  time: BigInt!\n  transactionCount: Int!\n}\n",
    "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, allowImportingTsExtensions: true, skipLibCheck: false, types: ["node"] }, include: ["*.ts"] }, null, 2) + "\n",
    ".env": env(true),
    ".env.example": env(false),
    ".gitignore": ".env\n.env.*\n!.env.example\nnode_modules/\nchef.generated.ts\n*.log\n",
    "compose.yaml": `name: ${project.replaceAll("_", "-")}-chef
services:
  postgres:
    image: postgres@sha256:ceef4a62198b562d6fe3e51be67362f72a0abf0aaa255f54f0c0e55be9768ed2
    environment:
      POSTGRES_USER: chef
      POSTGRES_DB: chef
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}
    ports: ["127.0.0.1:39472:5432"]
    volumes: [postgres:/var/lib/postgresql/data]
    cpus: 0.5
    mem_limit: 512m
    memswap_limit: 512m
    pids_limit: 128
    healthcheck:
      test: [CMD-SHELL, pg_isready -U chef -d chef]
      interval: 2s
      timeout: 3s
      retries: 20
volumes:
  postgres:
`,
    "query.graphql": "query {\n  BlockSummaryList(first: 10) {\n    items { id height hash time transactionCount }\n    nextCursor\n  }\n  _meta { height hash status }\n}\n",
    "query.mjs": `import { readFile } from "node:fs/promises";
const token = process.env.CHEF_API_TOKEN;
if (!token) throw new Error("Set CHEF_API_TOKEN in .env");
const query = await readFile(new URL("./query.graphql", import.meta.url), "utf8");
const response = await fetch(process.env.CHEF_URL ?? "http://127.0.0.1:39370/graphql", {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
  headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
  body: JSON.stringify({ query }),
});
const result = await response.json();
if (!response.ok || result.errors) {
  console.error("GraphQL query failed (HTTP " + response.status + "). Check Chef status and the query.");
  process.exitCode = 1;
} else console.log(JSON.stringify(result, null, 2));
`,
    "README.md": `# ${project} — standalone Zeer Chef project

Chef runs in your environment; Prep can run at your provider or on your own server.
This starter uses **Zcash testnet public data**. No viewing keys or wallet are needed.
Initialization does not contact Prep/Postgres, install packages, start Docker or migrate a database.

## Install

Use Node 24.14+ on Linux x86_64 or WSL2. Packages are currently unpublished.
Install BOTH versioned release tarballs together (replace paths):

\`\`\`sh
npm install /absolute/path/zeer-prep-client-${manifest.dependencies["@zeer/prep-client"]}.tgz /absolute/path/zeer-chef-${manifest.version}.tgz
npm run codegen
npm run typecheck
\`\`\`

If producing the tarballs yourself, follow https://github.com/EndPx/zeer/blob/main/docs/PACKAGING.md.
Do not rely on public npm availability or monorepo imports. Retain the generated lockfile.

## Connect

Edit the git-ignored .env: set PREP_URL to your actual testnet Prep service and
PREP_API_TOKEN if required. It must cover startHeight ${startHeight} continuously.
Inspect the provider's /height endpoint before selecting your start height.
There is no default hosted Zeer endpoint. The generated local credentials are unique;
never commit .env or place its tokens in frontend code. Copying .env.example requires
replacing its placeholders, not reusing them as real passwords.

For local Postgres with Docker Engine and Compose v2:

\`\`\`sh
npm run db:up
\`\`\`

Alternatively, set DATABASE_URL to your own PostgreSQL database (including a
properly configured TLS connection for a remote service). Then skip db:up.
Port 39472 is loopback-only. If occupied, change both compose.yaml and DATABASE_URL.
Use a unique Compose project name when running more than one copy of this starter.

## Index and query

\`\`\`sh
npm run migrate
npm run status
npm run sync
npm run serve
\`\`\`

Migrate creates this project's namespace explicitly; it does not create the server/database.
Sync captures Prep's currently indexed height. For a bounded first run:
\`npm run sync -- --to AVAILABLE_HEIGHT\` (inclusive). For continuous indexing,
run \`npm run follow\` in another terminal alongside serve. Initial history must
already be present in Prep. HTTP availability alone does not establish source readiness.

The API binds 127.0.0.1:39370. From a separate terminal:

\`\`\`sh
npm run query
\`\`\`

Lists sort by entity ID, not numeric height. Use \`where: { height: N }\` for a
specific block. query.graphql contains a larger example. The API is read-only:
subscriptions, introspection and private decryption are not implemented.

Stop sync/serve with Ctrl+C; restart resumes the stored checkpoint. Repeating a
completed sync should add zero new blocks. A source gap or mismatch is an error,
not an empty successful history. Schema/config/handler changes require a fresh
project namespace and replay; do not point a changed identity at old state.

\`npm run db:stop\` stops only this Compose project's database and retains data.
Do not run Docker prune or delete a populated volume as an onboarding step.

## Troubleshooting

- PREP_URL_AND_DATABASE_URL_REQUIRED: set the actual endpoint and database URL in .env.
- SOURCE_NETWORK_OR_KIND_MISMATCH: use a full-data testnet Prep archive.
- SOURCE_HISTORY_UNAVAILABLE: ensure Prep covers the configured startHeight.
- MIGRATION_REQUIRED: run npm run migrate with the same config/database.
- PROJECT_IDENTITY_MISMATCH: preserve the old project; create a new namespace for replay.
- CHEF_COMMAND_FAILED: inspect connectivity, credentials and PostgreSQL availability;
  errors intentionally omit third-party text that could contain secrets.

Codegen and strict typechecking are both needed: Node type stripping does not typecheck handlers.
`,
  };
  try { await mkdir(directory, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new ScaffoldError("PROJECT_DIRECTORY_EXISTS");
    throw new ScaffoldError("PROJECT_DIRECTORY_UNWRITABLE");
  }
  for (const [name, body] of Object.entries(files)) {
    await writeFile(resolve(directory, name), body, { flag: "wx", mode: name === ".env" ? 0o600 : 0o644 });
  }
  return { directory, files: Object.keys(files), nextSteps: ["Install the two local release tarballs together (see README.md).", "Set PREP_URL and database settings in .env.", "Run codegen, typecheck, migrate, sync, then serve."] };
}
