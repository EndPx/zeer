import { buildSchema, validate, type DocumentNode } from "graphql";

// Only the explicitly selected hosted example has this known schema.
// A custom Chef project's upstream schema remains authoritative.
const demoSchema = buildSchema(`
  scalar BigInt
  type BlockSummary { id: ID! height: Int! hash: String! time: BigInt! transactionCount: Int! }
  input BlockSummaryFilter { id: ID height: Int hash: String time: BigInt transactionCount: Int }
  type BlockSummaryPage { items: [BlockSummary!]! nextCursor: ID }
  type ChefCheckpoint { height: Int hash: String anchorHash: String status: String! }
  type Query {
    BlockSummaryById(id: ID!): BlockSummary
    BlockSummaryList(first: Int = 25, after: ID, where: BlockSummaryFilter): BlockSummaryPage!
    _meta: ChefCheckpoint!
  }
`);

const memoSchema = buildSchema(`
  scalar BigInt
  type ReadableNote { id: ID! txid: String! pool: String! outputIndex: Int! blockHeight: Int! valueZat: BigInt! receiver: String! memoHex: String! memoKind: String! memoText: String scope: String! origin: String! coinbase: Boolean! }
  input ReadableNoteFilter { id: ID txid: String pool: String outputIndex: Int blockHeight: Int valueZat: BigInt receiver: String memoHex: String memoKind: String memoText: String scope: String origin: String coinbase: Boolean }
  type ReadableNotePage { items: [ReadableNote!]! nextCursor: ID }
  type ChefCheckpoint { height: Int hash: String anchorHash: String status: String! }
  type Query { ReadableNoteById(id: ID!): ReadableNote ReadableNoteList(first: Int = 25, after: ID, where: ReadableNoteFilter): ReadableNotePage! _meta: ChefCheckpoint! }
`);

/** Route by actual query fields, so editing the editor cannot silently select a different schema. */
export function memoQuery(document: DocumentNode): boolean {
  return document.definitions.some(definition => definition.kind === "OperationDefinition" &&
    definition.selectionSet.selections.some(selection => selection.kind === "Field" && selection.name.value.startsWith("ReadableNote")));
}
export function memoQueryError(document: DocumentNode): string | null {
  return validate(memoSchema, document, undefined, { maxErrors: 1 })[0]?.message ?? null;
}

export function demoQueryError(document: DocumentNode, project?: string): string | null {
  if (project !== "hackathon_testnet_20261020" && project !== "hosted_genesis_testnet_v2") return null;
  const error = validate(demoSchema, document, undefined, { maxErrors: 1 })[0];
  return error ? `${error.message} Restore the example or use the fields in the schema panel.` : null;
}
