import { PrepExplorer } from "@/components/prep-explorer";
import { examples, publicPrepApi, testnetExample, type Example } from "@/lib/content";
import { CopyButton } from "@/components/interactive";
export const dynamic = "force-dynamic";
export const metadata = { title: "Prep Playground" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
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
          typeof params.from === "string" ? params.from.slice(0, 12) : "0"
        }
        initialMatch={
          typeof params.match === "string" ? params.match.slice(0, 9000) : example === "address" ? testnetExample.address : example === "ids" ? testnetExample.txid : ""
        }
        initialLimit={typeof params.limit === "string" ? params.limit.slice(0, 5) : "100"}
      />
    </>
  );
}
