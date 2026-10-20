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
import { useAppOrigin } from "@/lib/use-app-origin";
import {
  examples,
  prepQuery,
  repo,
  sampleBlocks,
  defaultExampleMatch,
  verifiedExample,
  defaultPrepFields,
  blockFieldOptions,
  transactionFieldOptions,
  type Example,
  type PrepFields,
} from "@/lib/content";

export function PrepExplorer({
  embedded = false,
  enabled = false,
  initialExample = "headers",
  initialFrom = "0",
  initialTo = "",
  initialMatch = "",
  initialFields,
}: {
  embedded?: boolean;
  enabled?: boolean;
  initialExample?: Example;
  initialFrom?: string;
  initialTo?: string;
  initialMatch?: string;
  initialFields?: PrepFields;
}) {
  const [selected, setSelected] = useState<Example>(initialExample),
    [from, setFrom] = useState(initialFrom),
    [to, setTo] = useState(initialTo),
    [match, setMatch] = useState(initialMatch),
    [fields, setFields] = useState<PrepFields>(() => initialFields ?? defaultPrepFields(initialExample)),
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
  const origin = useAppOrigin();
  const publicPrepApi = `${origin}/api/prep`;
  useEffect(() => () => abort.current?.abort(), []);
  const rangeValid =
    /^\d+$/.test(from) &&
    Number(from) >= 0 && Number(from) <= 4294967295 &&
    (to === "" || /^\d+$/.test(to) && Number(to) > Number(from) && Number(to) <= 4294967295);
  const matchValid =
    selected === "ids"
      ? match.trim().split(/[\s,]+/).length <= 128 &&
        match
          .trim()
          .split(/[\s,]+/)
          .every((id) => /^[a-f0-9]{64}$/.test(id))
      : selected === "versions"
        ? /^\d+$/.test(match) && Number(match) >= 1 && Number(match) <= 4294967295
      : selected === "address"
        ? /^t[\x21-\x7e]{1,127}$/.test(match)
        : true;
  const valid = rangeValid && matchValid;
  const route = "query";
  const query = prepQuery(selected, Number(from), to === "" ? undefined : Number(to), match, undefined, fields);
  const cursor = result && typeof result === "object" && "cursor" in result && typeof result.cursor === "string" ? result.cursor : null;
  const parameters = new URLSearchParams({example: selected, from, match, blockFields: fields.block.join(","), transactionFields: fields.transaction.join(",")});
  if (to !== "") parameters.set("to", to);
  const shareUrl = `${origin}/app/prep?${parameters}`;
  const example =
    examples.find((entry) => entry.id === selected) ?? examples[0];
  const knownSample = verifiedExample(selected, match);
  const json = JSON.stringify(query, null, 2);
  const shellJson = json.replaceAll("'", "'\\''");
  const code =
    language === "JSON"
      ? json
      : language === "cURL"
        ? `curl "${publicPrepApi}/${route}" \\\n  -H "Content-Type: application/json" \\\n  --data '${shellJson}'`
        : language === "fetch"
          ? `const response = await fetch("${publicPrepApi}/query", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify(${json}),\n});\nif (!response.ok) throw new Error(await response.text());\nconst page = await response.json();\nconsole.log(page); // Pass page.cursor with the same query to continue.`
          : `import { PrepClient } from "@zeer/prep-client";\n\nconst client = new PrepClient({\n  url: "${publicPrepApi}",\n});\n\nfor await (const page of client.stream(${json})) {\n  console.log(page);\n} // The SDK follows continuation cursors automatically.`;
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
                setFields(defaultPrepFields(example.id));
                setMatch(defaultExampleMatch(example.id));
                setFrom("0");
                setTo("");
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
                  setTo("");
                }}
              />
            </label>
          </div>
          {(selected === "ids" || selected === "address" || selected === "versions") && (
            <div className="fields match-field">
              <label>
                {selected === "ids"
                  ? "Transaction IDs (comma separated)"
                  : selected === "versions" ? "Transaction version"
                  : "Transparent output address"}
                <input
                  value={match}
                  inputMode={selected === "versions" ? "numeric" : undefined}
                  placeholder={
                    selected === "ids"
                      ? "Paste a testnet transaction ID"
                      : selected === "versions" ? "For example: 4, 5 or 6"
                      : "Paste a transparent t-address"
                  }
                  onChange={(e) => {
                    changed();
                    setMatch(e.target.value);
                  }}
                />
              </label>
            </div>
          )}
          {!valid ? (
            <p role="alert" className="field-error">
              {!rangeValid
                ? to ? "This link needs an exclusive end greater than its starting block, within 0–4,294,967,295. Change From block to start a fresh query." : "Choose a starting block from 0 to 4,294,967,295."
                : selected === "ids"
                  ? "Enter up to 128 lowercase 64-character transaction IDs."
                  : selected === "versions" ? "Enter a transaction version from 1 to 4,294,967,295."
                  : "Enter an output address beginning with t. Matching does not validate the address checksum."}
            </p>
          ) : (
            <p className="field-hint">
              {to ? `Linked range: blocks ${Number(from).toLocaleString("en-US")}–${(Number(to) - 1).toLocaleString("en-US")} inclusive. This request stops at the linked end.` : "Prep captures the latest indexed block when you run. Next page stays within that same snapshot."}
            </p>
          )}
          {to && <button className="text-link" onClick={() => { changed(); setTo(""); }}>Continue to latest <ArrowRight size={14} /></button>}
          <div className="verified-example">
            <button className="button secondary compact" onClick={() => {
              changed(); setFrom(String(knownSample.from));
              setTo("");
              setMatch(knownSample.match); setFields(defaultPrepFields(selected));
            }}>Use verified testnet sample <ArrowRight size={14} /></button>
            <span>Starts at block {knownSample.from.toLocaleString("en-US")}. Run query to fetch the actual response.</span>
          </div>
        </div>
        <details className="field-selection">
          <summary>Response fields <span>{fields.block.length + fields.transaction.length} selected</span></summary>
          <p>Select what your application needs. Identity fields keep each result identifiable.</p>
          <div className="field-selection-groups">
            {(["block", "transaction"] as const).filter(group => group === "block" || selected !== "headers").map(group => <fieldset key={group}>
              <legend>{group === "block" ? "Block" : "Transaction"}</legend>
              {(group === "block" ? blockFieldOptions : transactionFieldOptions).map(option => <label key={option.key}>
                <input type="checkbox" checked={fields[group].includes(option.key)} disabled={option.required} onChange={e => {
                  changed();
                  setFields(previous => ({ ...previous, [group]: e.target.checked ? [...previous[group], option.key] : previous[group].filter(key => key !== option.key) }));
                }} />
                <span>{option.label}<code>{option.key}{option.required ? " · required" : ""}</code></span>
              </label>)}
            </fieldset>)}
          </div>
          <p>Inputs are references to previous outputs; Zcash does not expose one universal sender address. Shielded recipients, amounts and memos stay encrypted.</p>
        </details>
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
                  ? language === "TypeScript" ? "The SDK follows continuation cursors automatically." : "Prep sizes responses automatically. Use the cursor to continue."
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
              Preview response format <ChevronDown size={14} />
            </button>
          )}
          {embedded ? (
            <Link
              href={`/app/prep?${parameters}`}
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
              Block-header format preview · recorded testnet blocks 1,000–1,002
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
              {!stale && ["sapling", "orchard", "ironwood", "shielded"].includes(resultExample) && result && typeof result === "object" && "to_block" in result && typeof result.to_block === "number" && <button className="text-link" disabled={busy} onClick={() => { changed(); setTo(""); setFrom(String(Math.max(0, (result.to_block as number) - 1000))); }}>Start near latest blocks <ArrowUpRight size={14} /></button>}
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
