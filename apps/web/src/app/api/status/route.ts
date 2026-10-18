import { upstream } from "@/lib/upstream";
export const dynamic = "force-dynamic";
export async function GET() {
  const [prep, chef] = await Promise.allSettled([
    process.env.ZEER_PREP_URL
      ? upstream("prep", "/height")
      : Promise.resolve(null),
    process.env.ZEER_CHEF_URL
      ? upstream("chef", "/graphql", {
          query: "{ _meta { height hash status } }",
        })
      : Promise.resolve(null),
  ]);
  let recentBlocks: { height: number; hash: string; time: number }[] = [];
  let recentBlocksAvailable = false;
  if (prep.status === "fulfilled" && prep.value?.ready === true) {
    const meta = prep.value;
    if (Number.isSafeInteger(meta.start_block) && meta.start_block >= 0 &&
        Number.isSafeInteger(meta.indexed_height) && meta.indexed_height >= meta.start_block) {
      try {
        const result = await upstream("prep", "/query", {
          from_block: Math.max(meta.start_block, meta.indexed_height - 7),
          to_block: meta.indexed_height + 1, limit: 8,
          field_selection: { block: ["height", "hash", "time"], transaction: [] },
        });
        recentBlocks = (result.data?.blocks ?? []).filter((b: Record<string, unknown>) =>
          Number.isSafeInteger(b.height) && typeof b.hash === "string" && Number.isSafeInteger(b.time));
        recentBlocksAvailable = true;
      } catch { /* Recent headers can be unavailable independently of status. */ }
    }
  }
  return Response.json(
    {
      checkedAt: new Date().toISOString(), recentBlocks, recentBlocksAvailable,
      prep: {
        configured: !!process.env.ZEER_PREP_URL,
        available: prep.status === "fulfilled" && prep.value !== null,
        data: prep.status === "fulfilled" ? prep.value : null,
      },
      chef: {
        configured: !!process.env.ZEER_CHEF_URL,
        available: chef.status === "fulfilled" && !!chef.value?.data?._meta,
        data: chef.status === "fulfilled" ? chef.value?.data?._meta : null,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
