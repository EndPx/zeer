"use client";
import { useEffect, useRef, useState } from "react";
import {
  Braces,
  ChevronDown,
  Info,
  Play,
  Square,
  ShieldCheck,
  ArrowRight,
  RotateCcw,
} from "lucide-react";
import { Code } from "./ui";
import { CopyButton } from "./interactive";
import { chefQuery } from "@/lib/content";
import type { ChefDemo } from "@/lib/chef-demo";
import { chefExampleCursor, chefExampleQuery, chefResponseEmpty } from "@/lib/chef-pagination";
import { chefExamples, chefBlockHeight, chefPresetQuery, type ChefExample } from "@/lib/chef-examples";
import { memoPreview, type ChefMemoDemo } from "@/lib/chef-memo-demo";
import { useConsoleStatus } from "@/lib/use-console-status";
import { syncMetrics } from "@/lib/sync-status";
export function ChefPlayground({ enabled, demo, memoDemo }: { enabled: boolean; demo?: ChefDemo | null; memoDemo?: ChefMemoDemo | null }) {
  const coverage = useConsoleStatus();
  const metrics = syncMetrics(coverage.status);
  const [example, setExample] = useState<ChefExample>("browse");
  const [blockHeight, setBlockHeight] = useState("4515166");
  const [latestHeight, setLatestHeight] = useState<number | null>(null);
  const selected = chefExamples.find(item => item.id === example)!;
  const connected = example === "memos" ? !!memoDemo : enabled;
  const [query, setQuery] = useState(chefQuery),
    [exampleAfter, setExampleAfter] = useState<string>(),
    [result, setResult] = useState<unknown>(),
    [duration, setDuration] = useState<number | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [stale, setStale] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const nextCursor = !stale && !error ? chefExampleCursor(query, result, exampleAfter) : null;
  const memo = example === "memos" && !stale && !error ? memoPreview(result, memoDemo?.txid) : null;
  function edit(nextQuery: string) {
    abort.current?.abort();
    setBusy(false);
    setQuery(nextQuery);
    setExampleAfter(undefined);
    setStale(true);
    setError("");
  }
  function chooseExample(id: ChefExample) {
    const height = chefBlockHeight(blockHeight) ?? 4515166;
    const next = chefPresetQuery(id, height, metrics.checkpoint, memoDemo?.txid);
    if (next === null) return;
    if (id === "height") setBlockHeight(String(height));
    setExample(id);
    setLatestHeight(id === "latest" ? metrics.checkpoint : null);
    edit(next);
  }
  async function run(nextQuery = query) {
    if (!connected || busy) return;
    const c = new AbortController();
    abort.current = c;
    setBusy(true);
    setError("");
    setResult(undefined);
    setStale(false);
    setDuration(null);
    const started = performance.now();
    try {
      const r = await fetch("/api/chef", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: nextQuery }),
        signal: c.signal,
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error || "Query failed");
      if (!c.signal.aborted && abort.current === c) {
        setResult(data);
        setDuration(performance.now() - started);
      }
    } catch (e) {
      if (!c.signal.aborted)
        setError(e instanceof Error ? e.message : "Query failed");
    } finally {
      if (abort.current === c) setBusy(false);
    }
  }
  return (
    <>
      <div className="console-title">
        <span className="eyebrow">Zeer Chef</span>
        <h1>Your schema. Your playground.</h1>
        <p>Choose an example and run it against real indexed testnet data. Edit the query to explore your own application API.</p>
      </div>
      {demo && <div className="notice demo-coverage">
        <Info size={16} aria-hidden="true" />
        <div><strong>{demo.toBlock === null ? `Zcash testnet · ${demo.fromBlock.toLocaleString("en-US")} → latest` : `Fixed testnet demo · ${demo.fromBlock.toLocaleString("en-US")}–${demo.toBlock.toLocaleString("en-US")}`}</strong>
          <p role="status">{metrics.checkpoint !== null ? `Indexed range: ${demo.fromBlock.toLocaleString("en-US")}–${metrics.checkpoint.toLocaleString("en-US")}. ` : coverage.loading ? "Reading the saved checkpoint… " : "Checkpoint unavailable. "}{coverage.error ? "Last observation may be stale. " : ""}Namespace <code>{demo.project}</code>. {demo.toBlock === null ? "Follows new Prep blocks automatically. " : "This is a fixed demonstration range. "}<code>_meta.height</code> reports the committed checkpoint.</p>
          <p>Prep → Chef handlers → PostgreSQL → GraphQL. Block summaries are public chain data. {memoDemo ? "The memo example publishes a selected receipt from Zeer's own demo wallet." : "Shielded note values remain encrypted in public chain data."}</p>
          <button className="copy" disabled={coverage.loading} onClick={() => void coverage.refresh()}>Refresh coverage</button>
        </div>
      </div>}
      {!enabled && (
        <div className="notice">
          <Info size={16} />
          <span>
            A Chef service is not connected. Connect your backend to query real
            application data.
          </span>
        </div>
      )}
      <section className="network-status chef-examples" aria-label="Chef query examples">
        <h2>Try an example</h2>
        <p className="field-hint">Select a query to fill the editor, then press Run query.</p>
        <div className="format-tabs" aria-label="Query examples">{chefExamples.filter(item => item.id !== "memos" || memoDemo).map(item => <button key={item.id} aria-pressed={example === item.id} disabled={item.id === "latest" && metrics.checkpoint === null} onClick={() => chooseExample(item.id)}>{item.name}{item.id === "latest" && metrics.checkpoint === null ? " · reading checkpoint…" : ""}</button>)}</div>
        <p className="field-hint">{selected.description}</p>
        {example === "height" && <label className="chef-height-field" htmlFor="chef-block-height">Block height<input id="chef-block-height" type="number" min={0} max={2147483647} step={1} inputMode="numeric" value={blockHeight} aria-invalid={chefBlockHeight(blockHeight) === null} onChange={event => {
          setBlockHeight(event.target.value);
          const height = chefBlockHeight(event.target.value);
          edit(height === null ? "" : chefPresetQuery("height", height)!);
        }}/>{chefBlockHeight(blockHeight) === null && <span className="field-hint">Enter a whole height from 0 to 2,147,483,647.</span>}</label>}
        {example === "latest" && latestHeight !== null && <p className="field-hint">Query targets block {latestHeight.toLocaleString("en-US")}, captured when you selected this example. Your editor stays unchanged as indexing advances.</p>}
        {example === "memos" && memoDemo && <div className="field-hint">
          <p><ShieldCheck size={14} aria-hidden="true" /> Ironwood · testnet block {memoDemo.blockHeight.toLocaleString("en-US")} · <a className="text-link" href={`/app/prep?view=transaction&txid=${memoDemo.txid}`}>Inspect transaction <ArrowRight size={14} /></a></p>
          <p>Chef read this note with Zeer's demo viewing key in a local scanner. Only the selected demo receipt is published here. Your viewing key stays in your environment.</p>
          <a className="text-link" href="https://github.com/EndPx/zeer/tree/main/examples/shielded-inbox">Read your own memos with Chef <ArrowRight size={14} /></a>
        </div>}
      </section>
      <div className="graphql-workspace">
        <div className="panel-toolbar">
          <strong>
            <Braces size={16} /> GraphQL query
          </strong>
          <div className="toolbar-actions">
            <button className="copy" onClick={() => chooseExample(example)}><RotateCcw size={14} />Restore example</button>
            <CopyButton text={query} />
            <button
              className="button compact"
              disabled={!connected || !query.trim()}
              onClick={
                busy
                  ? () => {
                      abort.current?.abort();
                      setBusy(false);
                      setError("Query cancelled.");
                    }
                  : () => void run()
              }
            >
              {busy ? <Square size={13} /> : <Play size={13} />}{" "}
              {busy ? "Cancel" : "Run query"}
            </button>
          </div>
        </div>
        <div className="graphql-columns">
          <aside className="schema-panel">
            <span className="small-label">Example schema</span>
            <details open>
              <summary>
                <ChevronDown size={13} />
                {example === "memos" ? "ReadableNote" : "BlockSummary"}
              </summary>
              {(example === "memos" ? ["id: ID!", "txid: String!", "pool: String!", "outputIndex: Int!", "blockHeight: Int!", "valueZat: BigInt!", "receiver: String!", "memoKind: String!", "memoText: String", "scope: String!", "origin: String!", "coinbase: Boolean!"] : [
                "id: ID!",
                "height: Int!",
                "hash: String!",
                "time: BigInt!",
                "transactionCount: Int!",
              ]).map((f) => (
                <div key={f}>{f}</div>
              ))}
            </details>
            <div className="schema-hint">
              {example === "memos" ? "From the shielded-inbox schema. _meta describes this demo projection's checkpoint." : "From the starter schema."}
              <br />
              Runtime introspection is not enabled.
            </div>
          </aside>
          <div className="editor-pane">
            <div className="pane-label">
              Query <span>Ctrl / ⌘ + Enter</span>
            </div>
            <label htmlFor="graphql-query" className="sr-only">
              GraphQL query
            </label>
            <textarea
              id="graphql-query"
              spellCheck={false}
              value={query}
              onChange={(e) => {
                edit(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void run();
                }
              }}
            />
          </div>
          <div className="result-pane">
            <div className="pane-label">
              <span>{stale && result
                  ? "Previous response · edited query"
                  : "Response"}</span>
              {result !== undefined && <CopyButton text={JSON.stringify(result, null, 2)} label="Copy response" />}
            </div>
            {error ? (
              <div className="error-note" role="alert">
                {error}
              </div>
            ) : result !== undefined ? (
              <>
              {memo && <div className="response-help" role="status"><strong>Decrypted memo</strong><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{memo.text}</p><span>{memo.valueZat} zatoshi · Zeer demo receipt</span></div>}
              {!stale && chefResponseEmpty(result) && <p className="response-help" role="status">Query succeeded. No entities matched. {example === "memos" ? "This demo contains only the selected Zeer receipt. Restore the example, or run shielded-inbox locally to query your own wallet's notes." : demo && metrics.checkpoint !== null ? `The observed indexed range is ${demo.fromBlock.toLocaleString("en-US")}–${metrics.checkpoint.toLocaleString("en-US")}. Try a height within that range, check the filters, or restore the example.` : "Check your filters and the indexed checkpoint, or restore the example."}</p>}
              <Code
                code={JSON.stringify(result, null, 2)}
              />
              </>
            ) : (
              <div className="empty-response">
                <Braces size={32} />
                <h3>
                  {busy ? "Reading your entities…" : "Your data appears here."}
                </h3>
                <p>
                  {connected
                    ? "Run a query to inspect the actual response."
                    : "Connect a Chef service to run queries against your application data."}
                </p>
              </div>
            )}
          </div>
        </div>
        <div className="panel-foot">
          <span className="mode-pill">
            {connected
                ? "Connected backend"
                : "Not connected"}
          </span>
          <span>
            {busy
                ? "Query in progress…"
                : duration !== null && result !== undefined
                  ? `${Math.round(duration).toLocaleString("en-US")} ms round trip · read-only query`
                  : "Read-only queries · no subscriptions"}
          </span>
        </div>
      </div>
      {nextCursor && <div className="query-pagination">
        <span>More indexed blocks are available. The next page updates and runs the example query.</span>
        <button className="button secondary compact" disabled={busy} onClick={() => {
          const nextQuery = chefExampleQuery(nextCursor);
          setQuery(nextQuery);
          setExampleAfter(nextCursor);
          void run(nextQuery);
        }}>Next example page <ArrowRight size={14} /></button>
      </div>}
      <p className="privacy-note">
        <ShieldCheck size={15} /> Your API credentials stay on the server.
      </p>
    </>
  );
}
