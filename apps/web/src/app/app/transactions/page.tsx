import { TransactionInspector } from "@/components/transaction-inspector";
export const dynamic="force-dynamic";
export const metadata={title:"Transaction inspector"};
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const p=await searchParams;const id=typeof p.txid==="string"?p.txid.slice(0,256).toLowerCase():"";
  return <TransactionInspector key={id} initialId={id} enabled={!!process.env.ZEER_PREP_URL}/>;
}
