import { createServer, type IncomingMessage, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { buildSchema, execute, GraphQLScalarType, Kind, parse, validate, visit, type DocumentNode, type ExecutionResult } from "graphql";
import { decodeEntity, encodeEntity } from "./schema.js";
import { StoreNotReadyError } from "./store.js";
import type { ChefStore, Model, ReadView } from "./types.js";

class InputError extends Error {}
class UnreadyError extends Error {}
const MAX_BODY = 65536;
const MAX_RESPONSE = 2 * 1024 * 1024;

function bigintValue(value: unknown): string {
  const result = typeof value === "bigint" ? value.toString() : value;
  if (typeof result !== "string" || !/^(0|-?[1-9][0-9]{0,127})$/.test(result)) throw new InputError("BigInt must be a canonical decimal string with at most 128 digits");
  return result;
}

function checkedId(value: unknown): string {
  if (typeof value !== "string" || !value.length || value.includes("\0") || Buffer.byteLength(value) > 256) throw new InputError("ID must contain 1 to 256 bytes");
  return value;
}

function checkDocument(document: DocumentNode): void {
  if (document.definitions.length !== 1 || document.definitions[0]?.kind !== Kind.OPERATION_DEFINITION || document.definitions[0].operation !== "query") throw new InputError("Exactly one read-only query is required");
  if (document.definitions[0].selectionSet.selections.length > 5) throw new InputError("At most 5 root fields are allowed");
  if ((document.definitions[0].variableDefinitions?.length ?? 0) > 32) throw new InputError("Too many variables");
  let fields = 0;
  let depth = 0;
  visit(document, {
    Field: { enter(node) { fields++; depth++; if (fields > 100 || depth > 5 || node.name.value.startsWith("__")) throw new InputError("Query exceeds field/depth limits or requests introspection"); }, leave() { depth--; } },
    Directive() { throw new InputError("Directives are unsupported"); },
    FragmentSpread() { throw new InputError("Fragments are unsupported"); },
    InlineFragment() { throw new InputError("Fragments are unsupported"); },
  });
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => { cleanup(); request.resume(); reject(new InputError("Request body deadline exceeded")); }, 10000);
    const cleanup = () => { clearTimeout(timer); request.off("data", onData); request.off("end", onEnd); request.off("error", onError); request.off("aborted", onAbort); };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) { cleanup(); request.resume(); reject(new InputError("Request exceeds 64 KiB")); return; }
      chunks.push(chunk);
    };
    const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks)); };
    const onError = () => { cleanup(); reject(new InputError("Request interrupted")); };
    const onAbort = onError;
    request.on("data", onData); request.once("end", onEnd); request.once("error", onError); request.once("aborted", onAbort);
  });
}

