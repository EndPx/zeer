import { readFile } from "node:fs/promises";
import { ScaffoldError } from "./scaffold-error.js";

export type StarterTemplate = "blank" | "public" | "shielded";
export function validateTemplate(value: string): asserts value is StarterTemplate {
  if (!["blank", "public", "shielded"].includes(value)) throw new ScaffoldError("INVALID_INIT_TEMPLATE");
}

export async function applyTemplate(files: Record<string, string>, template: StarterTemplate, project: string, startHeight: number): Promise<void> {
  if (template === "public") return;
  if (template === "blank") {
    files["schema.graphql"] = "# Define your entities here. Each entity needs id: ID!.\n# Then run pnpm run codegen and implement handlers in handlers.ts.\n";
    files["handlers.ts"] = 'import { defineIndexer } from "@zeer-dev/chef";\n\n// Add handlers for your own model before indexing.\nexport default defineIndexer({});\n';
    files["chef.config.ts"] = `import { defineConfig } from "@zeer-dev/chef";
import indexer from "./handlers.ts";

export default defineConfig({
  project: ${JSON.stringify(project)}, network: "testnet", startHeight: ${startHeight},
  schema: "./schema.graphql", handlerVersion: "1", reorgWindow: 100,
  sync: { pageSize: 16, batchSize: 1 }, indexer,
});
`;
    files["query.graphql"] = "query { _meta { height hash status } }\n";
    files["README.md"] = `# ${project}

A blank Zeer Chef project on Zcash testnet. It contains no sample entities or
application handlers. Init creates files and local development credentials only.

## Define your model

Use Node 24.14+ and install with \`pnpm install\`. \`pnpm run typecheck\` works
before defining a model. Add entity types to schema.graphql, each with id: ID!,
then run \`pnpm run codegen\`. Import ChefEntities from chef.generated.ts in
handlers.ts and use \`defineIndexer<ChefEntities>\` for typed handlers. Implement
at least one block or transaction handler before running the indexer. Empty
schemas and empty indexers produce explicit setup guidance; they do not index
or initialize a database silently.

## Connect and run

Your selected Prep URL and start height ${startHeight} are recorded in .env and
chef.config.ts. Keep .env private. Configure your own PostgreSQL DATABASE_URL,
or run \`pnpm run db:up\` for the loopback Docker Compose service. Its port 39472
must be free; change both compose.yaml and DATABASE_URL if needed.

After defining the model and handlers, run codegen, typecheck and migrate.
Run \`pnpm run follow\` and \`pnpm run serve\` in separate terminals. Customize
query.graphql and run \`pnpm run query\`. Ctrl+C stops each process; compatible
restarts resume the checkpoint. Model/handler changes require explicit project
evolution. \`pnpm run db:stop\` retains the database volume.

Use npm instead of pnpm if preferred; forward arguments with npm run SCRIPT --.
Keep the generated lockfile. No services start during init.

See https://zeer.endpx.cloud/docs/chef/schema/ and
https://zeer.endpx.cloud/docs/chef/handlers/.
`;
    return;
  }
  const assetNames = ["schema.graphql", "consumer.mjs", "consume.mjs", "query.mjs", "query.graphql", "read-transaction.mjs", "install-scanner.mjs", "CONSUMER.md", "LICENSE"];
  for (const name of assetNames) files[name] = await readFile(new URL(`../templates/shielded/${name}`, import.meta.url), "utf8");
  const manifest = JSON.parse(files["package.json"]!);
  manifest.scripts["scanner:install"] = "node install-scanner.mjs";
  manifest.scripts.consume = "node --env-file=.env consume.mjs";
  manifest.scripts["read:transaction"] = "node --env-file=.env read-transaction.mjs";
  files["package.json"] = JSON.stringify(manifest, null, 2) + "\n";
  const local = `ZEER_PROJECT=${project}
ZEER_BIRTHDAY_HEIGHT=${startHeight}
ZEER_ACCOUNT_ID=inbox
ZEER_KEY_FINGERPRINT=
ZEER_SCANNER_EXECUTABLE=
ZEER_VIEWING_KEY_FILE=
`;
  files[".env"] += local; files[".env.example"] += local;
  files[".gitignore"] += "private/\n";
  files["chef.config.ts"] = `import { defineConfig } from "@zeer-dev/chef";
import indexer from "./handlers.ts";

export default defineConfig({
  project: ${JSON.stringify(project)}, network: "testnet", startHeight: ${startHeight},
  schema: "./schema.graphql", handlerVersion: "shielded-inbox-v1", reorgWindow: 100,
  shielded: { accountId: process.env.ZEER_ACCOUNT_ID ?? "inbox", keyFingerprint: process.env.ZEER_KEY_FINGERPRINT ?? "" },
  sync: { pageSize: 16, batchSize: 1, transactionFilter: { shielded_pools: ["sapling", "orchard", "ironwood"] } },
  indexer,
});
`;
  files["handlers.ts"] = `import { defineIndexer, decodeMemo } from "@zeer-dev/chef";
import type { ChefEntities } from "./chef.generated.ts";

export default defineIndexer<ChefEntities>({
  async receipt({ block, receipt, context }) {
    await context.entities.set("ReadableNote", {
      id: receipt.id, txid: receipt.txid, pool: receipt.pool, outputIndex: receipt.output_index,
      blockHeight: block.height, blockHash: block.hash, valueZat: BigInt(receipt.value_zat),
      receiver: receipt.receiver, memoHex: receipt.memo_hex, ...decodeMemo(receipt.memo_hex),
      scope: receipt.scope, origin: receipt.origin, coinbase: receipt.is_coinbase,
    });
  },
});
`;
  // Codegen loads the config, including the local identity from .env.
  manifest.scripts.codegen = "node --env-file=.env node_modules/@zeer-dev/chef/dist/cli.js codegen";
  files["package.json"] = JSON.stringify(manifest, null, 2) + "\n";
  files["README.md"] = `# ${project} — shielded payment inbox

A local Zcash testnet inbox with typed ReadableNote entities, exact zatoshi
values, receiver components, memo decoding and a restartable SQLite consumer.
UFVKs and decrypted data stay in your environment. Prep receives public chain
queries only. Scope does not prove sender identity; origin remains unknown.

## Install

Use Node 24.14+, pnpm and PostgreSQL. Run \`pnpm install --ignore-scripts\`, then
\`pnpm run scanner:install\`. The versioned scanner is tested for Linux/WSL2 x64
with glibc. Its installer verifies the pinned binary digest before keyless
execution. Other platforms retain the documented source-build path.

## Configure your local key

Keep a testnet UFVK in a protected file outside the project (mode 0400 or 0600).
Never supply a seed or spending key. Set ZEER_SCANNER_EXECUTABLE in .env to the
absolute executable path returned by installation. Run that executable with
\`inspect-key --account inbox --key-file /protected/testnet.ufvk\`, then set
ZEER_VIEWING_KEY_FILE and ZEER_KEY_FINGERPRINT in .env. Do not paste key contents
into a command, chat, public API or source file. No key is loaded during init.

The project starts at the explicit wallet birthday ${startHeight}. Starting later
misses earlier notes; starting at genesis replays unnecessary history. Use your
PostgreSQL DATABASE_URL or \`pnpm run db:up\` for the local Docker Compose service.
Keep .env private; retain the generated lockfile. Model, birthday and key identity
changes require a fresh project namespace or explicit supported evolution.

## Follow, query and consume

Run \`pnpm run codegen\`, \`pnpm run typecheck\`, then \`pnpm run migrate\`.
Run \`pnpm run follow\` and \`pnpm run serve\` in separate terminals.
\`pnpm run query\` reads indexed memos from the private API. A raw transaction read
is available through \`pnpm run read:transaction TX_ID\` (replace TX_ID with the
transaction's lowercase 64-character ID).

Start the consumer in another terminal:

\`\`\`sh
pnpm run consume --mode continuous --follow --db private/inbox.sqlite \\
  --project ${project} --from ${startHeight} --window-blocks 200 --page-size 100
\`\`\`

Repeat the command to resume. CONSUMER.md explains mutable-tail reconciliation,
freshness, storage budgets and explicit recovery errors. It contains reference
checkout instructions; use this generated project's scripts for setup.

These are note observations, not a spendable balance or settlement permission.
Applications must validate their own order, receiver, amount, confirmations and
canonicality before deciding on external actions. No payout or signing code is
included. Use npm run SCRIPT -- for forwarded arguments if using npm.

See https://zeer.endpx.cloud/docs/chef/shielded/local/.
`;
}
