/** Display projection of already-decrypted 512-byte memo data, per ZIP 302.
 * Raw memoHex remains authoritative for binary, future and malformed content.
 */
export function readableMemo(hex: string): { memoKind: string; memoText: string | null } {
  if (!/^[0-9a-fA-F]{1024}$/.test(hex)) throw new Error("Expected exactly 512 memo bytes");
  const bytes = Buffer.from(hex, "hex");
  if (bytes[0] === 0xf6 && bytes.subarray(1).every(byte => byte === 0)) {
    return { memoKind: "no_memo", memoText: null };
  }
  if (bytes[0]! >= 0xf5) return { memoKind: "non_text", memoText: null };
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, end)); }
  catch { return { memoKind: "invalid_utf8", memoText: null }; }
  // PostgreSQL text cannot store U+0000. Keep those bytes losslessly in memoHex.
  if (text.includes("\0")) return { memoKind: "text_with_nul", memoText: null };
  return { memoKind: text.length ? "text" : "empty_text", memoText: text };
}
