import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { applyTemplate, validateTemplate } from "./scaffold-templates.js";
import type { StarterTemplate } from "./scaffold-templates.js";
import { ScaffoldError } from "./scaffold-error.js";
import { deploymentFiles } from "./deployment.js";
export { ScaffoldError } from "./scaffold-error.js";

export function validateProjectName(project: string): void {
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(project)) throw new ScaffoldError("INVALID_PROJECT_NAME");
}

export function validateStartHeight(startHeight: number): void {
  if (!Number.isInteger(startHeight) || startHeight < 0 || startHeight > 0xffff_fffe) throw new ScaffoldError("INVALID_START_HEIGHT");
}

/** Creates a new project only. It does not install packages, connect or migrate. */
export async function scaffoldProject(options: { directory: string; project: string; startHeight: number; prepUrl?: string; template?: StarterTemplate }) {
  const { project, startHeight } = options;
  validateProjectName(project);
  validateStartHeight(startHeight);
  const template = options.template ?? "public";
  validateTemplate(template);
  const directory = resolve(options.directory);
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const password = randomBytes(24).toString("hex");
  const token = randomBytes(32).toString("hex");
  const env = (secret: boolean) => `# Full-data Zcash TESTNET Prep endpoint used for this project.
PREP_URL=${options.prepUrl ?? ""}
PREP_API_TOKEN=
# Local development only; use your own DATABASE_URL for an existing Postgres service.
POSTGRES_PASSWORD=${secret ? password : "REPLACE_WITH_RANDOM_PASSWORD"}
DATABASE_URL=postgresql://chef:${secret ? password : "REPLACE_WITH_RANDOM_PASSWORD"}@127.0.0.1:39472/chef
CHEF_API_TOKEN=${secret ? token : "REPLACE_WITH_AT_LEAST_16_RANDOM_BYTES"}
CHEF_URL=http://127.0.0.1:39370
# Container runtime uses its internal postgres host and this database name.
CHEF_DATABASE_NAME=chef
CHEF_UID=1000
CHEF_GID=1000
CHEF_HEALTH_MAX_AGE_SECONDS=60
CHEF_POSTGRES_PORT=39472
CHEF_API_PORT=39370
`;
  const launch = "node --env-file=.env node_modules/@zeer-dev/chef/dist/cli.js";
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: project.replaceAll("_", "-"), private: true, type: "module", engines: { node: ">=24.14.0" },
      scripts: { dev: `${launch} dev`, doctor: `${launch} doctor`, codegen: "zeer-chef codegen", typecheck: "tsc --noEmit", migrate: `${launch} migrate`,
        sync: `${launch} sync`, follow: `${launch} sync --follow`, status: `${launch} status`, serve: `${launch} serve`, query: "node --env-file=.env query.mjs",
        "db:up": "docker compose up -d --wait postgres", "db:stop": "docker compose stop postgres" },
      dependencies: { "@zeer-dev/chef": manifest.version, "@zeer-dev/prep-client": manifest.dependencies["@zeer-dev/prep-client"] },
      devDependencies: { typescript: manifest.devDependencies.typescript, "@types/node": manifest.dependencies["@types/node"] } }, null, 2) + "\n",
    "chef.config.ts": `import { defineConfig } from "@zeer-dev/chef";
import type { ChefEntities } from "./chef.generated.ts";

export default defineConfig<ChefEntities>({
  project: ${JSON.stringify(project)},
  network: "testnet",
  startHeight: ${startHeight},
  schema: "./schema.graphql",
  handlerVersion: "1",
  reorgWindow: 100,
  sync: { pageSize: 1000, batchSize: 32 },
  indexer: {
    async block({ block, context }) {
      await context.entities.set("BlockSummary", {
        id: String(block.height), height: block.height,
        hash: block.hash, time: BigInt(block.time), transactionCount: 0,
      });
    },
    async transactionMetadata({ transaction, context }) {
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
    ports: ["127.0.0.1:\${CHEF_POSTGRES_PORT:-39472}:5432"]
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
const url = new URL(process.env.CHEF_URL ?? "http://127.0.0.1:39370");
if (url.pathname === "/") url.pathname = "/graphql";
const response = await fetch(url, {
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
    "README.md": `# ${project} - standalone Zeer Chef project

Chef runs in your environment; Prep can run at your provider or on your own server.
This starter uses **Zcash testnet public data**. No viewing keys or wallet are needed.
Initialization reads Prep metadata only when latest is selected. It does not
install packages, start Docker or migrate a database. Explicit heights work offline.

## Install

Use Node 24.14+ on Linux x86_64 or WSL2. Install the dependencies declared in package.json:

