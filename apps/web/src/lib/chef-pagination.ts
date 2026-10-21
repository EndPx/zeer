import { chefQuery } from "./content.ts";

export function chefExampleQuery(after?: string) {
  return after === undefined ? chefQuery : chefQuery.replace("first: 3", `first: 3, after: ${JSON.stringify(after)}`);
}

/** Never offer continuation for a custom or edited query. */
export function chefExampleCursor(query: string, result: unknown, after?: string): string | null {
  if (query !== chefExampleQuery(after)) return null;
  if (typeof result !== "object" || result === null || !("data" in result)) return null;
  const data = result.data;
  if (!data || typeof data !== "object" || !("BlockSummaryList" in data)) return null;
  const page = data.BlockSummaryList;
  if (!page || typeof page !== "object" || !("nextCursor" in page)) return null;
  const cursor = page.nextCursor;
  return typeof cursor === "string" && cursor.length > 0 && cursor.length <= 2048 ? cursor : null;
}

export function chefResponseEmpty(result: unknown): boolean {
  if (!result || typeof result !== "object" || "errors" in result || !("data" in result)) return false;
  const data = result.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const entities = Object.entries(data).filter(([name]) => name !== "_meta");
  return entities.length > 0 && entities.every(([, value]) => value === null ||
    typeof value === "object" && value !== null && "items" in value && Array.isArray(value.items) && value.items.length === 0);
}
