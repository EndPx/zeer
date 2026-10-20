"use client";
import { useCallback,useEffect,useRef,useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight,RefreshCw,Search,ShieldCheck,Download,Clock3 } from "lucide-react";
import { CopyButton } from "./interactive";
import { Code } from "./ui";
import { record,list,integer,outputZat,outputDestination,formatZat,transparentTotal,pools,publicFee,coinbaseValue,kindLabel } from "@/lib/transaction-view";
import { useAppOrigin } from "@/lib/use-app-origin";

const sampleIronwood="18c74b0ba10ff8d02b84ee68decb135b2cc5f064d0b1f7f48c4d5d1429bb00db";
const sampleCoinbase="0c1ebeca5f1f1168e03a6b845d1b9531efc5ffe85b4e949d3951b86dd4122af7";
const when=(v:unknown)=>integer(v)!==null&&Number(integer(v))>0?new Date(Number(integer(v))*1000).toLocaleString("en-GB",{timeZone:"UTC"})+" UTC":"Not provided";
export function TransactionInspector({initialId,enabled}:{initialId:string;enabled:boolean}) {
  const router=useRouter(),origin=useAppOrigin();
  const [input,setInput]=useState(initialId),[result,setResult]=useState<Record<string,unknown>|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[tab,setTab]=useState("Overview"),[raw,setRaw]=useState("Decoded JSON");
  const pending=useRef<AbortController|null>(null);
  const refresh=useCallback(async()=>{
    if(!enabled)return;
    if(initialId&&!/^[0-9a-f]{64}$/.test(initialId)){setError("Enter exactly 64 hexadecimal characters; the ID from this link is invalid.");return;}
    pending.current?.abort();const c=new AbortController();pending.current=c;setBusy(true);setError("");
    try {
      const r=await fetch(`/api/prep/${initialId?"transaction":"mempool"}`,{method:initialId?"POST":"GET",headers:{"Content-Type":"application/json"},...(initialId?{body:JSON.stringify({txid:initialId})}:{}),cache:"no-store",signal:AbortSignal.any([c.signal,AbortSignal.timeout(15000)])});
      const body=await r.json();if(!r.ok)throw new Error(typeof body.error==="string"?body.error:body.error?.message??"The node observation could not finish.");
      if(body.network!=="testnet")throw new Error("The source did not return testnet data.");
      if(!c.signal.aborted)setResult(body);
    } catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:"Refresh failed. Retry shortly.");}
    finally{if(pending.current===c){pending.current=null;setBusy(false);}}
  },[initialId,enabled]);
  useEffect(()=>{
    void refresh();const visible=()=>{if(document.visibilityState==="visible"&&!pending.current)void refresh();};
    const timer=setInterval(visible,10000);document.addEventListener("visibilitychange",visible);
    return()=>{clearInterval(timer);document.removeEventListener("visibilitychange",visible);pending.current?.abort();};
  },[refresh]);
  function inspect(id=input){const clean=id.trim().toLowerCase();if(!/^[0-9a-f]{64}$/.test(clean))return;if(clean===initialId)void refresh();else router.push(`/app/transactions?txid=${clean}`);}
  const tx=record(result?.transaction),decoded=record(result?.decoded),active=pools(decoded),coinbase=tx.is_coinbase===true;
  const hasTx=!!result?.transaction,status=result?.status;
  const inputs=list(decoded.vin).filter(v=>typeof v.coinbase!=="string"),outputs=list(decoded.vout);
  const fee=publicFee(decoded,coinbase);
  return <>
    <div className="console-title"><span className="eyebrow">Public transaction explorer</span><h1>Read the transaction.</h1><p>Inspect block rewards and public shielded structure. Pending observations come directly from the configured testnet node.</p></div>
    <form className="transaction-search" onSubmit={e=>{e.preventDefault();inspect();}}>
      <label htmlFor="transaction-id">Transaction ID<input id="transaction-id" value={input} maxLength={64} spellCheck={false} placeholder="64 hexadecimal characters" onChange={e=>setInput(e.target.value)}/></label>
      <button className="button compact" disabled={!enabled||!/^[0-9a-fA-F]{64}$/.test(input.trim())}><Search size={15}/>Inspect transaction</button>
    </form>
    <div className="transaction-examples"><span className="small-label">Real testnet examples</span><button className="text-link" onClick={()=>inspect(sampleIronwood)}>Orchard + Ironwood <ArrowRight size={14}/></button><button className="text-link" onClick={()=>inspect(sampleCoinbase)}>Block reward <ArrowRight size={14}/></button>{initialId&&<Link className="text-link" href="/app/transactions">View mempool <ArrowRight size={14}/></Link>}</div>
    {!enabled&&<p className="notice">Connect a Prep backend with its optional live source configured to inspect node observations.</p>}
    <div className="transaction-status-line"><span role="status">{busy?"Refreshing node observation…":error?"Refresh unavailable":result?`Observed ${when(result.observed_at)}`:"Waiting for the configured source"}</span><button className="copy" disabled={busy||!enabled} onClick={()=>void refresh()}><RefreshCw size={14}/>Refresh</button></div>
    {error&&<p className="error-note" role="alert">{error}{result?" The last successful observation below is stale.":" The source may be unavailable or live lookup may not be configured. Retry with Refresh."}</p>}
    {!initialId&&result&&<section className="network-status" aria-label="Mempool observations"><h2>Pending in this node’s mempool</h2><p className="field-hint">{String(result.source_total??0)} transactions observed · up to {String(result.max_rows??20)} rows per observation. Refreshes every 10 seconds while visible. Entries may leave before they can be decoded.</p>
      {list(result.transactions).length?<div className="result-table-scroll" tabIndex={0}><table className="result-table"><thead><tr><th>Type</th><th>Transaction</th><th>Size</th><th>Observation</th></tr></thead><tbody>{list(result.transactions).map(row=><tr key={String(row.txid)}><td>{kindLabel(row.transaction_type)}</td><td><Link className="text-link table-hash" title={String(row.txid)} href={`/app/transactions?txid=${String(row.txid)}`}>{String(row.txid)}</Link></td><td>{String(row.size_bytes)} bytes</td><td>{row.source_first_seen_at?`Source first seen ${when(row.source_first_seen_at)}`:`Observed ${when(result.observed_at)}`}</td></tr>)}</tbody></table></div>:<p className="table-empty">No pending rows were observed in this response. This is a current node observation, not a history of failed transactions.</p>}
      {!!result.has_more&&<p className="response-help">This is a bounded view of a larger mempool; use a transaction ID to inspect an individual entry.</p>}
    </section>}
    {initialId&&result&&<>
      <div className="transaction-id"><code>{initialId}</code><CopyButton text={initialId} label="Copy ID"/><CopyButton text={`${origin}/app/transactions?txid=${initialId}`} label="Share"/></div>
      <div className="transaction-badges"><span className="mode-pill">Zcash Testnet</span><span className="mode-pill">{error?"Stale observation":status==="pending"?"Pending in mempool":status==="mined"?`Mined · ${String(result.confirmations)} confirmations`:"Not observed by source"}</span>{hasTx&&<span className="mode-pill">{kindLabel(tx.transaction_type)}</span>}{active.map(p=><span className="mode-pill" key={p.name}>{p.name}</span>)}</div>
      {status==="not_observed"?<div className="notice">The configured node did not find this transaction in its current lookup and mempool. This does not mean it failed, never existed, or is pending. Check the ID or refresh; the source view can change.</div>:hasTx&&<>
        <section className="network-status transaction-flow" data-state={status} aria-label="Transaction summary">{status==="pending"?<Clock3 size={24}/>:<ShieldCheck size={24}/>}<div><h2>{coinbase?"Block reward creation":status==="pending"?"Pending inclusion in a block":kindLabel(tx.transaction_type)+" transaction"}</h2><p>{coinbase?"Identified from the actual coinbase input. A block reward can create transparent outputs or enter a shielded pool.":status==="pending"?"The node currently observes this transaction in its mempool. It has no confirmed block yet; this page refreshes automatically.":"Public transaction structure is available below. Shielded recipients and individual note values remain encrypted."}</p>{coinbase&&<p><strong>{formatZat(coinbaseValue(decoded))}</strong> in public outputs and net shielded-pool inflows.</p>}</div></section>
        <div className="format-tabs transaction-tabs" aria-label="Transaction view">{["Overview","Inputs / outputs","Raw"].map(name=><button key={name} aria-pressed={tab===name} onClick={()=>setTab(name)}>{name}</button>)}</div>
        {tab==="Overview"&&<section className="network-status"><dl className="transaction-facts">
          <div><dt>Block</dt><dd>{result.block_height!==null&&result.block_height!==undefined?<Link className="text-link" href={`/app/prep?example=headers&from=${result.block_height}&to=${Number(result.block_height)+1}`}>#{String(result.block_height)}</Link>:"Awaiting inclusion"}</dd></div>
          <div><dt>Block timestamp</dt><dd>{status==="pending"?"Awaiting inclusion":when(decoded.blocktime)}</dd></div><div><dt>Fee</dt><dd>{formatZat(fee)}</dd>{fee===null&&<small>Requires input values not resolved by this view.</small>}</div>
          <div><dt>Size</dt><dd>{String(tx.size_bytes)} bytes</dd></div><div><dt>Version</dt><dd>{String(tx.version)}</dd></div><div><dt>Lock time</dt><dd>{String(decoded.locktime??"Not provided")}</dd></div><div><dt>Expiry height</dt><dd>{String(decoded.expiryheight??"Not provided")}</dd></div><div><dt>Block hash</dt><dd className="transaction-hash">{String(result.block_hash??"Awaiting inclusion")}</dd></div>
        </dl>{active.length>0&&<><h3>Public shielded-pool components</h3><div className="transaction-pools">{active.map(pool=><article key={pool.name}><strong>{pool.name}</strong><p>{pool.actions} public descriptions</p><small>{pool.balance===null?"Pool balance not provided":`${formatZat(-pool.balance)} net ${pool.balance<0n?"entering":"leaving"} pool`}</small></article>)}</div><p className="response-help">Public net pool movements include fees and cross-pool effects. Component counts may contain dummy actions; they do not reveal the amount of any individual shielded note.</p></>}</section>}
        {tab==="Inputs / outputs"&&<div className="transaction-io"><section className="network-status"><h2>{coinbase?"Coinbase creation input":`Transparent inputs · ${inputs.length}`}</h2>{coinbase?<p>A coinbase input creates the block reward; it does not spend a previous output.</p>:inputs.length?inputs.map((entry,i)=><p className="transaction-reference" key={i}><Link className="text-link" href={`/app/transactions?txid=${String(entry.txid)}`}>{String(entry.txid)}:{String(entry.vout)}</Link></p>):<p>No transparent inputs. Public shielded descriptions do not expose a universal sender address.</p>}{active.map(pool=><p key={pool.name}>{pool.name}: {pool.actions} descriptions · private note values encrypted</p>)}</section>
          <section className="network-status"><h2>Transparent outputs · {outputs.length}</h2><p>{formatZat(transparentTotal(decoded))} total in public outputs</p>{outputs.map((entry,i)=><div className="transaction-output" key={i}><span>#{String(entry.n??i)}</span><code>{outputDestination(entry)}</code><strong>{formatZat(outputZat(entry))}</strong></div>)}{active.length>0&&<p>Shielded outputs are represented by the public pool components above; their recipients are encrypted.</p>}</section></div>}
        {tab==="Raw"&&<section className="code-panel"><div className="panel-toolbar"><div className="format-tabs">{["Decoded JSON","Hex"].map(name=><button key={name} aria-pressed={raw===name} onClick={()=>setRaw(name)}>{name}</button>)}</div><CopyButton text={raw==="Hex"?String(decoded.hex??""):JSON.stringify(decoded,null,2)}/><button className="copy" onClick={()=>{const blob=new Blob([JSON.stringify(result,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${initialId}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}><Download size={14}/>Export JSON</button></div><Code code={raw==="Hex"?String(decoded.hex??"Not provided"):JSON.stringify(decoded,null,2)}/></section>}
      </>}
    </>}
    <p className="privacy-note"><ShieldCheck size={15}/>Read-only public data. Mempool observations are separate from Prep archive coverage and Chef checkpoints. No viewing key or transaction broadcast is used.</p>
  </>;
}
