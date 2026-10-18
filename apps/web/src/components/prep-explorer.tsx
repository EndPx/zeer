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
  repo,
  sampleBlocks,
  type Example,
} from "@/lib/content";

export function PrepExplorer({
  embedded = false,
  enabled = false,
  initialExample = "headers",
  initialFrom = "1000",
  initialTo = "1003",
  initialMatch = "",
}: {
  embedded?: boolean;
  enabled?: boolean;
  initialExample?: Example;
  initialFrom?: string;
  initialTo?: string;
  initialMatch?: string;
}) {
  const [selected, setSelected] = useState<Example>(initialExample),
    [from, setFrom] = useState(initialFrom),
    [to, setTo] = useState(initialTo),
    [match, setMatch] = useState(initialMatch),
    [language, setLanguage] = useState("JSON"),
    [result, setResult] = useState<unknown>(),
    [duration, setDuration] = useState<number | null>(null),
    [resultBlocks, setResultBlocks] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [sample, setSample] = useState(false),
    [stale, setStale] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const rangeValid =
    /^\d+$/.test(from) &&
    /^\d+$/.test(to) &&
    Number(from) >= 1 &&
    Number(to) > Number(from) &&
    Number(to) - Number(from) <= 1000 &&
    Number(to) <= 4294967295;
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
  const valid = rangeValid && matchValid;
  const route = selected === "ids" ? "transactions" : "query";
  const query = prepQuery(selected, Number(from), Number(to), match);
  const example =
    examples.find((entry) => entry.id === selected) ?? examples[0];
  const json = JSON.stringify(query, null, 2);
  const shellJson = json.replaceAll("'", "'\\''");
  const code =
    language === "JSON"
      ? json
      : language === "cURL"
        ? `curl "$PREP_URL/${route}" \\\n  -H "Authorization: Bearer $PREP_API_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  --data '${shellJson}'`
        : `import { PrepClient } from "@zeer/prep-client";\n\nconst client = new PrepClient({\n  url: process.env.PREP_URL!,\n  token: process.env.PREP_API_TOKEN,\n});\n\nconst page = await client.${selected === "ids" ? "getTransactions" : "get"}(${json});\nconsole.log(page);`;
  function changed() {
    abort.current?.abort();
    setBusy(false);
    setStale(true);
    setSample(false);
    setError("");
  }
  async function run() {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError("");
    setResult(undefined);
    setSample(false);
    setStale(false);
    setDuration(null);
    setResultBlocks(selected === "headers");
    const started = performance.now();
    try {
      const response = await fetch(
        selected === "ids" ? "/api/transactions" : "/api/prep",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: json,
          signal: controller.signal,
        },
      );
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Request failed");
      if (!controller.signal.aborted && abort.current === controller) {
        setResult(data);
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
          <div className="fields">
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
              To block <span>(exclusive)</span>
              <input
                inputMode="numeric"
                value={to}
                onChange={(e) => {
                  changed();
                  setTo(e.target.value);
                }}
              />
            </label>
            <div className="field-static">
              <span>Network</span>
              <strong>
                <span className="network-dot" />
                Zcash Testnet
              </strong>
            </div>
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
            </div>
          )}
          {!valid ? (
            <p role="alert" className="field-error">
              {!rangeValid
                ? "Choose a range of 1–1,000 blocks, starting at height 1 or later."
                : selected === "ids"
                  ? "Enter up to 128 lowercase 64-character transaction IDs."
                  : "Enter an output address beginning with t. Matching does not validate the address checksum."}
            </p>
          ) : (
            <p className="field-hint">
              Choose a range covered by your Prep archive.
            </p>
          )}
        </div>
        <div className="code-panel">
          <div className="panel-toolbar">
            <div className="format-tabs" aria-label="Code format">
              {["JSON", "cURL", "TypeScript"].map((lang) => (
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
                    : run
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
                : "// Enter a valid block range to generate the request."
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
              href={`/app/prep?example=${selected}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&match=${encodeURIComponent(match)}`}
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
          <PrepResponse value={result} stale={stale} duration={duration} blocks={resultBlocks} />
        )}
        <p className="privacy-note">
          <ShieldCheck size={15} /> Shielded recipients, amounts, and memos
          remain encrypted.
        </p>
      </div>
    </div>
  );
}
