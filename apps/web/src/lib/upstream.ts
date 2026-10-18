import "server-only";
let active = 0;
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function boundedJson(response: Response, max = 2 * 1024 * 1024) {
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
export async function input(request: Request) {
  const expectedOrigin =
    process.env.ZEER_WEB_ORIGIN ??
    `${new URL(request.url).protocol}//${request.headers.get("host") ?? new URL(request.url).host}`;
  if (
    request.headers.get("origin") &&
    expectedOrigin !== request.headers.get("origin")
  )
    throw new ApiError(403, "Cross-origin requests are not accepted.");
  return boundedJson(new Response(request.body), 16384);
}
export async function upstream(
  service: "prep" | "chef",
  route: string,
  body?: unknown,
  signal?: AbortSignal,
) {
  const base =
    service === "prep" ? process.env.ZEER_PREP_URL : process.env.ZEER_CHEF_URL;
  const token =
    service === "prep"
      ? process.env.ZEER_PREP_TOKEN
      : process.env.ZEER_CHEF_TOKEN;
  if (!base)
    throw new ApiError(
      503,
      `${service === "prep" ? "Prep" : "Chef"} demo is not connected yet. Use a recorded example or run the quickstart locally.`,
    );
  if (active >= 2)
    throw new ApiError(
      429,
      "The demo is busy. Wait for the current requests to finish, then retry.",
    );
  let url: URL;
  try {
    url = new URL(base);
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
    const res = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
    });
    if (!res.ok) {
      await res.body?.cancel();
      throw new ApiError(
        res.status === 429
          ? 429
          : res.status === 409
            ? 409
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
                : "The source rejected this query. Check its range and supported fields.",
      );
    }
    const data = await boundedJson(res);
    if (service === "prep" && (!data || data.network !== "testnet"))
      throw new ApiError(
        502,
        "The source did not return the expected testnet response.",
      );
    if (service === "chef" && data?.errors)
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
export function failure(e: unknown) {
  return Response.json(
    {
      error:
        e instanceof ApiError
          ? e.message
          : "The request could not be processed.",
    },
    {
      status: e instanceof ApiError ? e.status : 400,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
