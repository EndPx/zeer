"use client";
import { useEffect, useRef, useState } from "react";
import {
  Braces,
  ChevronDown,
  Info,
  Play,
  Square,
  ShieldCheck,
} from "lucide-react";
import { Code } from "./ui";
import { CopyButton } from "./interactive";
import { chefQuery } from "@/lib/content";
import type { ChefDemo } from "@/lib/chef-demo";
export function ChefPlayground({ enabled, demo }: { enabled: boolean; demo?: ChefDemo | null }) {
  const [query, setQuery] = useState(chefQuery),
    [result, setResult] = useState<unknown>(),
    [duration, setDuration] = useState<number | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [stale, setStale] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  async function run() {
    if (!enabled || busy) return;
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
        body: JSON.stringify({ query }),
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
        <p>Explore application data through the GraphQL API. Request up to 100 items per page; use nextCursor as after to continue.</p>
      </div>
      {demo && <div className="notice demo-coverage">
        <Info size={16} aria-hidden="true" />
        <div><strong>Fixed testnet demo · {demo.fromBlock.toLocaleString("en-US")}–{demo.toBlock.toLocaleString("en-US")}</strong>
          <p>Namespace <code>{demo.project}</code>. Prep supplies public data → Chef runs TypeScript handlers → PostgreSQL stores entities → GraphQL serves committed results, including during indexing. <code>_meta.height</code> reports the saved checkpoint; this demo does not cover the entire chain.</p>
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
      <div className="graphql-workspace">
        <div className="panel-toolbar">
          <strong>
            <Braces size={16} /> GraphQL query
          </strong>
          <div className="toolbar-actions">
            <CopyButton text={query} />
            <button
              className="button compact"
              disabled={!enabled || !query.trim()}
              onClick={
                busy
                  ? () => {
                      abort.current?.abort();
                      setBusy(false);
                      setError("Query cancelled.");
                    }
                  : run
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
                BlockSummary
              </summary>
              {[
                "id: ID!",
                "height: Int!",
                "hash: String!",
                "time: BigInt!",
                "transactionCount: Int!",
              ].map((f) => (
                <div key={f}>{f}</div>
              ))}
            </details>
            <div className="schema-hint">
              From the starter schema.
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
                abort.current?.abort();
                setBusy(false);
                setQuery(e.target.value);
                setStale(true);
                setError("");
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
              <Code
                code={JSON.stringify(result, null, 2)}
              />
            ) : (
              <div className="empty-response">
                <Braces size={32} />
                <h3>
                  {busy ? "Reading your entities…" : "Your data appears here."}
                </h3>
                <p>
                  {enabled
                    ? "Run a query to inspect the actual response."
                    : "Connect a Chef service to run queries against your application data."}
                </p>
              </div>
            )}
          </div>
        </div>
        <div className="panel-foot">
          <span className="mode-pill">
            {enabled
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
      <p className="privacy-note">
        <ShieldCheck size={15} /> Your API credentials stay on the server.
      </p>
    </>
  );
}
