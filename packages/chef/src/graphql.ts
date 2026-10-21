import { createServer, type IncomingMessage, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { buildSchema, execute, GraphQLScalarType, Kind, parse, validate, visit, type DocumentNode, type ExecutionResult } from "graphql";
import { decodeEntity, encodeEntity } from "./schema.js";
import { CursorInvalidatedError, QueryInputError, consumptionNames, decodeCursor, encodeCursor, orderedInt, queryShape, validateSelection } from "./consumption.js";
import { StoreNotReadyError } from "./store.js";
import { AdmissionError, RequestAdmission } from "./admission.js";
import type { ChefStore, Model, ReadView, EntityRange, EntityOrder } from "./types.js";

class InputError extends QueryInputError {}
class UnreadyError extends Error {}
const MAX_BODY = 65536;
const MAX_RESPONSE = 2 * 1024 * 1024;
const MAX_DOCUMENTS = 64;
const MAX_DOCUMENT_SOURCE_BYTES = 256 * 1024;

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

function readBody(request: IncomingMessage, signal: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    let size = 0;
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => { cleanup(); request.resume(); reject(new InputError("Request body deadline exceeded")); }, 10000);
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", onCancel); request.off("data", onData); request.off("end", onEnd); request.off("error", onError); request.off("aborted", onAbort); };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) { cleanup(); request.resume(); reject(new InputError("Request exceeds 64 KiB")); return; }
      chunks.push(chunk);
    };
    const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks)); };
    const onError = () => { cleanup(); reject(new InputError("Request interrupted")); };
    const onAbort = onError;
    const onCancel = () => { cleanup(); reject(signal.reason); };
    signal.addEventListener("abort", onCancel, { once: true });
    request.on("data", onData); request.once("end", onEnd); request.once("error", onError); request.once("aborted", onAbort);
    request.resume();
  });
}

