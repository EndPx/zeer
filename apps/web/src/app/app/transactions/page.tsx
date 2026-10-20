import { redirect } from "next/navigation";
export const dynamic="force-dynamic";
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const p=await searchParams;const id=typeof p.txid==="string"?p.txid.slice(0,256).toLowerCase():"";
 redirect(id ? `/app/prep?view=transaction&txid=${encodeURIComponent(id)}` : "/app/prep?view=mempool");
}
