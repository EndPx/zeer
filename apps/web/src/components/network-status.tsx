"use client";
import Link from "next/link";
import { Blocks, Clock3, RefreshCw, ArrowUpRight, Radio, LoaderCircle } from "lucide-react";
import { syncMetrics, percentLabel, type ConsoleStatus } from "@/lib/sync-status";

const number = (n: number | null) => n === null ? "—" : n.toLocaleString("en-US");
function PendingValue({ loading }: { loading: boolean }) {
  return loading ? <span className="metric-skeleton"><span className="sr-only">Loading…</span></span> : <span className="metric-unavailable">Not available</span>;
}
function Meter({ label, value, detail, loading }: { label: string; value: number | null; detail: string; loading: boolean }) {
  const buffering = loading && value === null;
  return <div className="sync-meter">
    <div className="sync-meter-label"><span>{label}</span><strong>{value === null ? (buffering ? "Loading…" : "Not available") : percentLabel(value)}</strong></div>
    <div className={`sync-track ${buffering ? "is-buffering" : ""}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined} aria-valuetext={value === null ? (buffering ? "Loading current status" : "Status not available") : percentLabel(value)} aria-busy={buffering}>
      {value !== null ? <span style={{ transform: `scaleX(${value / 100})` }} /> : buffering ? <span className="buffer-segment" /> : null}
    </div>
    <p>{detail}</p>
  </div>;
}

export function NetworkStatus({ status, loading, error, refresh }: {
  status: ConsoleStatus | null; loading: boolean; error: string; refresh: () => void;
}) {
  const m = syncMetrics(status);
  const following = m.following && !error;
  const state = loading ? (status ? "Updating…" : "Loading network status…") : error ? "Refresh unavailable" : following ? "Following" : status?.prep.available ? "Source updates paused" : status?.prep.configured ? "Source unavailable" : "Not connected";
  const blocks = status?.recentBlocks ?? [];
  return <>
    <section className="network-status" aria-labelledby="network-status-title">
      <div className="network-status-top">
        <div className="network-identity"><span className="network-mark" aria-hidden="true"><Blocks size={22} /></span><div><h2 id="network-status-title">Zcash Testnet</h2><span>Public blockchain data</span></div></div>
        <div className="network-actions"><span className={`source-state ${following ? "is-live" : ""}`} role="status">{loading ? <LoaderCircle size={14} className="spin" /> : <Radio size={14} />}{state}</span><button className="copy" onClick={refresh} disabled={loading} aria-label="Refresh network status"><RefreshCw size={15} /><span>Refresh</span></button></div>
      </div>
      <div className="network-meters">
        <Meter label="History available" value={m.historyPercent} loading={loading} detail={m.total === null ? (loading ? "Reading archive coverage and the latest source tip…" : "A fresh source tip is unavailable. Stored coverage is shown below when reported.") : `${number(m.count)} of ${number(m.total)} chain blocks available`} />
        <Meter label="Chef indexing" value={m.chefPercent} loading={loading} detail={m.chefCount === null ? (loading ? "Reading the saved Chef checkpoint…" : "Chef has not reported a comparable checkpoint. Retrying automatically.") : `${number(m.chefCount)} of ${number(m.count)} available Prep blocks processed`} />
      </div>
      <dl className="network-facts">
        <div><dt>Prep range</dt><dd>{m.count === null ? <PendingValue loading={loading} /> : `${number(m.start)} – ${number(m.head)}`}</dd></div>
        <div><dt>Source tip</dt><dd>{m.tip === null ? <PendingValue loading={loading} /> : number(m.tip)}</dd></div>
        <div><dt>Source → Prep gap</dt><dd>{m.sourceLag === null ? <PendingValue loading={loading} /> : `${number(m.sourceLag)} blocks`}</dd></div>
        <div><dt>Prep → Chef gap</dt><dd>{m.chefLag === null ? <PendingValue loading={loading} /> : `${number(m.chefLag)} blocks`}</dd></div>
      </dl>
      <div className="network-status-foot"><span className="coverage-note">{!status && loading ? "Connecting to Prep and Chef. Saved data will appear here shortly." : m.start !== null && m.start > 0 ? `Partial archive · blocks 0–${number(m.start - 1)} are not indexed.` : m.historyPercent === 100 ? "Complete history through the observed source tip." : m.sourceLag !== null ? `${number(m.sourceLag)} source blocks are not in the indexed range yet.` : "Waiting for the services to report their current state."}</span><span><Clock3 size={13} />{status?.checkedAt ? `${error ? "Last response" : "Checked"} ${new Date(status.checkedAt).toLocaleTimeString("en-GB")}` : loading ? "Checking now…" : "No response yet"}</span></div>
      {error && <p className="error-note" role="alert">{error}{m.count !== null ? " Values shown are from the last successful refresh." : ""}</p>}
    </section>
    <section className="recent-blocks" aria-labelledby="recent-blocks-title">
      <div className="recent-blocks-heading"><div><h2 id="recent-blocks-title"><Blocks size={17} />Latest indexed blocks</h2><p>Headers returned by Prep. Select a block to inspect its data.</p></div><span>Refreshes every 15s while visible</span></div>
      {status?.recentBlocksAvailable && blocks.length > 0 ? <div className="block-rail">{blocks.map(block => <Link key={block.hash} href={`/app/prep?example=headers&from=${block.height}&to=${block.height + 1}`} className="block-tile" aria-label={`Inspect block ${number(block.height)}`} title={`Block hash: ${block.hash}`}><span className="block-tile-top"><Blocks size={17} /><ArrowUpRight size={14} /></span><strong>{number(block.height)}</strong><span className="block-time">{new Date(block.time * 1000).toLocaleTimeString("en-GB", { timeZone: "UTC" })} UTC</span></Link>)}</div> : loading ? <div className="block-rail loading-blocks" role="status" aria-label="Loading indexed blocks">{[0,1,2,3].map(i => <div className="block-tile" aria-hidden="true" key={i}><Blocks size={17} /><span className="metric-skeleton" /><span className="metric-skeleton short" /></div>)}</div> : <p className="recent-blocks-empty">Block headers could not be loaded. Refresh to try again.</p>}
    </section>
  </>;
}
