import { parse, visit, Kind } from "graphql";
import { ApiError, input, upstream, failure } from "@/lib/upstream";
export async function POST(request: Request) {
  try {
    const q = await input(request);
    if (
      !q ||
      typeof q.query !== "string" ||
      q.query.length > 12000 ||
      Object.keys(q).some((k) => k !== "query")
    )
      throw new ApiError(400, "Supply one GraphQL query.");
    let document;
    try {
      document = parse(q.query);
    } catch {
      throw new ApiError(
        400,
        "GraphQL syntax is invalid. Check the query and try again.",
      );
    }
    if (
      document.definitions.length !== 1 ||
      document.definitions[0].kind !== Kind.OPERATION_DEFINITION ||
      document.definitions[0].operation !== "query"
    )
      throw new ApiError(400, "Only one read-only query is supported.");
    let count = 0;
    visit(document, {
      Field(node) {
        if (++count > 100 || node.name.value.startsWith("__"))
          throw new ApiError(
            400,
            "Query is too large or requests unsupported introspection.",
          );
      },
    });
    return Response.json(
      await upstream("chef", "/graphql", q, request.signal),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
