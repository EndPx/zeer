import { ApiError, input, upstream, failure } from "@/lib/upstream";
export async function POST(request: Request) {
  try {
    const q = await input(request);
    if (
      !q ||
      typeof q !== "object" ||
      Array.isArray(q) ||
      Object.keys(q).some(
        (k) =>
          ![
            "from_block",
            "to_block",
            "limit",
            "field_selection",
            "transaction_filter",
            "cursor",
          ].includes(k),
      )
    )
      throw new ApiError(400, "Unsupported query shape.");
    if (
      !Number.isSafeInteger(q.from_block) ||
      !Number.isSafeInteger(q.to_block) ||
      q.from_block < 1 ||
      q.to_block <= q.from_block ||
      q.to_block - q.from_block > 1000
    )
      throw new ApiError(
        400,
        "Choose an inclusive start and exclusive end covering 1–1,000 blocks.",
      );
    return Response.json(await upstream("prep", "/query", q, request.signal), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
