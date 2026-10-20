import { isAbsolute } from "node:path";
import { PrepClient } from "@zeer-dev/prep-client";
import { NativeReceiptSource, readShieldedTransaction } from "@zeer-dev/chef";

// Run locally. This program prints private note data to your terminal.
const txid = process.argv[2];
if (!txid || !/^[0-9a-f]{64}$/.test(txid)) throw Error("Supply a lowercase 64-character transaction ID.");
for (const name of ["ZEER_SCANNER_EXECUTABLE", "ZEER_VIEWING_KEY_FILE"])
  if (!process.env[name] || !isAbsolute(process.env[name])) throw Error(`${name} must be an absolute local path.`);
const source = new NativeReceiptSource({
  executable: process.env.ZEER_SCANNER_EXECUTABLE,
  keyFile: process.env.ZEER_VIEWING_KEY_FILE,
  accountId: process.env.ZEER_ACCOUNT_ID ?? "inbox",
  keyFingerprint: process.env.ZEER_KEY_FINGERPRINT ?? "",
});
const client = new PrepClient({ url: process.env.PREP_URL, token: process.env.PREP_API_TOKEN });
try {
  const result = await readShieldedTransaction({ client, receiptSource: source, txid, signal: AbortSignal.timeout(120_000) });
  console.log(JSON.stringify(result, null, 2));
} finally { await source.close(); }
