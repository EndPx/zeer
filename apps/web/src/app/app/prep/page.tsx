import { PrepExplorer } from "@/components/prep-explorer";
import { examples, defaultExampleMatch, sharedPrepFields, type Example } from "@/lib/content";
import { PrepEndpoint } from "@/components/prep-endpoint";
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
          Choose an example, set a starting block, and query real public testnet data.
        </p>
      </div>
      <PrepEndpoint />
      <PrepExplorer
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
      />
    </>
  );
}
