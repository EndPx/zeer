"use client";
import { useState } from "react";
import { Code } from "./ui";
import { CopyButton } from "./interactive";
import type { Example } from "@/lib/content";

type Row = Record<string, unknown>;
function record(value: unknown): Row {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Row : {};
}

export function PrepResponse({ value, stale, duration, blocks, scanFrom, example }: {
  value: unknown; stale: boolean; duration: number | null; blocks: boolean; scanFrom: number; example: Example;
}) {
  const [view, setView] = useState("Table");
  const response = record(value);
  const data = record(response.data);
  const items = blocks ? data.blocks : data.transactions ?? response.transactions;
  const rows: Row[] = Array.isArray(items) ? items.map(record) : [];
  const fields = blocks ? ["height", "hash", "time"] : ["block_height", "txid", "index", "size_bytes"];
  const columns = fields.filter(field => rows.some(row => field in row));
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
      <span>{rows.length} {blocks ? "blocks" : "transactions"} returned</span>
      {duration !== null && <span>{Math.round(duration).toLocaleString("en-US")} ms round trip</span>}
      <span>{more ? "More pages available" : complete ? "Requested range complete" : "Inspect response coverage"}</span>
      {scannedTo !== null && scannedTo >= scanFrom && <span>Scanned blocks {scanFrom.toLocaleString("en-US")}–{scannedTo.toLocaleString("en-US")}</span>}
    </div>
    {view === "JSON" ? <Code code={json} /> : rows.length === 0 ?
      <div className="table-empty"><strong>Query succeeded. No matches in this page.</strong><p>{(example === "orchard" || example === "sapling") && scanFrom === 0 ? `The first blocks predate ${example === "orchard" ? "Orchard" : "Sapling"}. Continue paging or use a recent block range to explore its activity.` : more ? "This page contains no matches. Continue to the next page to search more of the selected range." : "No transactions matched your filters in the scanned range."}</p></div> :
      <div className="result-table-scroll" role="region" aria-label="Query result table" tabIndex={0}>
        <table className="result-table"><caption className="sr-only">Public {blocks ? "block" : "transaction"} rows returned by Prep</caption>
          <thead><tr>{columns.map(field => <th scope="col" key={field}>{field}</th>)}</tr></thead>
          <tbody>{rows.map(row => <tr key={String(row.hash ?? row.txid ?? row.height ?? JSON.stringify(row))}>
            {columns.map(field => <td key={field}>{row[field] === undefined || row[field] === null ? "—" : String(row[field])}</td>)}
          </tr>)}</tbody>
        </table>
      </div>}
    <div className="panel-foot">
      <span>One response · public Zcash testnet data</span>
      {typeof response.next_block === "number" && <span>Next block: {response.next_block.toLocaleString("en-US")}</span>}
    </div>
    {more && <p className="response-help">Only this page has been scanned. {rows.length === 0 ? "Later pages may still contain matches. " : ""}Continue with Next page or pass the cursor with the same query in your client.</p>}
  </section>;
}