\`\`\`sh
pnpm install
pnpm run codegen
pnpm run typecheck
\`\`\`

You can use npm instead: replace pnpm with npm in these commands and retain
only your chosen package manager's lockfile. With npm, pass script arguments after
an extra separator: npm run sync -- --to AVAILABLE_HEIGHT. Registry packages must be published
before installation. For an unpublished
candidate or source build, install BOTH local release tarballs together instead;
follow https://github.com/EndPx/zeer/blob/main/docs/PACKAGING.md.
Retain the generated lockfile. Do not use monorepo imports in this project.

## Connect

Edit the git-ignored .env: set PREP_URL to your actual testnet Prep service and
PREP_API_TOKEN if required. It must cover startHeight ${startHeight} continuously.
Inspect the provider's /height endpoint before selecting your start height.
CLI setup records the selected Prep URL in .env; the default is the public
testnet preview. If latest was selected, ${startHeight} is its indexed height
captured during setup, not a value that moves on restart. Use height 0 for history
from genesis, in a new project namespace. The generated local credentials are unique;
never commit .env or place its tokens in frontend code. Copying .env.example requires
replacing its placeholders, not reusing them as real passwords.

For local Postgres with Docker Engine and Compose v2:

\`\`\`sh
pnpm run db:up
\`\`\`

Alternatively, set DATABASE_URL to your own PostgreSQL database (including a
properly configured TLS connection for a remote service). Then skip db:up.
Port 39472 is loopback-only. If occupied, change both compose.yaml and DATABASE_URL.
Use a unique Compose project name when running more than one copy of this starter.

## Index and query

Check the setup, then start a new compatible namespace explicitly:

\`\`\`sh
pnpm run doctor
pnpm run dev --migrate
\`\`\`

Before the first migration, doctor reports MIGRATION_REQUIRED and exits nonzero.
Resolve any other failures before starting. Dev generates types, runs the installed
TypeScript compiler, checks setup, starts the API and then follows Prep in one
terminal. It never installs packages or starts Docker. --migrate uses Chef's safe
migration path; it does not reset incompatible data. On later starts use:

\`\`\`sh
pnpm run dev
\`\`\`

Query in a second terminal while dev runs:

\`\`\`sh
pnpm run query
\`\`\`

The API binds 127.0.0.1:39370. Ctrl+C stops the follower and API; a child failure
stops its peer. Committed progress survives a compatible restart. The API serves
committed data; \`_meta.height\` shows its current coverage. Source reconciliation
may temporarily make reads unavailable. Initial history must already be in Prep.

For separate process management, keep using migrate, sync, follow and serve.
For a finite replay: pnpm run sync --to AVAILABLE_HEIGHT, where the height is
inclusive and covered by Prep. Run either dev, sync or follow for a project,
never multiple writers. Migrate creates the namespace, not the database server.

Lists sort by entity ID, not numeric height. Use \`where: { height: N }\` for a
specific block. query.graphql contains a larger example. The API is read-only:
subscriptions, introspection and private decryption are not implemented.

Stop sync/serve with Ctrl+C; restart resumes the stored checkpoint. Repeating a
completed sync should add zero new blocks. A source gap or mismatch is an error,
not an empty successful history. Schema/config/handler changes require a fresh
project namespace and replay; do not point a changed identity at old state.

\`pnpm run db:stop\` stops only this Compose project's database and retains data.
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
  await applyTemplate(files, template, project, startHeight);
  Object.assign(files, await deploymentFiles(template));
  const generatedManifest = JSON.parse(files["package.json"]!);
  for (const action of ["build", "migrate", "check", "up", "stop", "logs", "status"]) {
    generatedManifest.scripts[`runtime:${action}`] = `node --env-file=.env runtime-control.mjs ${action}`;
  }
  generatedManifest.scripts["db:backup"] = "node --env-file=.env backup.mjs backup";
  generatedManifest.scripts["db:restore"] = "node --env-file=.env backup.mjs restore";
  files["package.json"] = JSON.stringify(generatedManifest, null, 2) + "\n";
  files[".gitignore"] += "backups/\n*.dump\n*.dump.*\n";
  files["README.md"] += "\n## Background runtime and recovery\n\nKeep pnpm-lock.yaml. Run pnpm run runtime:build, then explicitly run\npnpm run runtime:migrate and pnpm run runtime:up. The follower and API run\nas separate containers; runtime:stop retains PostgreSQL and its volume.\nUse runtime:status and runtime:logs to inspect them.\n\nCreate a private backups directory before using db:backup --file NEW_FILE.\nRestore only into a fresh database with db:restore --file FILE --database NEW_DB.\nSwitch database settings only after verifying the restored data. Full commands,\nkey-file ownership and recovery steps: https://zeer.endpx.cloud/docs/chef/self-hosting/.\n";
  try { await mkdir(directory, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new ScaffoldError("PROJECT_DIRECTORY_EXISTS");
    throw new ScaffoldError("PROJECT_DIRECTORY_UNWRITABLE");
  }
  for (const [name, body] of Object.entries(files)) {
    await writeFile(resolve(directory, name), body, { flag: "wx", mode: name === ".env" ? 0o600 : 0o644 });
  }
  return { directory, template, files: Object.keys(files), nextSteps: ["Install the generated project's dependencies (see README.md).", ...(template === "blank" ? ["Define your entities in schema.graphql and implement handlers.ts before indexing."] : template === "shielded" ? ["Install the scanner, inspect your protected local UFVK and configure its paths/fingerprint in .env."] : []), "Set PREP_URL and database settings in .env.", "Run doctor, resolve any failed checks, then use dev --migrate for the first compatible startup; query from a second terminal."] };
}
