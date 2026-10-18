import { ApiError, input, upstream, failure } from "@/lib/upstream";
export async function POST(request: Request) {
  try {
    const q = await input(request);
    if (
      !q ||
      typeof q !== "object" ||
      Array.isArray(q) ||
      Object.keys(q).some(
        (k) => !["from_block", "to_block", "txids"].includes(k),
      ) ||
      !Number.isSafeInteger(q.from_block) ||
      !Number.isSafeInteger(q.to_block) ||
      q.from_block < 1 ||
      q.to_block <= q.from_block ||
      q.to_block - q.from_block > 1000 ||
      !Array.isArray(q.txids) ||
      q.txids.length > 128 ||
      !q.txids.every(
        (id: unknown) => typeof id === "string" && /^[a-f0-9]{64}$/.test(id),
      )
    )
      throw new ApiError(
        400,
        "Provide a range of up to 1,000 blocks and up to 128 lowercase transaction IDs.",
      );
    return Response.json(
      await upstream("prep", "/transactions", q, request.signal),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
