import { ApiError, input, upstream, failure } from "@/lib/upstream";
export async function inspectTransaction(request:Request,publicRead=false) {
  try {
    const body=await input(request,publicRead);
    if (!body || typeof body.txid!=="string" || !/^[0-9a-f]{64}$/.test(body.txid) || Object.keys(body).some(key=>key!=="txid")) throw new ApiError(400,"Enter one 64-character hexadecimal transaction ID.");
    return Response.json(await upstream("prep","/transaction",{txid:body.txid},request.signal),{headers:{"Cache-Control":"no-store"}});
  }catch(error){return failure(error,publicRead);}
}
export async function prepQueryResponse(request: Request, publicRead = false) {
  try {
    const q = await input(request, publicRead);
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
            "scan_mode",
            "field_selection",
            "transaction_filter",
            "cursor",
          ].includes(k),
      )
    )
      throw new ApiError(400, "Unsupported query shape.");
    const hasEnd = q.to_block !== undefined && q.to_block !== null;
    if (
      !Number.isSafeInteger(q.from_block) ||
      q.from_block < 0 || q.from_block > 0xffffffff ||
      (hasEnd && (!Number.isSafeInteger(q.to_block) || q.to_block <= q.from_block || q.to_block > 0x100000000)) ||
      (q.scan_mode !== undefined && q.scan_mode !== null && q.scan_mode !== "adaptive") ||
      (q.limit !== undefined && (!Number.isSafeInteger(q.limit) || q.limit < 1 || q.limit > (q.scan_mode === "adaptive" ? 1000000 : 1000)))
    )
      throw new ApiError(
        400,
        "Use a valid range and a page limit of 1–1,000 blocks, or up to 1,000,000 with scan_mode: adaptive.",
      );
    return Response.json(await upstream("prep", "/query", q, request.signal), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return failure(e, publicRead);
  }
}

export async function transactionResponse(request: Request, publicRead = false) {
  try {
    const q = await input(request, publicRead);
    if (
      !q ||
      typeof q !== "object" ||
      Array.isArray(q) ||
      Object.keys(q).some(
        (k) => !["from_block", "to_block", "txids", "fields", "at"].includes(k),
      ) ||
      !Number.isSafeInteger(q.from_block) ||
      !Number.isSafeInteger(q.to_block) ||
      q.from_block < 0 ||
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
    return failure(e, publicRead);
  }
}
