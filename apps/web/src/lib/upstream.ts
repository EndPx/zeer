import "server-only";
import { sshUpstream } from "./ssh-upstream";
let active = 0;
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = status === 429 ? "RATE_LIMITED" : status === 413 ? "RESPONSE_TOO_LARGE" : status >= 500 ? "SOURCE_UNAVAILABLE" : "INVALID_REQUEST",
  ) {
    super(message);
  }
}
export async function boundedJson(response: Response, max = 8 * 1024 * 1024) {
  if (!response.body) throw new ApiError(502, "Upstream returned no body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    void reader.cancel();
  }, 15000);
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        if (expired) throw new ApiError(408, "Request deadline exceeded.");
        break;
      }
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new ApiError(
          413,
          "Response is too large. Request fewer fields or a smaller range.",
        );
      }
      chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError(502, "Upstream returned an invalid response.");
  }
}
export async function input(request: Request, publicRead = false) {
  const expectedOrigin =
    process.env.ZEER_WEB_ORIGIN ??
    `${new URL(request.url).protocol}//${request.headers.get("host") ?? new URL(request.url).host}`;
  if (
    !publicRead && request.headers.get("origin") &&
    expectedOrigin !== request.headers.get("origin")
  )
    throw new ApiError(403, "Cross-origin requests are not accepted.");
  return boundedJson(new Response(request.body), publicRead ? 16128 : 16384);
}
export async function upstream(
  service: "prep" | "chef" | "chefMemo",
  route: string,
  body?: unknown,
  signal?: AbortSignal,
) {
  const base =
    service === "prep" ? process.env.ZEER_PREP_URL : service === "chefMemo" ? process.env.ZEER_CHEF_MEMO_URL : process.env.ZEER_CHEF_URL;
  const token =
    service === "prep"
      ? process.env.ZEER_PREP_TOKEN
      : service === "chefMemo" ? process.env.ZEER_CHEF_MEMO_TOKEN : process.env.ZEER_CHEF_TOKEN;
  if (!base)
    throw new ApiError(
      503,
      `${service === "prep" ? "Prep" : "Chef"} demo is not connected yet. Connect a real service or run the quickstart locally.`,
    );
  if (active >= 2)
    throw new ApiError(
      429,
      "The demo is busy. Wait for the current requests to finish, then retry.",
    );
  const privateTransport = service !== "chefMemo" && base === `ssh://${service}`;
  let url: URL;
  try {
    url = new URL(privateTransport ? "http://127.0.0.1" : base);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw Error();
    url.pathname = url.pathname.replace(/\/$/, "") + route;
  } catch {
    throw new ApiError(503, "The demo service configuration needs attention.");
  }
  active++;
  try {
    const timeout = AbortSignal.timeout(15000);
    const requestSignal = signal ? AbortSignal.any([timeout, signal]) : timeout;
    const res = privateTransport ? await sshUpstream(service as "prep" | "chef", route, body, requestSignal) : await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: requestSignal,
    });
    if (!res.ok) {
      let sourceCode: string | undefined;
      if (res.status === 409) {
        try { if ((await boundedJson(res, 8192))?.error?.code === "REORG") sourceCode = "REORG"; } catch { /* Never forward upstream messages. */ }
      } else await res.body?.cancel();
      throw new ApiError(
        res.status === 429
          ? 429
          : res.status === 409
            ? 409
            : res.status === 416 ? 416
            : res.status === 413 ? 413
            : res.status === 401 || res.status === 403
              ? 502
              : res.status >= 500
                ? 503
                : 400,
        res.status === 409
          ? "The source snapshot changed. Start a fresh query."
          : res.status === 429
            ? "The source is busy. Retry shortly."
            : res.status === 401 || res.status === 403
              ? "The demo service could not authenticate with its source."
              : res.status >= 500
                ? "The source is not ready. Retry after it recovers."
                : service !== "prep" ? "Chef could not validate this query. Check field names and argument types against the schema, or restore the example."
                : "The source rejected this query. Check its range and supported fields.",
        sourceCode ?? (res.status === 409 ? "SNAPSHOT_CONFLICT" : res.status === 416 ? "RANGE_OUTSIDE_INDEXED_ARCHIVE" : res.status === 413 ? "RESPONSE_TOO_LARGE" : res.status === 429 ? "RATE_LIMITED" : res.status >= 500 ? "SOURCE_UNAVAILABLE" : "INVALID_REQUEST"),
      );
    }
    const data = await boundedJson(res);
    if (service === "prep" && !["/capabilities", "/health"].includes(route) && (!data || data.network !== "testnet"))
      throw new ApiError(
        502,
        "The source did not return the expected testnet response.",
      );
    if (service !== "prep" && data?.errors)
      throw new ApiError(
        400,
        "Chef rejected this query. Check supported fields and source readiness.",
      );
    return data;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(
      503,
      "The source could not be reached within the request deadline.",
    );
  } finally {
    active--;
  }
}
export function failure(e: unknown, protocol = false) {
  const message = e instanceof ApiError ? e.message : "The request could not be processed.";
  return Response.json(
    {
      error: protocol ? { code: e instanceof ApiError ? e.code : "INVALID_REQUEST", message } : message,
    },
    {
      status: e instanceof ApiError ? e.status : 400,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
