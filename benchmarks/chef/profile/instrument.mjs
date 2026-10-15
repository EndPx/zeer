import { readFile, writeFile, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Instrument a disposable built-module copy, never the public server or its API.
// Exact one-match replacements deliberately fail closed when implementation drifts.
export function instrument(source) {
  const replace = (needle, replacement) => {
    if (source.split(needle).length !== 2) throw new Error(`PROFILE_SOURCE_MISMATCH:${needle.slice(0, 70)}`);
    source = source.replace(needle, replacement);
  };
  replace('const server = createServer(async (request, response) => {', 'const server = createServer(async (request, response) => {\n const __profile = {}; const __started = performance.now();');
  replace('let body = JSON.stringify(value);', 'let body = __time(__profile, "serializeMs", () => JSON.stringify(value));');
  replace('document = parse(payload.query, { maxTokens: 4096 });', 'document = __time(__profile, "parseMs", () => parse(payload.query, { maxTokens: 4096 }));');
  replace('checkDocument(document);', '__time(__profile, "limitsMs", () => checkDocument(document));');
  replace('validate(schema, document).length', '__time(__profile, "validateMs", () => validate(schema, document)).length');
  replace('const result = await store.read(async (view) => {', 'const result = await __timeAsync(__profile, "readMs", () => store.read(async (view) => {');
  const execution = /return await execute\(\{ schema, document, rootValue: root, contextValue: view, variableValues: payload.variables, operationName: payload.operationName \}\);\s*\}\);/g;
  if ([...source.matchAll(execution)].length !== 1) throw new Error('PROFILE_EXECUTE_SOURCE_MISMATCH');
  source = source.replace(execution, 'return await __timeAsync(__profile, "executeMs", () => execute({ schema, document, rootValue: root, contextValue: view, variableValues: payload.variables, operationName: payload.operationName }));\n }));');
  replace('workFinished = true;', 'workFinished = true;\n __profile.handlerMs = performance.now() - __started; __profile.readEnvelopeMs = (__profile.readMs ?? 0) - (__profile.executeMs ?? 0); __chefProfileSamples.push(__profile);');
  return `export const __chefProfileSamples = [];
function __time(profile, key, fn) { const start = performance.now(); try { return fn(); } finally { profile[key] = (profile[key] ?? 0) + performance.now() - start; } }
async function __timeAsync(profile, key, fn) { const start = performance.now(); try { return await fn(); } finally { profile[key] = (profile[key] ?? 0) + performance.now() - start; } }
${source}`;
}

export async function loadProfileModule(path) {
  path = resolve(path);
  const original = await readFile(path, 'utf8');
  // Adjacent ignored dist file preserves all relative schema/store imports.
  const temporary = join(dirname(path), `graphql.profile-${randomUUID()}.mjs`);
  await writeFile(temporary, instrument(original), { flag: 'wx' });
  try { return { module: await import(pathToFileURL(temporary).href), sourceSha256: createHash('sha256').update(original).digest('hex') }; }
  finally { await unlink(temporary); }
}
