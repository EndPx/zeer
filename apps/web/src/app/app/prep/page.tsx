import { PrepExplorer } from "@/components/prep-explorer";
import { examples, publicPrepApi, testnetExample, type Example } from "@/lib/content";
import { CopyButton } from "@/components/interactive";
import { upstream } from "@/lib/upstream";
export const dynamic = "force-dynamic";
export const metadata = { title: "Prep Playground" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  let defaultFrom = "0", defaultTo = "1003";
  if (process.env.ZEER_PREP_URL) {
    defaultFrom = defaultTo = "";
    try {
      const coverage = await upstream("prep", "/height");
      if (coverage.network === "testnet" && coverage.ready === true &&
          Number.isSafeInteger(coverage.start_block) && coverage.start_block >= 0 &&
          Number.isSafeInteger(coverage.indexed_height) &&
          coverage.indexed_height >= coverage.start_block && coverage.indexed_height < 4294967295) {
        defaultFrom = String(coverage.start_block);
        defaultTo = String(coverage.indexed_height + 1);
      }
    } catch {
      // An unavailable live source must not silently select historical fixture heights.
    }
  }
  const example = examples.some((e) => e.id === params.example)
    ? (params.example as Example)
    : "address";
  return (
    <>
      <div className="console-title">
        <span className="eyebrow">Zeer Prep</span>
        <h1>Explore the query. See the data.</h1>
        <p>
          Choose an example, adjust the range, and query your public-data
          archive.
        </p>
      </div>
      <div className="notice public-endpoint">
        <span>Public testnet API<code>{publicPrepApi}</code></span>
        <CopyButton text={publicPrepApi} label="Copy endpoint" />
      </div>
      <PrepExplorer
        enabled={!!process.env.ZEER_PREP_URL}
        initialExample={example}
        initialFrom={
          typeof params.from === "string" ? params.from.slice(0, 12) : defaultFrom
        }
        initialTo={
          typeof params.to === "string" ? params.to.slice(0, 12) : defaultTo
        }
        initialMatch={
          typeof params.match === "string" ? params.match.slice(0, 9000) : example === "address" ? testnetExample.address : example === "ids" ? testnetExample.txid : ""
        }
        initialLimit={typeof params.limit === "string" ? params.limit.slice(0, 5) : "100"}
      />
    </>
  );
}
