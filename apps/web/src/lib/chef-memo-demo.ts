/** Public metadata for the deliberately published Zeer demo receipt. No key material. */
export interface ChefMemoDemo { txid: string; blockHeight: number; blockHash: string; pool: "ironwood"; project: string }
export function parseChefMemoDemo(value?: string): ChefMemoDemo | null {
  if (!value) return null;
  try {
    const demo = JSON.parse(value);
    if (!demo || Object.keys(demo).some(key => !["txid", "blockHeight", "blockHash", "pool", "project"].includes(key)) ||
        !/^[0-9a-f]{64}$/.test(demo.txid) || !/^[0-9a-f]{64}$/.test(demo.blockHash) || !Number.isInteger(demo.blockHeight) || demo.blockHeight < 0 || demo.blockHeight > 0xffff_fffe ||
        demo.pool !== "ironwood" || !/^[a-z][a-z0-9_]{0,31}$/.test(demo.project)) return null;
    return demo;
  } catch { return null; }
}

/** Preview only an actual text receipt for the configured example TX. */
export function memoPreview(result: unknown, txid?: string): { text: string; valueZat: string } | null {
  if (!result || typeof result !== "object" || "errors" in result || !("data" in result)) return null;
  const data = result.data;
  if (!data || typeof data !== "object" || !("ReadableNoteList" in data)) return null;
  const page = data.ReadableNoteList;
  if (!page || typeof page !== "object" || !("items" in page) || !Array.isArray(page.items)) return null;
  const note = page.items.find(item => item && item.txid === txid && item.memoKind === "text" && typeof item.memoText === "string" && /^[1-9][0-9]*$/.test(item.valueZat));
  return note ? { text: note.memoText, valueZat: note.valueZat } : null;
}
