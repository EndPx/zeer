import { createHash } from "node:crypto";
import { Kind, parse } from "graphql";
import type { Model, Scalar, StoredEntity } from "./types.js";

const scalars = new Set<Scalar>(["ID", "String", "Boolean", "Int", "BigInt"]);
const reserved = new Set(["__proto__", "prototype", "constructor", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString"]);
const bytes = (value: string) => Buffer.byteLength(value, "utf8");
const compareNames = ([a]: [string, unknown], [b]: [string, unknown]) => a < b ? -1 : a > b ? 1 : 0;
function safeName(name: string): void {
  if (!/^[_A-Za-z][_0-9A-Za-z]*$/.test(name) || name.startsWith("__") || reserved.has(name) || name.length > 64) throw new Error(`Unsafe schema name: ${name}`);
}

/** Internal descriptor shared by explicit migration and benchmark experiments. */
export function queryIndexes(model: Model): { name: string; entity: string; field: string }[] {
  const indexes: { name: string; entity: string; field: string }[] = [];
  for (const [entityName, entity] of Object.entries(model.entities).sort(compareNames)) {
    safeName(entityName);
    if (entity.name !== entityName) throw new Error("Entity definition name must match its key");
    for (const [fieldName, field] of Object.entries(entity.fields).sort(compareNames)) {
      safeName(fieldName);
      if (field.name !== fieldName) throw new Error("Field definition name must match its key");
      if (!scalars.has(field.scalar) || typeof field.required !== "boolean") throw new Error("Invalid scalar definition");
      if (field.list && (typeof field.list !== "object" || Array.isArray(field.list) || Object.keys(field.list).length !== 1 || typeof field.list.itemRequired !== "boolean")) throw new Error("Invalid list definition");
      if (field.reference) {
        safeName(field.reference);
        if (field.scalar !== "ID" || !model.entities[field.reference]) throw new Error("Invalid relation target");
      }
      if (field.derivedFrom) {
        safeName(field.derivedFrom);
        const inverse = model.entities[field.reference ?? ""]?.fields[field.derivedFrom];
        if (!field.list || !inverse || inverse.reference !== entityName || inverse.list || inverse.derivedFrom || !inverse.indexed) throw new Error("Invalid derived relation");
      }
      if (!Object.hasOwn(field, "indexed")) continue;
      if (field.indexed !== true || fieldName === "id" || field.list || field.derivedFrom || !["Int", "Boolean", "BigInt", "ID"].includes(field.scalar)) {
        throw new Error("@index requires Int, Boolean, BigInt or a non-id ID field");
      }
      if (indexes.length === 8) throw new Error("A project supports at most 8 @index fields");
      indexes.push({ name: `chef_qi_${createHash("sha256").update(JSON.stringify([entityName, fieldName])).digest("hex").slice(0, 24)}`,
        entity: entityName, field: fieldName });
    }
  }
  return indexes;
}

export function parseModel(sdl: string): Model {
  if (bytes(sdl) > 64 * 1024) throw new Error("Schema exceeds 64 KiB");
  const document = parse(sdl, { maxTokens: 4096 });
  if (document.definitions.length < 1 || document.definitions.length > 20) throw new Error("Schema needs 1 to 20 entities");
  const entities: Model["entities"] = Object.create(null);
  for (const definition of document.definitions) {
    if (definition.kind !== Kind.OBJECT_TYPE_DEFINITION || definition.interfaces?.length || definition.directives?.length) throw new Error("Only entity object types without interfaces or directives are supported");
    const name = definition.name.value;
    safeName(name);
    if (entities[name]) throw new Error(`Duplicate entity: ${name}`);
    if (!definition.fields?.length || definition.fields.length > 32) throw new Error("Each entity needs 1 to 32 fields");
    const fields: Model["entities"][string]["fields"] = Object.create(null);
    for (const field of definition.fields) {
      const fieldName = field.name.value;
      safeName(fieldName);
      if (fields[fieldName] || field.arguments?.length) throw new Error(`Invalid or duplicate field: ${fieldName}`);
      const directives = field.directives ?? [];
      if (directives.length > 1 || directives.some(d=>!["index", "derivedFrom"].includes(d.name.value))) {
        throw new Error(`Use @index or @derivedFrom: ${fieldName}`);
      }
      const required = field.type.kind === Kind.NON_NULL_TYPE;
      const type = field.type.kind === Kind.NON_NULL_TYPE ? field.type.type : field.type;
      const item = type.kind === Kind.LIST_TYPE ? type.type : type;
      const named = item.kind === Kind.NON_NULL_TYPE ? item.type : item;
      if (named.kind !== Kind.NAMED_TYPE) throw new Error("Nested lists are unsupported");
      const target = named.name.value;
      safeName(target);
      const reference = !scalars.has(target as Scalar);
      const index = directives.find(d=>d.name.value === "index");
      const derived = directives.find(d=>d.name.value === "derivedFrom");
      if (index?.arguments?.length) throw new Error("@index takes no arguments");
      let derivedFrom: string | undefined;
      if (derived) {
        const arg = derived.arguments?.[0];
        if (derived.arguments?.length !== 1 || arg?.name.value !== "field" || arg.value.kind !== Kind.STRING || !reference || type.kind !== Kind.LIST_TYPE) throw new Error("@derivedFrom requires an entity list and one field string");
        safeName(arg.value.value); derivedFrom = arg.value.value;
      }
      fields[fieldName] = { name: fieldName, scalar: reference ? "ID" : target as Scalar, required,
        ...(index ? { indexed: true as const } : {}), ...(type.kind === Kind.LIST_TYPE ? { list: { itemRequired: item.kind === Kind.NON_NULL_TYPE } } : {}),
        ...(reference ? { reference: target } : {}), ...(derivedFrom ? { derivedFrom } : {}) };
    }
    if (fields.id?.scalar !== "ID" || !fields.id.required || fields.id.list || fields.id.reference) throw new Error(`Entity ${name} requires id: ID!`);
    entities[name] = { name, fields: Object.fromEntries(Object.entries(fields).sort(compareNames)) };
  }
  const names = new Set(["Query", "ChefCheckpoint", "ChefEntities", "ChefHandlerContext", "HandlerContext", ...scalars]);
  for (const name of Object.keys(entities)) {
    for (const generated of [name, `${name}Filter`, `${name}Page`]) {
      if (names.has(generated)) throw new Error(`GraphQL type name collision: ${generated}`);
      names.add(generated);
    }
  }
  const ordered = Object.fromEntries(Object.entries(entities).sort(compareNames));
  for (const entity of Object.values(ordered)) for (const field of Object.values(entity.fields)) {
    if (field.reference && !ordered[field.reference]) throw new Error(`Unknown relation target: ${field.reference}`);
    if (field.derivedFrom) {
      const inverse = ordered[field.reference!]!.fields[field.derivedFrom];
      if (!inverse || inverse.reference !== entity.name || inverse.list || inverse.derivedFrom) throw new Error(`Invalid @derivedFrom inverse: ${entity.name}.${field.name}`);
      if (!inverse.indexed) throw new Error(`@derivedFrom requires @index on ${field.reference}.${field.derivedFrom}`);
    }
  }
  const model = { entities: ordered, fingerprint: createHash("sha256").update(JSON.stringify(ordered)).digest("hex") };
  queryIndexes(model);
  return model;
}

export function encodeEntity(model: Model, name: string, input: unknown): StoredEntity {
  const entity = Object.hasOwn(model.entities, name) ? model.entities[name] : undefined;
  if (!entity) throw new Error(`Unknown entity: ${name}`);
  if (!input || typeof input !== "object" || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error("Entity must be a plain object");
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !Object.hasOwn(entity.fields, key))) throw new Error("Unknown entity field");
  const stored: StoredEntity = Object.create(null);
  for (const field of Object.values(entity.fields)) {
    if (field.derivedFrom) { if (Object.hasOwn(value, field.name)) throw new Error(`Derived field is read-only: ${field.name}`); continue; }
    const item = Object.hasOwn(value, field.name) ? value[field.name] : undefined;
    if (item === null || item === undefined) {
      if (field.required) throw new Error(`Missing required field: ${field.name}`);
      stored[field.name] = null;
      continue;
    }
    if (field.list) {
      if (!Array.isArray(item) || item.length > 100) throw new Error(`List requires at most 100 items: ${field.name}`);
      const elementModel: Model = { fingerprint: model.fingerprint, entities: { Item: { name: "Item", fields: { id: { name: "id", scalar: "ID", required: true }, value: { name: "value", scalar: field.scalar, required: field.list.itemRequired } } } } };
      stored[field.name] = item.map(element=>encodeEntity(elementModel, "Item", { id: "item", value: element }).value as string | number | boolean | null);
      continue;
    }
    switch (field.scalar) {
      case "ID":
      case "String":
        if (typeof item !== "string" || item.includes("\0") || bytes(item) > (field.scalar === "ID" ? 256 : 16384) || (field.scalar === "ID" && !item.length)) throw new Error(`Invalid ${field.scalar}: ${field.name}`);
        stored[field.name] = item;
        break;
      case "Boolean":
        if (typeof item !== "boolean") throw new Error(`Invalid Boolean: ${field.name}`);
        stored[field.name] = item;
        break;
      case "Int":
        if (typeof item !== "number" || !Number.isInteger(item) || item < -2147483648 || item > 2147483647) throw new Error(`Invalid Int: ${field.name}`);
        stored[field.name] = item;
        break;
      case "BigInt": {
        const integer = typeof item === "bigint" ? item.toString() : item;
        if (typeof integer !== "string" || !/^(0|-?[1-9][0-9]{0,127})$/.test(integer)) throw new Error(`Invalid BigInt: ${field.name}`);
        stored[field.name] = integer;
        break;
      }
    }
  }
  if (bytes(JSON.stringify(stored)) > 65536) throw new Error("Entity exceeds 64 KiB");
  return stored as StoredEntity;
}

export function decodeEntity(model: Model, name: string, stored: StoredEntity): Record<string, unknown> {
  const validated = encodeEntity(model, name, stored);
  const decoded: Record<string, unknown> = { ...validated };
  for (const field of Object.values(model.entities[name]!.fields)) {
    if (!field.derivedFrom && field.scalar === "BigInt" && validated[field.name] !== null) decoded[field.name] = field.list
      ? (validated[field.name] as (string | null)[]).map(v=>v === null ? null : BigInt(v)) : BigInt(validated[field.name] as string);
  }
  return decoded;
}

export function generateTypes(model: Model): string {
  const scalarType = { ID: "string", String: "string", Boolean: "boolean", Int: "number", BigInt: "bigint" };
  const entities = Object.values(model.entities).map((entity) => `export interface ${entity.name} {\n${Object.values(entity.fields).filter(f=>!f.derivedFrom).map((field) => `  ${field.name}: ${field.list ? `(${scalarType[field.scalar]}${field.list.itemRequired ? "" : " | null"})[]` : scalarType[field.scalar]}${field.required ? "" : " | null"};`).join("\n")}\n}`).join("\n\n");
  return `// Generated by Zeer Chef. Schema fingerprint: ${model.fingerprint}\nimport type { HandlerContext } from "@zeer-dev/chef";\n\n${entities}\n\nexport interface ChefEntities {\n${Object.keys(model.entities).map((name) => `  ${name}: ${name};`).join("\n")}\n}\n\nexport type ChefHandlerContext = HandlerContext<ChefEntities>;\n`;
}
