"use client";
import { useState } from "react";
import { Code } from "./ui";
import { CopyButton } from "./interactive";
import { ResultTable } from "./result-table";
import Link from "next/link";
import type { Example } from "@/lib/content";
import { publicRecord as record, utcTimestamp, transactionKind, publicOutputPreview, shieldedComponentCounts } from "@/lib/prep-table";

type Row = Record<string, unknown>;
const labels: Record<string, string> = { height: "Block", hash: "Block hash", time: "Timestamp (UTC)", block_height: "Block", txid: "Transaction hash", vin: "Transaction type", vout: "Transparent outputs", index: "Position in block", size_bytes: "Size (bytes)", version: "Version", locktime: "Lock time", transparent_input_count: "Input entries", transparent_output_count: "Output entries" };

export function PrepResponse({ value, stale, duration, blocks, scanFrom, example }: {
  value: unknown; stale: boolean; duration: number | null; blocks: boolean; scanFrom: number; example: Example;
}) {
  const [view, setView] = useState("Table");
  const response = record(value);
  const data = record(response.data);
  const items = blocks ? data.blocks : data.transactions ?? response.transactions;
  const rows: Row[] = Array.isArray(items) ? items.map(record) : [];
  const blockRows: Row[] = Array.isArray(data.blocks) ? data.blocks.map(record) : [];
  const blockByHeight = new Map(blockRows.map(block => [String(block.height), block]));
  const fields = blocks ? ["height", "time", "hash"] : ["block_height", "time", "txid", "transaction_type", "is_coinbase", "expiry_height", "sapling_spend_count", "sapling_output_count", "orchard_action_count", "ironwood_action_count", "vin", "vout", "decoded", "raw", "index", "size_bytes", "version", "locktime", "transparent_input_count", "transparent_output_count"];
  const columns = fields.filter(field => !blocks && field === "time" ? blockRows.some(block => "time" in block) : rows.some(row => field in row));
  function cell(row: Row, field: string) {
    const block = blocks ? row : blockByHeight.get(String(row.block_height));
    if (field === "transaction_type") return row.transaction_type==="coinbase" ? "Coinbase · block reward" : String(row.transaction_type ?? "Not supplied");
    if (field === "is_coinbase") return row.is_coinbase===true ? "Block reward" : row.is_coinbase===false ? "No" : "Not supplied";
    if (field === "decoded") {
      const counts = shieldedComponentCounts(row.decoded);
      return <div className="component-counts">
        {!["orchard", "ironwood"].includes(example) && <><span>Sapling spends: {counts.saplingSpends ?? "—"}</span><span>Sapling outputs: {counts.saplingOutputs ?? "—"}</span></>}
        {!["sapling", "ironwood"].includes(example) && <span>Orchard actions: {counts.orchardActions ?? "—"}</span>}
      {!["sapling", "orchard"].includes(example) && <span>Ironwood actions: {counts.ironwoodActions ?? "—"}</span>}
      </div>;
    }
    if (field === "raw") return typeof row.raw === "string" ? <div><code className="raw-preview">{row.raw.slice(0, 32)}{row.raw.length > 32 ? "…" : ""}</code><small className="table-secondary">{row.raw.length / 2} bytes · full hex in JSON</small></div> : "Not supplied";
    if (field === "time") {
      const time = utcTimestamp(block?.time);
      return time === "—" ? time : <time dateTime={time.replace(" ", "T") + "Z"}>{time.slice(0, 10)}<small className="table-secondary">{time.slice(11)} UTC</small></time>;
    }
    if (field === "vin") return transactionKind(row.vin) === "Coinbase · block reward" ? <span className="transaction-kind">Coinbase<small className="table-secondary">Block reward</small></span> : <span className="transaction-kind">{transactionKind(row.vin)}</span>;
    if (field === "vout") {
      const preview = publicOutputPreview(row.vout);
      if (!preview) return "Not supplied";
      if (!preview.total) return "No transparent outputs";
      return <div className="public-output-list">{preview.items.map((output, index) => <div key={index}><span className="output-destination" title={output.destination}>{output.destination}</span><small>{output.amount}</small></div>)}{preview.total > 2 && <small>+{preview.total - 2} more · see JSON</small>}</div>;
    }
    if (field === "block_height" || field === "height") return <>{String(row[field] ?? "—")}{!blocks && typeof block?.hash === "string" && <small className="table-block-hash" title={block.hash}>{block.hash.slice(0, 12)}…</small>}</>;
    if (field === "txid") return <Link className="table-hash text-link" href={`/app/prep?view=transaction&txid=${String(row.txid)}`} title={String(row.txid)}>{String(row.txid)}</Link>;
    if (field === "hash") return <span className="table-hash" title={String(row[field] ?? "")}>{String(row[field] ?? "—")}</span>;
    return row[field] === undefined || row[field] === null ? "—" : String(row[field]);
  }
  const more = typeof response.cursor === "string" && response.cursor.length > 0;
  const complete = response.cursor === null || response.complete === true;
  const scannedTo = typeof response.next_block === "number" ? response.next_block - 1 : null;
  const json = JSON.stringify(value, null, 2);
  return <section className="code-panel response-panel" aria-label="Prep response">
    <div className="panel-toolbar response-toolbar">
      <strong>{stale ? "Previous response · inputs changed" : "Response"}</strong>
      <div className="toolbar-actions">
        <div className="format-tabs" aria-label="Response format">
          {["Table", "JSON"].map(format => <button key={format} aria-pressed={view === format} onClick={() => setView(format)}>{format}</button>)}
        </div>
        <CopyButton text={json} label="Copy JSON" />
      </div>
    </div>
    <div className="response-summary" role="status">
      <span>{rows.length.toLocaleString("en-US")} {blocks ? rows.length === 1 ? "block" : "blocks" : rows.length === 1 ? "transaction" : "transactions"} returned</span>
      {duration !== null && <span>{Math.round(duration).toLocaleString("en-US")} ms round trip</span>}
      <span>{more ? "More pages available" : complete ? "Requested range complete" : "Inspect response coverage"}</span>
      {scannedTo !== null && scannedTo >= scanFrom && <span>Scanned blocks {scanFrom.toLocaleString("en-US")}–{scannedTo.toLocaleString("en-US")}</span>}
    </div>
    {view === "JSON" ? <Code code={json} /> : rows.length === 0 ?
      <div className="table-empty"><strong>Query succeeded. No matches in this page.</strong><p>{["orchard", "sapling", "ironwood", "shielded"].includes(example) && scanFrom === 0 ? `The first blocks predate ${example === "orchard" ? "Orchard" : example === "sapling" ? "Sapling" : example === "ironwood" ? "Ironwood" : "Sapling, Orchard and Ironwood"}. Continue paging or use a recent block range to explore their activity.` : more ? "This page contains no matches. Continue to the next page to search more of the selected range." : "No transactions matched your filters in the scanned range."}</p></div> :
      <ResultTable key={`${scanFrom}:${response.next_block}:${columns.join(",")}`} rows={rows} columns={columns} blocks={blocks} cell={cell}
        label={field => field === "sapling_spend_count" ? "Sapling spends" : field === "sapling_output_count" ? "Sapling outputs" : field === "orchard_action_count" ? "Orchard actions" : field === "ironwood_action_count" ? "Ironwood actions" : field === "decoded" ? example === "sapling" ? "Sapling components" : example === "orchard" ? "Orchard actions" : "Shielded components" : field === "raw" ? "Serialized transaction" : field === "transaction_type" ? "Type" : field === "is_coinbase" ? "Block reward" : field === "expiry_height" ? "Expiry height" : labels[field]} />}
    <div className="panel-foot">
      <span>One response · public Zcash testnet data</span>
      {typeof response.next_block === "number" && <span>Next block: {response.next_block.toLocaleString("en-US")}</span>}
    </div>
    {more && <p className="response-help">Only this page has been scanned. {rows.length === 0 ? "Later pages may still contain matches. " : ""}Continue with Next page or pass the cursor with the same query in your client.</p>}
    {columns.includes("index") && <p className="response-help">Position in block starts at 0. A coinbase transaction creates the block reward and occupies the first position; this is not a result counter.</p>}
    {columns.includes("vout") && <p className="response-help">Outputs shown here are transparent. A transaction can also contain shielded outputs whose recipients and individual values are not exposed.</p>}
    {columns.includes("decoded") && <p className="response-help">These are public component counts, not payment counts or decrypted notes. The full decoded public transaction is available in JSON; recipients and memos remain encrypted.</p>}
    {columns.some(field => ["sapling_spend_count", "sapling_output_count", "orchard_action_count", "ironwood_action_count"].includes(field)) && <p className="response-help">Public Spend/Output/Action descriptions may include dummy components. They are not payment counts. Shielded recipients, individual note values and memos remain encrypted. Select Decoded public transaction only when your application needs the complete public payload.</p>}
  </section>;
}
