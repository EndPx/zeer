export type PublicRow = Record<string, unknown>;
export function publicRecord(value: unknown): PublicRow {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as PublicRow : {};
}
export function utcTimestamp(value: unknown): string {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return "—";
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? "—" : date.toISOString().slice(0, 19).replace("T", " ");
}
export function transactionKind(vin: unknown): string {
  if (!Array.isArray(vin)) return "Not supplied";
  return vin.some(input => typeof publicRecord(input).coinbase === "string") ? "Coinbase · block reward" : "Transaction";
}
export function shieldedComponentCounts(decoded: unknown) {
  const transaction = publicRecord(decoded), orchard = publicRecord(transaction.orchard);
  return {
    saplingSpends: Array.isArray(transaction.vShieldedSpend) ? transaction.vShieldedSpend.length : null,
    saplingOutputs: Array.isArray(transaction.vShieldedOutput) ? transaction.vShieldedOutput.length : null,
    orchardActions: Array.isArray(orchard.actions) ? orchard.actions.length : null,
  };
}
export function publicOutputPreview(vout: unknown) {
  if (!Array.isArray(vout)) return null;
  return { total: vout.length, items: vout.slice(0, 2).map(value => {
    const output = publicRecord(value), script = publicRecord(output.scriptPubKey);
    const addresses = Array.isArray(script.addresses) ? script.addresses.filter((a): a is string => typeof a === "string") : typeof script.address === "string" ? [script.address] : [];
    return {
      destination: addresses.length ? addresses.join(", ") : typeof script.type === "string" ? `${script.type} script` : "Address not exposed by this script",
      amount: typeof output.value === "string" ? `${output.value} test ZEC` : typeof output.valueZat === "string" ? `${output.valueZat} zatoshis` : "Value not supplied",
    };
  }) };
}
