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
      if (fields[fieldName] || field.arguments?.length || field.directives?.length) throw new Error(`Invalid or duplicate field: ${fieldName}`);
      const required = field.type.kind === Kind.NON_NULL_TYPE;
      const type = field.type.kind === Kind.NON_NULL_TYPE ? field.type.type : field.type;
      if (type.kind !== Kind.NAMED_TYPE || !scalars.has(type.name.value as Scalar)) throw new Error("Entity fields must be ID, String, Boolean, Int, or BigInt; relations and lists are unsupported");
      fields[fieldName] = { name: fieldName, scalar: type.name.value as Scalar, required };
    }
    if (fields.id?.scalar !== "ID" || !fields.id.required) throw new Error(`Entity ${name} requires id: ID!`);
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
  return { entities: ordered, fingerprint: createHash("sha256").update(JSON.stringify(ordered)).digest("hex") };
}

export function encodeEntity(model: Model, name: string, input: unknown): StoredEntity {
  const entity = Object.hasOwn(model.entities, name) ? model.entities[name] : undefined;
  if (!entity) throw new Error(`Unknown entity: ${name}`);
  if (!input || typeof input !== "object" || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error("Entity must be a plain object");
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !Object.hasOwn(entity.fields, key))) throw new Error("Unknown entity field");
  const stored: Record<string, string | number | boolean | null> = Object.create(null);
  for (const field of Object.values(entity.fields)) {
    const item = Object.hasOwn(value, field.name) ? value[field.name] : undefined;
    if (item === null || item === undefined) {
      if (field.required) throw new Error(`Missing required field: ${field.name}`);
      stored[field.name] = null;
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
    if (field.scalar === "BigInt" && validated[field.name] !== null) decoded[field.name] = BigInt(validated[field.name] as string);
  }
  return decoded;
}

export function generateTypes(model: Model): string {
  const scalarType = { ID: "string", String: "string", Boolean: "boolean", Int: "number", BigInt: "bigint" };
  const entities = Object.values(model.entities).map((entity) => `export interface ${entity.name} {\n${Object.values(entity.fields).map((field) => `  ${field.name}: ${scalarType[field.scalar]}${field.required ? "" : " | null"};`).join("\n")}\n}`).join("\n\n");
  return `// Generated by Zeer Chef. Schema fingerprint: ${model.fingerprint}\nimport type { HandlerContext } from "@zeer/chef";\n\n${entities}\n\nexport interface ChefEntities {\n${Object.keys(model.entities).map((name) => `  ${name}: ${name};`).join("\n")}\n}\n\nexport type ChefHandlerContext = HandlerContext<ChefEntities>;\n`;
}
