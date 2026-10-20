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

export function demoQueryError(document: DocumentNode, project?: string): string | null {
  if (project !== "hackathon_testnet_20261020") return null;
  const error = validate(demoSchema, document, undefined, { maxErrors: 1 })[0];
  return error ? `${error.message} Restore the example or use the fields in the schema panel.` : null;
}