export function createChefServer({ store, model, token }: { store: ChefStore; model: Model; token: string }): Server {
  if (typeof token !== "string" || Buffer.byteLength(token) < 16 || Buffer.byteLength(token) > 4096 || /[\r\n]/.test(token)) throw new Error("Chef API token must contain 16 to 4096 bytes without line breaks");
  const names = consumptionNames(model);
  const definition = Object.values(model.entities).map((entity) => {
    const fields = Object.values(entity.fields);
    const ints = fields.filter(f => orderedInt(model, entity.name, f.name));
    const rangeType = ints.length ? `input ${names.entities[entity.name]!.range} { ${ints.map(f=>`${f.name}: ${names.bounds}`).join(" ")} }` : "";
    return `${rangeType}\ninput ${names.entities[entity.name]!.order} { id: ${names.direction} ${ints.map(f=>`${f.name}: ${names.direction}`).join(" ")} }\ntype ${entity.name} { ${fields.map((f) => `${f.name}: ${f.scalar}${f.required ? "!" : ""}`).join(" ")} }\ninput ${entity.name}Filter { ${fields.map((f) => `${f.name}: ${f.scalar}`).join(" ")} }\ntype ${entity.name}Page { items: [${entity.name}!]! nextCursor: ID }`;
  }).join("\n");
  const schema = buildSchema(`scalar BigInt\nenum ${names.direction} { ASC DESC }\ninput ${names.bounds} { gte: Int lte: Int }\n${definition}\ntype ChefCheckpoint { height: Int hash: String anchorHash: String status: String! project: String generation: String revision: String lastCommitAt: String }\ntype Query { _meta: ChefCheckpoint! ${Object.keys(model.entities).map((name) => `${name}ById(id: ID!): ${name} ${name}List(first: Int = 25, after: ID, where: ${name}Filter, ${Object.keys(model.entities[name]!.fields).some(f=>orderedInt(model,name,f)) ? `range: ${names.entities[name]!.range},` : ""} orderBy: [${names.entities[name]!.order}!]): ${name}Page!`).join(" ")} }`);
  const bigint = schema.getType("BigInt") as GraphQLScalarType;
  bigint.coerceOutputValue = bigintValue;
  bigint.coerceInputValue = bigintValue;
  bigint.coerceInputLiteral = (node) => {
    if (node.kind !== Kind.STRING) throw new InputError("BigInt literals must be quoted decimal strings");
    return bigintValue(node.value);
  };
  const root: Record<string, unknown> = Object.create(null);
  root._meta = (_args: unknown, view: ReadView) => ({ ...view.checkpoint, ...(view.consumption ? { project: view.consumption.project, generation: view.consumption.generation, revision: view.consumption.revision, lastCommitAt: view.consumption.lastCommitAt } : {}) });
  for (const [name, entity] of Object.entries(model.entities)) {
    root[`${name}ById`] = async ({ id }: { id: string }, view: ReadView) => {
      const row = await view.get(name, checkedId(id));
      return row === null ? null : decodeEntity(model, name, row);
    };
    root[`${name}List`] = async ({ first = 25, after, where, range, orderBy }: { first?: number; after?: string | null; where?: Record<string, unknown> | null; range?: Record<string, { gte?: number | null; lte?: number | null } | null> | null; orderBy?: Record<string, "ASC" | "DESC" | null>[] | null }, view: ReadView) => {
      if (!Number.isInteger(first) || first < 1 || first > 100) throw new InputError("first must be between 1 and 100");
      if (!view.consumption) throw new StoreNotReadyError("blocked");
      let selectionRange: EntityRange | undefined;
      if (range != null) {
        const entries = Object.entries(range);
        if (entries.length !== 1 || entries[0]![1] === null) throw new InputError("Choose one range field");
        const [field, bounds] = entries[0]!;
        if (bounds!.gte === null || bounds!.lte === null) throw new InputError("Range bounds cannot be null");
        selectionRange = { field, ...bounds! } as EntityRange;
      }
      let order: EntityOrder = { field: "id", direction: "ASC" };
      if (orderBy != null) {
        if (orderBy.length < 1 || orderBy.length > 2 || orderBy.some(o=>Object.keys(o).length !== 1)) throw new InputError("Choose an ordered Int followed by id, or id alone");
        const entries = orderBy.map(o=>Object.entries(o)[0]!);
        const [field, direction] = entries[0]!;
        if (!direction) throw new InputError("Order direction cannot be null");
        order = { field, direction };
        if (entries.length === 2 && (field === "id" || entries[1]![0] !== "id" || entries[1]![1] !== direction)) throw new InputError("id tie-breaker must follow the Int in the same direction");
      }
      validateSelection(model, name, selectionRange, order);
      const normalized: Record<string, unknown> = Object.create(null);
      for (const [field, value] of Object.entries(where ?? {})) {
        try {
          // Validate each equality operand using its actual scalar, without requiring unrelated fields.
          const subset: Model = { fingerprint: model.fingerprint, entities: { [name]: { name, fields: { id: { name: "id", scalar: "ID", required: true }, [field]: entity.fields[field]! } } } };
          normalized[field] = encodeEntity(subset, name, { id: "filter", [field]: value })[field];
        } catch { throw new InputError(`Invalid equality filter: ${field}`); }
      }
      const shape = queryShape({ entity: name, where: normalized, range: selectionRange ?? null, order });
      const position = after == null ? undefined : decodeCursor(token, after, view.consumption, shape);
      if (position && order.field !== "id" && position.value === undefined) throw new CursorInvalidatedError(view.consumption);
      const rows = await view.list(name, { first: first + 1, ...(position ? { position } : {}), where: normalized, range: selectionRange, order });
      const items = rows.slice(0, first).map((row) => decodeEntity(model, name, row));
      const last = rows[first - 1];
      return { items, nextCursor: rows.length > first && last ? encodeCursor(token, view.consumption, shape, { id: last.id, ...(order.field === "id" ? {} : { value: last[order.field] as number }) }) : null };
    };
  }
  const expected = Buffer.from(`Bearer ${token}`);
  // Schema-scoped validated documents only. Bound entries and retained source bytes,
  // not total AST heap; arguments, results and read snapshots remain per request.
  const documents = new Map<string, { document: DocumentNode; bytes: number }>();
  let documentSourceBytes = 0;
  const admission = new RequestAdmission();
  const pending = new Set<AbortController>();
  let closing = false;
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
    const statusRequest = request.url === "/status" && request.method === "GET";
    if (!statusRequest && (request.url !== "/graphql" || request.method !== "POST")) { request.resume(); fail(404, "Use POST /graphql or GET /status"); return; }
    if (!statusRequest && !(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) { request.resume(); fail(400, "Content-Type must be application/json"); return; }
    request.pause();
    const cancellation = new AbortController();
    const cancel = () => cancellation.abort(new Error("Request interrupted"));
    request.once("aborted", cancel);
    response.once("close", cancel);
    let permit: () => void;
    try { permit = await admission.acquire(cancellation.signal); }
    catch (error) {
      request.off("aborted", cancel); response.off("close", cancel);
      if (error instanceof AdmissionError && !cancellation.signal.aborted) {
        response.setHeader("retry-after", "1");
        fail(503, error.message);
        request.resume();
      }
      return;
    }
    pending.add(cancellation);
    // close() can run after a permit is granted but before this continuation.
    if (closing) cancellation.abort(new Error("Server is closing"));
    let released = false;
    let workFinished = false;
    let responseFinished = false;
    const release = () => { if (!released && workFinished && responseFinished) {
      released = true;
      pending.delete(cancellation);
      request.off("aborted", cancel); response.off("close", cancel);
      response.off("finish", finishResponse); response.off("close", finishResponse);
      permit();
    } };
    // Keep capacity until the response buffer has left the server or the peer disconnects.
    const finishResponse = () => { responseFinished = true; release(); };
    response.once("finish", finishResponse); response.once("close", finishResponse);
    if (response.destroyed || response.writableFinished) finishResponse();
    try {
      if (statusRequest) {
        request.resume();
        if (!store.consumptionStatus) { fail(503, "Consumption metadata is unavailable"); return; }
        send(200, await store.consumptionStatus()); return;
      }
      let body: unknown;
      try { body = JSON.parse((await readBody(request, cancellation.signal)).toString("utf8")); } catch (error) { throw error instanceof InputError ? error : new InputError("Invalid JSON body"); }
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new InputError("Expected a GraphQL request object");
      const payload = body as Record<string, unknown>;
      if (Object.keys(payload).some((key) => !["query", "variables", "operationName"].includes(key)) || typeof payload.query !== "string" || (payload.operationName !== undefined && typeof payload.operationName !== "string")) throw new InputError("Invalid GraphQL request fields");
      if (payload.variables !== undefined && (payload.variables === null || typeof payload.variables !== "object" || Array.isArray(payload.variables))) throw new InputError("variables must be an object");
      let document: DocumentNode;
      const cached = documents.get(payload.query);
      if (cached) {
        documents.delete(payload.query);
        documents.set(payload.query, cached);
        document = cached.document;
      } else {
        try { document = parse(payload.query, { maxTokens: 4096 }); } catch { throw new InputError("Invalid GraphQL document"); }
        checkDocument(document);
        if (validate(schema, document).length) throw new InputError("GraphQL query validation failed");
        const bytes = Buffer.byteLength(payload.query);
        while (documents.size && (documents.size >= MAX_DOCUMENTS || documentSourceBytes + bytes > MAX_DOCUMENT_SOURCE_BYTES)) {
          const oldest = documents.keys().next().value!;
          documentSourceBytes -= documents.get(oldest)!.bytes;
          documents.delete(oldest);
        }
        documents.set(payload.query, { document, bytes });
        documentSourceBytes += bytes;
      }
      cancellation.signal.throwIfAborted();
      const result = await store.read(async (view): Promise<ExecutionResult> => {
        cancellation.signal.throwIfAborted();
        if (view.checkpoint.status !== "ready") throw new UnreadyError();
        return await execute({ schema, document, rootValue: root, contextValue: view, variableValues: payload.variables as Record<string, unknown> | undefined, operationName: payload.operationName as string | undefined });
      });
      if (result.errors?.length) {
        const invalidated = result.errors.find(error => error.originalError instanceof CursorInvalidatedError)?.originalError as CursorInvalidatedError | undefined;
        if (invalidated) {
          const { project, generation, revision, checkpoint } = invalidated.current;
          send(409, { errors: [{ message: invalidated.message, extensions: { code: invalidated.code, recovery: "RESTART_WITHOUT_CURSOR", project, generation, revision, checkpoint } }] });
          return;
        }
        if (result.errors.some(error=>error.originalError instanceof StoreNotReadyError)) throw new StoreNotReadyError("blocked");
        if (result.errors.every((error) => !error.path || error.originalError instanceof QueryInputError)) fail(400, "Invalid query arguments");
        else fail(500, "Query execution failed");
      } else send(200, result);
    } catch (error) {
      if (cancellation.signal.aborted) {
        if (!response.destroyed) { response.setHeader("retry-after", "1"); fail(503, "Request interrupted"); request.resume(); }
      }
      else if (error instanceof InputError) fail(400, error.message);
      else if (error instanceof UnreadyError || error instanceof StoreNotReadyError) fail(503, "Indexer is not ready");
      else fail(500, "Query execution failed");
    } finally {
      workFinished = true;
      release();
    }
  });
  const close = server.close.bind(server);
  server.close = (...args: Parameters<Server["close"]>) => {
    closing = true;
    admission.close();
    for (const controller of pending) controller.abort(new Error("Server is closing"));
    return close(...args);
  };
  server.headersTimeout = 10000;
  server.requestTimeout = 15000;
  server.keepAliveTimeout = 5000;
  return server;
}
