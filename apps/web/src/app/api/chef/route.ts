import { parse, visit, Kind, GraphQLError } from "graphql";
import { demoQueryError, memoQuery, memoQueryError } from "@/lib/chef-demo-validation";
import { parseChefDemo } from "@/lib/chef-demo";
import { parseChefMemoDemo } from "@/lib/chef-memo-demo";
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
      document = parse(q.query, { maxTokens: 4096 });
    } catch (error) {
      const location = error instanceof GraphQLError ? error.locations?.[0] : undefined;
      throw new ApiError(
        400,
        `GraphQL syntax is invalid${location ? ` at line ${location.line}, column ${location.column}` : ""}. Check brackets and field names, or restore the example.`,
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
        const first = node.arguments?.find(argument => argument.name.value === "first")?.value;
        if (node.name.value.endsWith("List") && first &&
            (first.kind !== Kind.INT || Number(first.value) < 1 || Number(first.value) > 100))
          throw new ApiError(400, "Use first: 1–100 per page. Request nextCursor, then pass it as after to continue.");
        if (++count > 100 || node.name.value.startsWith("__"))
          throw new ApiError(
            400,
            "Query is too large or requests unsupported introspection.",
          );
      },
    });
    const isMemo = memoQuery(document);
    const memoDemo = parseChefMemoDemo(process.env.ZEER_CHEF_MEMO_DEMO);
    if (isMemo && !memoDemo) throw new ApiError(503, "The published memo example is not connected yet. Run the shielded-inbox quickstart locally with your viewing key.");
    const validationError = isMemo ? memoQueryError(document) : demoQueryError(document, parseChefDemo(process.env.ZEER_CHEF_DEMO)?.project);
    if (validationError) throw new ApiError(400, validationError);
    // The published projection has no hosted viewing key or scanner. Refuse to serve
    // its historical receipt if our current chain source no longer reports that block.
    const observe = async () => {
      if (!isMemo || !memoDemo) return null;
      const observation = await upstream("prep", "/transaction", { txid: memoDemo.txid }, request.signal);
      if (observation.txid !== memoDemo.txid || observation.status !== "mined" || observation.block_height !== memoDemo.blockHeight || observation.block_hash !== memoDemo.blockHash)
        throw new ApiError(409, "The demo receipt's block is no longer confirmed by the current source. Retry after the example is refreshed.");
      return observation;
    };
    await observe();
    const data = await upstream(isMemo ? "chefMemo" : "chef", "/graphql", q, request.signal);
    const observation = await observe();
    return Response.json(
      observation ? { ...data, extensions: { source: { network: "testnet", txid: observation.txid, blockHeight: observation.block_height, blockHash: observation.block_hash, confirmations: observation.confirmations, observedAt: observation.observed_at } } } : data,
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
