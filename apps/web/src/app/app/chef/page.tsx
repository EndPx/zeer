import { ChefPlayground } from "@/components/chef-playground";
import { parseChefDemo } from "@/lib/chef-demo";
import { parseChefMemoDemo } from "@/lib/chef-memo-demo";
export const dynamic = "force-dynamic";
export const metadata = { title: "Chef Playground" };
export default function Page() {
  return <ChefPlayground enabled={!!process.env.ZEER_CHEF_URL} demo={parseChefDemo(process.env.ZEER_CHEF_DEMO)} memoDemo={process.env.ZEER_CHEF_MEMO_URL ? parseChefMemoDemo(process.env.ZEER_CHEF_MEMO_DEMO) : null} />;
}
