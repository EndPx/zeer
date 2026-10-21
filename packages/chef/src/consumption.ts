import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { ConsumptionStatus, EntityOrder, EntityRange, Model } from "./types.js";

export class QueryInputError extends Error {}
export class CursorInvalidatedError extends Error {
  readonly code = "CURSOR_INVALIDATED";
  constructor(readonly current: ConsumptionStatus) { super("Cursor is incompatible with this query or data revision; restart without after"); }
}
/** Keep every previously valid entity name available during an additive upgrade. */
export function consumptionNames(model: Model): { direction: string; bounds: string; entities: Record<string, { range: string; order: string }> } {
  const used = new Set(["Query", "ChefCheckpoint", "BigInt", "ID", "String", "Boolean", "Int",
    ...Object.keys(model.entities).flatMap(name => [name, `${name}Filter`, `${name}Page`])]);
  const allocate = (base: string): string => {
    let name = base, suffix = 0;
    while (used.has(name)) name = `${base}_${++suffix}`;
    used.add(name); return name;
  };
  return { direction: allocate("ChefOrderDirection"), bounds: allocate("ChefIntRange"),
    entities: Object.fromEntries(Object.keys(model.entities).sort().map(name => [name, { range: allocate(`${name}Range`), order: allocate(`${name}Order`) }])) };
}
export function orderedInt(model: Model, entity: string, field: string): boolean {
  const definition = model.entities[entity]?.fields[field];
  return !!definition && definition.scalar === "Int" && definition.required && definition.indexed === true;
}
export function validateSelection(model: Model, entity: string, range?: EntityRange, order?: EntityOrder): void {
  const int = (value: unknown) => Number.isInteger(value) && Number(value) >= -2147483648 && Number(value) <= 2147483647;
  if (range && (!orderedInt(model, entity, range.field) || (range.gte === undefined && range.lte === undefined)
    || (range.gte !== undefined && !int(range.gte)) || (range.lte !== undefined && !int(range.lte))
    || (range.gte !== undefined && range.lte !== undefined && range.gte > range.lte))) throw new QueryInputError("Range needs an indexed required Int and valid gte/lte bounds");
  if (order && ((!orderedInt(model, entity, order.field) && order.field !== "id") || !["ASC", "DESC"].includes(order.direction))) throw new QueryInputError("Order needs id or an indexed required Int");
  if (range && order && order.field !== range.field && order.field !== "id") throw new QueryInputError("Range and ordered Int must use the same field");
}
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,stable(v)])) : value;
export const queryShape = (value: unknown): string => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
const identity = (state: ConsumptionStatus) => [state.project, state.generation, state.revision, state.checkpoint.height, state.checkpoint.hash];
type Position = { id: string; value?: number };
export function encodeCursor(token: string, state: ConsumptionStatus, shape: string, position: Position): string {
  const body = Buffer.from(JSON.stringify({ v: 1, identity: identity(state), shape, position })).toString("base64url");
  return `${body}.${createHmac("sha256", token).update(body).digest("base64url")}`;
}
export function decodeCursor(token: string, cursor: string, state: ConsumptionStatus, shape: string): Position {
  const invalid = () => new CursorInvalidatedError(state);
  if (cursor.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cursor)) throw invalid();
  const [body, signature] = cursor.split(".") as [string, string];
  const expected = createHmac("sha256", token).update(body).digest("base64url");
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw invalid();
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const p = payload.position;
    if (payload.v !== 1 || JSON.stringify(payload.identity) !== JSON.stringify(identity(state)) || payload.shape !== shape
      || typeof p?.id !== "string" || !p.id.length || p.id.includes("\0") || Buffer.byteLength(p.id)>256
      || (p.value !== undefined && (!Number.isInteger(p.value) || p.value < -2147483648 || p.value > 2147483647))) throw invalid();
    return p;
  } catch { throw invalid(); }
}
