"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  CircleAlert,
  LoaderCircle,
  Play,
  ShieldCheck,
  Square,
} from "lucide-react";
import { Code } from "./ui";
import { CopyButton } from "./interactive";
import { PrepResponse } from "./prep-response";
import {
  examples,
  prepQuery,
  publicPrepApi,
  repo,
  sampleBlocks,
  testnetExample,
  type Example,
} from "@/lib/content";

export function PrepExplorer({
  embedded = false,
  enabled = false,
  initialExample = "headers",
  initialFrom = "0",
  initialMatch = "",
  initialLimit = "100",
}: {
  embedded?: boolean;
  enabled?: boolean;
  initialExample?: Example;
  initialFrom?: string;
  initialMatch?: string;
  initialLimit?: string;
}) {
  const [selected, setSelected] = useState<Example>(initialExample),
    [from, setFrom] = useState(initialFrom),
    [match, setMatch] = useState(initialMatch),
    [limit, setLimit] = useState(initialLimit),
    [page, setPage] = useState(0),
    [language, setLanguage] = useState("JSON"),
    [result, setResult] = useState<unknown>(),
    [duration, setDuration] = useState<number | null>(null),
    [resultBlocks, setResultBlocks] = useState(true),
    [resultFrom, setResultFrom] = useState(0),
    [resultExample, setResultExample] = useState<Example>(initialExample),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [sample, setSample] = useState(false),
    [stale, setStale] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const rangeValid =
    /^\d+$/.test(from) &&
    Number(from) >= 0 && Number(from) <= 4294967295;
  const limitValid = /^\d+$/.test(limit) && Number(limit) >= 1 && Number(limit) <= 1000;
  const matchValid =
    selected === "ids"
      ? match.trim().split(/[\s,]+/).length <= 128 &&
        match
          .trim()
          .split(/[\s,]+/)
          .every((id) => /^[a-f0-9]{64}$/.test(id))
      : selected === "address"
        ? /^t[\x21-\x7e]{1,127}$/.test(match)
        : true;
  const valid = rangeValid && matchValid && limitValid;
  const route = "query";
  const query = prepQuery(selected, Number(from), undefined, match, Number(limit));
  const cursor = result && typeof result === "object" && "cursor" in result && typeof result.cursor === "string" ? result.cursor : null;
  const shareUrl = `${publicPrepApi.replace(/\/api\/prep$/, "")}/app/prep?${new URLSearchParams({example: selected, from, match, limit})}`;
  const example =
    examples.find((entry) => entry.id === selected) ?? examples[0];
  const json = JSON.stringify(query, null, 2);
  const shellJson = json.replaceAll("'", "'\\''");
  const code =
    language === "JSON"
      ? json
      : language === "cURL"
        ? `curl "${publicPrepApi}/${route}" \\\n  -H "Content-Type: application/json" \\\n  --data '${shellJson}'`
        : language === "fetch"
          ? `const response = await fetch("${publicPrepApi}/query", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify(${json}),\n});\nif (!response.ok) throw new Error(await response.text());\nconst page = await response.json();\nconsole.log(page); // Pass page.cursor with the same query to continue.`
          : `import { PrepClient } from "@zeer/prep-client";\n\nconst client = new PrepClient({\n  url: "${publicPrepApi}",\n});\n\nconst page = await client.get(${json});\nconsole.log(page); // Use the returned cursor to continue.`;
  function changed() {
    abort.current?.abort();
    setBusy(false);
    setStale(true);
    setSample(false);
    setError("");
  }
  async function run(nextCursor?: string) {
    if (!enabled || !valid || busy) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError("");
    if (!nextCursor) setResult(undefined);
    setSample(false);
    setStale(false);
    setDuration(null);
    setResultBlocks(selected === "headers");
    setResultExample(selected);
    const scanFrom = nextCursor && result && typeof result === "object" && "next_block" in result && typeof result.next_block === "number" ? result.next_block : Number(from);
    const started = performance.now();
    try {
      const response = await fetch(
        "/api/prep",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...query, ...(nextCursor ? { cursor: nextCursor } : {}) }),
          signal: controller.signal,
        },
      );
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Request failed");
      if (!controller.signal.aborted && abort.current === controller) {
        setResult(data);
        setResultFrom(scanFrom);
        setPage(previous => nextCursor ? previous + 1 : 1);
        setDuration(performance.now() - started);
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      if (abort.current === controller) setBusy(false);
    }
  }
  return (
    <div className={`query-explorer ${embedded ? "embedded" : ""}`}>
      <aside className="example-list">
        <span className="muted small-label">Examples</span>
        <div className="example-buttons">
          {examples.map((example) => (
            <button
              aria-pressed={selected === example.id}
              key={example.id}
              onClick={() => {
                changed();
                setSelected(example.id);
                setMatch(example.id === "address" ? testnetExample.address : example.id === "ids" ? testnetExample.txid : "");
              }}
            >
              {example.name}
              <ArrowRight size={14} />
            </button>
          ))}
        </div>
      </aside>
      <div className="query-main">
        <div className="query-config">
          <h3>{example.name}</h3>
          <p>{example.description}</p>
          <p className="example-detail">{example.detail}</p>
          <div className="fields query-range-fields">
            <label>
              From block
              <input
                inputMode="numeric"
                value={from}
                onChange={(e) => {
                  changed();
                  setFrom(e.target.value);
                }}
              />
            </label>
            <label>
              Blocks scanned per page
              <input inputMode="numeric" value={limit} onChange={e => { changed(); setLimit(e.target.value); }} />
            </label>
          </div>
          {(selected === "ids" || selected === "address") && (
            <div className="fields match-field">
              <label>
                {selected === "ids"
                  ? "Transaction IDs (comma separated)"
                  : "Transparent output address"}
                <input
                  value={match}
                  placeholder={
                    selected === "ids"
                      ? "Paste a testnet transaction ID"
                      : "Paste a transparent t-address"
                  }
                  onChange={(e) => {
                    changed();
                    setMatch(e.target.value);
                  }}
                />
              </label>
              <button className="button secondary compact" onClick={() => {
                changed();
                setMatch(selected === "ids" ? testnetExample.txid : testnetExample.address);
              }}>Use testnet example</button>
            </div>
          )}
          {!valid ? (
            <p role="alert" className="field-error">
              {!rangeValid
                ? "Choose a starting block from 0 to 4,294,967,295."
                : !limitValid ? "Scan between 1 and 1,000 blocks per page. The full query range can be larger."
                : selected === "ids"
                  ? "Enter up to 128 lowercase 64-character transaction IDs."
                  : "Enter an output address beginning with t. Matching does not validate the address checksum."}
            </p>
          ) : (
            <p className="field-hint">
              Prep captures the latest indexed block when you run. Next page stays within that same snapshot.
            </p>
          )}
        </div>
        <div className="code-panel">
          <div className="panel-toolbar">
            <div className="format-tabs" aria-label="Code format">
              {["JSON", "cURL", "fetch", "TypeScript"].map((lang) => (
                <button
                  aria-pressed={language === lang}
                  onClick={() => setLanguage(lang)}
                  key={lang}
                >
                  {lang}
                </button>
              ))}
            </div>
            <CopyButton text={valid ? code : ""} />
            <CopyButton text={valid ? shareUrl : ""} label="Share" />
            {!embedded && (
              <button
                className="button compact"
                disabled={!enabled || !valid}
                onClick={
                  busy
                    ? () => {
                        abort.current?.abort();
                        setBusy(false);
                        setError("Request cancelled.");
                      }
                    : () => void run()
                }
              >
                {busy ? <Square size={13} /> : <Play size={13} />}{" "}
                {busy ? "Cancel" : "Run query"}
              </button>
            )}
          </div>
          <div className="code-route">POST /{route}</div>
          <Code
            code={
              valid
                ? code
                : "// Complete the query inputs to generate the request."
            }
          />
          <div className="panel-foot">
            <span className="mode-pill">
              {enabled && !embedded ? "Connected backend" : "Example mode"}
            </span>
            <span>
              {busy
                ? "Request in progress…"
                : enabled && !embedded
                  ? "Results are bounded to one response page."
                  : "No request has been sent."}
            </span>
          </div>
        </div>
        <div className="query-links">
          {embedded && selected === "headers" && (
            <button
              className="text-link"
              onClick={() => {
                abort.current?.abort();
                setBusy(false);
                setSample(!sample);
                setResult(undefined);
                setError("");
              }}
            >
              View recorded response <ChevronDown size={14} />
            </button>
          )}
          {embedded ? (
            <Link
              href={`/app/prep?${new URLSearchParams({example: selected, from, match, limit})}`}
              className="text-link"
            >
              Open in Playground <ArrowUpRight size={14} />
            </Link>
          ) : (
            <Link
              href={`${repo}/blob/main/docs/PREP_QUERY.md`}
              className="text-link"
            >
              API documentation <ArrowUpRight size={14} />
            </Link>
          )}
        </div>
        {!embedded && !enabled && (
          <p className="connection-note">
            The hosted demo is not connected yet. Explore examples now, or
            connect a Prep service using the server configuration.
          </p>
        )}
        {error && (
          <div className="error-note" role="alert">
            <CircleAlert size={17} />
            {error}
          </div>
        )}
        {busy && (
          <div className="loading-note" role="status">
            <LoaderCircle className="spin" size={17} /> Reading from Prep…
          </div>
        )}
        {embedded && sample && (
          <div className="code-panel response-panel">
            <div className="panel-toolbar">
              Recorded testnet data · blocks 1,000–1,002
            </div>
            <Code
              code={JSON.stringify(
                {
                  blocks: sampleBlocks.map(({ height, hash, time }) => ({
                    height,
                    hash,
                    time,
                  })),
                },
                null,
                2,
              )}
            />
            <div className="panel-foot">
              Data excerpt from historical replay. Independent of edited inputs;
              not a live response.
            </div>
          </div>
        )}
        {result !== undefined && (
          <>
            <PrepResponse value={result} stale={stale} duration={duration} blocks={resultBlocks} scanFrom={resultFrom} example={resultExample} />
            <div className="query-pagination">
              <span>{stale ? "Inputs changed. Run a new query to continue." : `Page ${page} · ${cursor ? "More of this range remains to be scanned" : "Selected range complete"}`}</span>
              {cursor && <button className="button secondary compact" disabled={stale || busy || !valid} onClick={() => void run(cursor)}>Next page <ArrowRight size={14} /></button>}
              {!stale && (resultExample === "sapling" || resultExample === "orchard") && result && typeof result === "object" && "to_block" in result && typeof result.to_block === "number" && <button className="text-link" disabled={busy} onClick={() => { changed(); setFrom(String(Math.max(0, (result.to_block as number) - Number(limit)))); }}>Start near latest blocks <ArrowUpRight size={14} /></button>}
            </div>
          </>
        )}
        <p className="privacy-note">
          <ShieldCheck size={15} /> Shielded recipients, amounts, and memos
          remain encrypted.
        </p>
      </div>
    </div>
  );
}
