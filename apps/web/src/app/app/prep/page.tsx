import { PrepExplorer } from "@/components/prep-explorer";
import { examples, defaultExampleMatch, sharedPrepFields, type Example } from "@/lib/content";
import { PrepEndpoint } from "@/components/prep-endpoint";
import { TransactionInspector } from "@/components/transaction-inspector";
import Link from "next/link";
export const dynamic = "force-dynamic";
export const metadata = { title: "Prep Playground" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const view = params.view === "transaction" || params.view === "mempool" ? params.view : "query";
  const txid = typeof params.txid === "string" ? params.txid.slice(0, 256).toLowerCase() : "";
  const example = examples.some((e) => e.id === params.example)
    ? (params.example as Example)
    : "address";
  return (
    <>
      <div className="console-title">
        <span className="eyebrow">Zeer Prep</span>
        <h1>{view === "transaction" ? "Inspect a transaction." : view === "mempool" ? "Watch pending transactions." : "Explore the query. See the data."}</h1>
        <p>
          {view === "transaction" ? "Read block rewards, public shielded components, inputs and outputs from the configured testnet source." : view === "mempool" ? "Observe pending transactions from the configured testnet node, with automatic refresh while visible." : "Choose an example, set a starting block, and query real public testnet data."}
        </p>
      </div>
      <PrepEndpoint />
      <nav className="format-tabs prep-tools" aria-label="Prep tools">
        <Link href="/app/prep" aria-current={view === "query" ? "page" : undefined}>Query builder</Link>
        <Link href="/app/prep?view=transaction" aria-current={view === "transaction" ? "page" : undefined}>Inspect transaction</Link>
        <Link href="/app/prep?view=mempool" aria-current={view === "mempool" ? "page" : undefined}>Mempool</Link>
      </nav>
      {view !== "query" ? <TransactionInspector key={`${view}:${txid}`} initialId={view === "transaction" ? txid : ""} observeMempool={view === "mempool"} enabled={!!process.env.ZEER_PREP_URL} /> : <PrepExplorer
        key={JSON.stringify([example, params.from, params.to, params.match, params.blockFields, params.transactionFields])}
        enabled={!!process.env.ZEER_PREP_URL}
        initialExample={example}
        initialFrom={
          typeof params.from === "string" ? params.from.slice(0, 12) : "0"
        }
        initialTo={typeof params.to === "string" ? params.to.slice(0, 12) : ""}
        initialMatch={
          typeof params.match === "string" ? params.match.slice(0, 9000) : defaultExampleMatch(example)
        }
        initialFields={sharedPrepFields(example, params.blockFields, params.transactionFields)}
      />}
    </>
  );
}
