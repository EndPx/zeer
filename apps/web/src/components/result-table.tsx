"use client";
import { useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

type Row = Record<string, unknown>;
export function ResultTable({ rows, columns, label, cell, blocks }: {
  rows: Row[]; columns: string[]; label: (field: string) => string;
  cell: (row: Row, field: string) => ReactNode; blocks: boolean;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const windowed = rows.length > 100;
  const virtual = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count: rows.length,
    getScrollElement: () => scroll.current,
    getItemKey: index => String(rows[index].hash ?? rows[index].txid ?? rows[index].height ?? index),
    estimateSize: () => columns.includes("vout") ? 140 : 76,
    overscan: 8,
    enabled: windowed,
    initialRect: { height: 384, width: 0 },
  });
  const visible = virtual.getVirtualItems();
  const before = visible[0]?.start ?? 0;
  const after = visible.length ? virtual.getTotalSize() - visible[visible.length - 1].end : 0;
  const indices = windowed ? visible.map(item => item.index) : rows.map((_, index) => index);
  return <>
    {windowed && <p className="response-help">Scroll through all {rows.length.toLocaleString("en-US")} returned rows. Use JSON or Copy JSON to search or export the full response.</p>}
    <div ref={scroll} className="result-table-scroll" role="region" aria-label="Query result table" tabIndex={0}
      onKeyDown={event => {
        if (!windowed || event.target !== event.currentTarget || !["Home", "End"].includes(event.key)) return;
        event.preventDefault();
        virtual.scrollToIndex(event.key === "Home" ? 0 : rows.length - 1, { align: event.key === "Home" ? "start" : "end", behavior: "auto" });
      }}>
      <table className="result-table" aria-rowcount={rows.length + 1}>
        <caption className="sr-only">Public {blocks ? "block" : "transaction"} rows returned by Prep</caption>
        <thead><tr aria-rowindex={1}>{columns.map(field => <th scope="col" key={field}>{label(field)}</th>)}</tr></thead>
        <tbody>
          {before > 0 && <tr aria-hidden="true"><td colSpan={columns.length} className="table-spacer" style={{ height: before }} /></tr>}
          {indices.map(index => {
            const row = rows[index];
            return <tr key={String(row.hash ?? row.txid ?? row.height ?? index)} data-index={index} aria-rowindex={index + 2} ref={windowed ? virtual.measureElement : undefined}>
              {columns.map(field => <td key={field}>{cell(row, field)}</td>)}
            </tr>;
          })}
          {after > 0 && <tr aria-hidden="true"><td colSpan={columns.length} className="table-spacer" style={{ height: after }} /></tr>}
        </tbody>
      </table>
    </div>
  </>;
}
