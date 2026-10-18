import { failure, upstream } from "@/lib/upstream";
import { prepQueryResponse, transactionResponse } from "@/lib/prep-handlers";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ operation: string }> };
function cors(response: Response) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.headers.set("Cache-Control", "no-store");
  return response;
}
// This endpoint intentionally exposes anonymous public-chain reads to SDK clients.
// Hostnames, credentials and upstream routes remain operator-controlled.
export async function GET(_request: Request, context: Context) {
  const { operation } = await context.params;
  if (!["height", "health", "ready", "capabilities"].includes(operation)) return cors(new Response(null, { status: 404 }));
  try {
    const data = await upstream("prep", `/${operation}`);
    if (operation === "capabilities") {
      data.limits.max_request_bytes = 16128;
      data.limits.max_active_queries = 2;
      data.limits.query_timeout_ms = 15000;
      delete data.limits.max_waiting_queries; delete data.limits.queue_timeout_ms;
      data.query.max_response_bytes = Math.min(data.query.max_response_bytes, 8 * 1024 * 1024);
      data.transactions.max_response_bytes = Math.min(data.transactions.max_response_bytes, 8 * 1024 * 1024);
      data.transactions.max_range_blocks = 1000;
    }
    return cors(Response.json(data));
  } catch (error) { return cors(failure(error, true)); }
}
export async function POST(request: Request, context: Context) {
  const { operation } = await context.params;
  if (operation === "query") return cors(await prepQueryResponse(request, true));
  if (operation === "transactions") return cors(await transactionResponse(request, true));
  return cors(new Response(null, { status: 404 }));
}
export async function OPTIONS(_request: Request, context: Context) {
  const { operation } = await context.params;
  return cors(new Response(null, { status: ["height","health","ready","capabilities","query","transactions"].includes(operation) ? 204 : 404 }));
}
