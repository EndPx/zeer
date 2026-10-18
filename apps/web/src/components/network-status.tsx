"use client";
import Link from "next/link";
import { Blocks, Clock3, RefreshCw, ArrowUpRight, Radio } from "lucide-react";
import { syncMetrics, percentLabel, type ConsoleStatus } from "@/lib/sync-status";

const number = (n: number | null) => n === null ? "—" : n.toLocaleString("en-US");
function Meter({ label, value, detail }: { label: string; value: number | null; detail: string }) {
  return <div className="sync-meter">
    <div className="sync-meter-label"><span>{label}</span><strong>{percentLabel(value)}</strong></div>
    <div className="sync-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined} aria-valuetext={percentLabel(value)}>
      {value !== null && <span style={{ transform: `scaleX(${value / 100})` }} />}
    </div>
    <p>{detail}</p>
  </div>;
}

export function NetworkStatus({ status, loading, error, refresh }: {
  status: ConsoleStatus | null; loading: boolean; error: string; refresh: () => void;
}) {
  const m = syncMetrics(status);
  const following = m.following && !error;
  const state = !status ? "Checking source" : error ? "Refresh failed" : following ? "Following" : status.prep.available ? "Source not live" : status.prep.configured ? "Unavailable" : "Not connected";
  const blocks = status?.recentBlocks ?? [];
  return <>
    <section className="network-status" aria-labelledby="network-status-title">
      <div className="network-status-top">
        <div className="network-identity"><span className="network-mark" aria-hidden="true"><Blocks size={22} /></span><div><h2 id="network-status-title">Zcash Testnet</h2><span>Public blockchain data</span></div></div>
        <div className="network-actions"><span className={`source-state ${following ? "is-live" : ""}`}><Radio size={14} />{state}</span><button className="copy" onClick={refresh} disabled={loading} aria-label="Refresh network status"><RefreshCw size={15} className={loading ? "spin" : ""} /><span>Refresh</span></button></div>
      </div>
      <div className="network-meters">
        <Meter label="History available" value={m.historyPercent} detail={m.total === null ? "Waiting for a fresh source tip." : `${number(m.count)} of ${number(m.total)} chain blocks available`} />
        <Meter label="Chef indexing" value={m.chefPercent} detail={m.chefCount === null ? "No comparable Chef checkpoint available." : `${number(m.chefCount)} of ${number(m.count)} available Prep blocks processed`} />
      </div>
      <dl className="network-facts">
        <div><dt>Prep range</dt><dd>{m.count === null ? "Unknown" : `${number(m.start)} – ${number(m.head)}`}</dd></div>
        <div><dt>Source tip</dt><dd>{number(m.tip)}</dd></div>
        <div><dt>Source → Prep gap</dt><dd>{m.sourceLag === null ? "Unknown" : `${number(m.sourceLag)} blocks`}</dd></div>
        <div><dt>Prep → Chef gap</dt><dd>{m.chefLag === null ? "Unknown" : `${number(m.chefLag)} blocks`}</dd></div>
      </dl>
      <div className="network-status-foot"><span className="coverage-note">{m.start !== null && m.start > 0 ? `Partial archive · blocks 0–${number(m.start - 1)} are not indexed.` : m.historyPercent === 100 ? "Complete history through the observed source tip." : m.sourceLag !== null ? `${number(m.sourceLag)} source blocks are not in the indexed range yet.` : "Indexed range shown above. A fresh source tip is not available."}</span><span><Clock3 size={13} />{status?.checkedAt ? `Checked ${new Date(status.checkedAt).toLocaleTimeString("en-GB")}` : "Awaiting first observation"}</span></div>
      {error && <p className="error-note" role="alert">{error} Values shown are from the last successful refresh.</p>}
    </section>
    <section className="recent-blocks" aria-labelledby="recent-blocks-title">
      <div className="recent-blocks-heading"><div><h2 id="recent-blocks-title"><Blocks size={17} />Latest indexed blocks</h2><p>Headers returned by Prep. Select a block to inspect its data.</p></div><span>Refreshes every 15s while visible</span></div>
      {status?.recentBlocksAvailable && blocks.length > 0 ? <div className="block-rail">{blocks.map(block => <Link key={block.hash} href={`/app/prep?from=${block.height}&to=${block.height + 1}`} className="block-tile" aria-label={`Inspect block ${number(block.height)}`} title={`Block hash: ${block.hash}`}><span className="block-tile-top"><Blocks size={17} /><ArrowUpRight size={14} /></span><strong>{number(block.height)}</strong><span className="block-time">{new Date(block.time * 1000).toLocaleTimeString("en-GB", { timeZone: "UTC" })} UTC</span></Link>)}</div> : <p className="recent-blocks-empty">{!status ? "Reading indexed block headers…" : "Recent block headers are unavailable. No sample data is displayed."}</p>}
    </section>
  </>;
}
