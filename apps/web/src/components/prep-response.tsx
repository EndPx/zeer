"use client";
import { useState } from "react";
import { Code } from "./ui";
import { CopyButton } from "./interactive";

type Row = Record<string, unknown>;
function record(value: unknown): Row {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Row : {};
}

export function PrepResponse({ value, stale, duration, blocks }: {
  value: unknown; stale: boolean; duration: number | null; blocks: boolean;
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
    </div>
    {view === "JSON" ? <Code code={json} /> : rows.length === 0 ?
      <div className="table-empty"><strong>No matching rows in this response.</strong><p>Review the range and filters. Shielded details remain encrypted.</p></div> :
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
    {more && <p className="response-help">This is a partial page. Use the cursor in JSON with the Prep client to continue the same snapshot.</p>}
  </section>;
}