export function createChefServer({ store, model, token }: { store: ChefStore; model: Model; token: string }): Server {
  if (typeof token !== "string" || Buffer.byteLength(token) < 16 || Buffer.byteLength(token) > 4096 || /[\r\n]/.test(token)) throw new Error("Chef API token must contain 16 to 4096 bytes without line breaks");
  const definition = Object.values(model.entities).map((entity) => {
    const fields = Object.values(entity.fields);
    return `type ${entity.name} { ${fields.map((f) => `${f.name}: ${f.scalar}${f.required ? "!" : ""}`).join(" ")} }\ninput ${entity.name}Filter { ${fields.map((f) => `${f.name}: ${f.scalar}`).join(" ")} }\ntype ${entity.name}Page { items: [${entity.name}!]! nextCursor: ID }`;
  }).join("\n");
  const schema = buildSchema(`scalar BigInt\n${definition}\ntype ChefCheckpoint { height: Int hash: String anchorHash: String status: String! }\ntype Query { _meta: ChefCheckpoint! ${Object.keys(model.entities).map((name) => `${name}ById(id: ID!): ${name} ${name}List(first: Int = 25, after: ID, where: ${name}Filter): ${name}Page!`).join(" ")} }`);
  const bigint = schema.getType("BigInt") as GraphQLScalarType;
  bigint.coerceOutputValue = bigintValue;
  bigint.coerceInputValue = bigintValue;
  bigint.coerceInputLiteral = (node) => {
    if (node.kind !== Kind.STRING) throw new InputError("BigInt literals must be quoted decimal strings");
    return bigintValue(node.value);
  };
  const root: Record<string, unknown> = Object.create(null);
  root._meta = (_args: unknown, view: ReadView) => view.checkpoint;
  for (const [name, entity] of Object.entries(model.entities)) {
    root[`${name}ById`] = async ({ id }: { id: string }, view: ReadView) => {
      const row = await view.get(name, checkedId(id));
      return row === null ? null : decodeEntity(model, name, row);
    };
    root[`${name}List`] = async ({ first = 25, after, where }: { first?: number; after?: string | null; where?: Record<string, unknown> | null }, view: ReadView) => {
      if (!Number.isInteger(first) || first < 1 || first > 100) throw new InputError("first must be between 1 and 100");
      if (after !== undefined && after !== null) checkedId(after);
      const normalized: Record<string, unknown> = Object.create(null);
      for (const [field, value] of Object.entries(where ?? {})) {
        try {
          // Validate each equality operand using its actual scalar, without requiring unrelated fields.
          const subset: Model = { fingerprint: model.fingerprint, entities: { [name]: { name, fields: { id: { name: "id", scalar: "ID", required: true }, [field]: entity.fields[field]! } } } };
          normalized[field] = encodeEntity(subset, name, { id: "filter", [field]: value })[field];
        } catch { throw new InputError(`Invalid equality filter: ${field}`); }
      }
      const rows = await view.list(name, { first: first + 1, ...(after == null ? {} : { after }), where: normalized });
      const items = rows.slice(0, first).map((row) => decodeEntity(model, name, row));
      return { items, nextCursor: rows.length > first ? rows[first - 1]!.id : null };
    };
  }
  const expected = Buffer.from(`Bearer ${token}`);
  let active = 0;
  const server = createServer(async (request, response) => {
    const send = (status: number, value: unknown) => {
      if (response.destroyed || response.writableEnded) return;
      let body = JSON.stringify(value);
      if (Buffer.byteLength(body) > MAX_RESPONSE) { status = 400; body = JSON.stringify({ errors: [{ message: "Response exceeds 2 MiB; request fewer fields or rows" }] }); }
      response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      response.end(body);
    };
    const fail = (status: number, message: string) => send(status, { errors: [{ message }] });
    const provided = Buffer.from(request.headers.authorization ?? "");
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) { request.resume(); fail(401, "Unauthorized"); return; }
    if (request.url !== "/graphql" || request.method !== "POST") { request.resume(); fail(404, "Use POST /graphql"); return; }
    if (!(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) { request.resume(); fail(400, "Content-Type must be application/json"); return; }
    if (active >= 2) { request.resume(); fail(503, "Query capacity reached"); return; }
    active++;
    let released = false;
    let workFinished = false;
    let responseFinished = false;
    const release = () => { if (!released && workFinished && responseFinished) { released = true; active--; } };
    // Keep capacity until the response buffer has left the server or the peer disconnects.
    const finishResponse = () => { responseFinished = true; release(); };
    response.once("finish", finishResponse); response.once("close", finishResponse);
    try {
      let body: unknown;
      try { body = JSON.parse((await readBody(request)).toString("utf8")); } catch (error) { throw error instanceof InputError ? error : new InputError("Invalid JSON body"); }
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new InputError("Expected a GraphQL request object");
      const payload = body as Record<string, unknown>;
      if (Object.keys(payload).some((key) => !["query", "variables", "operationName"].includes(key)) || typeof payload.query !== "string" || (payload.operationName !== undefined && typeof payload.operationName !== "string")) throw new InputError("Invalid GraphQL request fields");
      if (payload.variables !== undefined && (payload.variables === null || typeof payload.variables !== "object" || Array.isArray(payload.variables))) throw new InputError("variables must be an object");
      let document: DocumentNode;
      try { document = parse(payload.query, { maxTokens: 4096 }); } catch { throw new InputError("Invalid GraphQL document"); }
      checkDocument(document);
      if (validate(schema, document).length) throw new InputError("GraphQL query validation failed");
      const result = await store.read(async (view): Promise<ExecutionResult> => {
        if (view.checkpoint.status !== "ready") throw new UnreadyError();
        return await execute({ schema, document, rootValue: root, contextValue: view, variableValues: payload.variables as Record<string, unknown> | undefined, operationName: payload.operationName as string | undefined });
      });
      if (result.errors?.length) {
        if (result.errors.every((error) => !error.path || error.originalError instanceof InputError)) fail(400, "Invalid query arguments");
        else fail(500, "Query execution failed");
      } else send(200, result);
    } catch (error) {
      if (error instanceof InputError) fail(400, error.message);
      else if (error instanceof UnreadyError || error instanceof StoreNotReadyError) fail(503, "Indexer is not ready");
      else fail(500, "Query execution failed");
    } finally {
      workFinished = true;
      release();
    }
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 15000;
  server.keepAliveTimeout = 5000;
  return server;
}
