export const record = (v:unknown):Record<string,unknown> => v!==null && typeof v==="object" && !Array.isArray(v) ? v as Record<string,unknown> : {};
export const list = (v:unknown):Record<string,unknown>[] => Array.isArray(v) ? v.map(record) : [];
export function integer(value:unknown):bigint|null {
  if (typeof value==="string" && /^-?(0|[1-9][0-9]{0,127})$/.test(value)) return BigInt(value);
  if (typeof value==="number" && Number.isSafeInteger(value)) return BigInt(value);
  return null;
}
export function outputZat(output:Record<string,unknown>):bigint|null {
  const exact=integer(output.valueZat);if(exact!==null)return exact>=0n?exact:null;
  if(typeof output.value!=="string" || !/^[0-9]+(?:\.[0-9]{1,8})?$/.test(output.value))return null;
  const [whole,fraction=""]=output.value.split('.');return BigInt(whole)*100000000n+BigInt(fraction.padEnd(8,'0'));
}
export function outputDestination(output:Record<string,unknown>):string {
  const script=record(output.scriptPubKey);
  if(Array.isArray(script.addresses)){const addresses=script.addresses.filter((v):v is string=>typeof v==="string");if(addresses.length)return addresses.join(", ");}
  return typeof script.address==="string"?script.address:typeof script.type==="string"?`${script.type} script`:"Address not provided";
}
export function formatZat(value:bigint|null):string {
  if(value===null)return "Not provided";const abs=value<0n?-value:value;
  return `${value<0n?"-":""}${abs/100000000n}.${String(abs%100000000n).padStart(8,'0')} test ZEC`;
}
export function transparentTotal(decoded:Record<string,unknown>):bigint|null {
  if(!Array.isArray(decoded.vout))return null;
  let total=0n;for(const output of list(decoded.vout)){const amount=outputZat(output);if(amount===null)return null;total+=amount;}return total;
}
export function pools(decoded:Record<string,unknown>) {
  return [
    {name:"Sapling",actions:list(decoded.vShieldedSpend).length+list(decoded.vShieldedOutput).length,balance:integer(decoded.valueBalanceZat)},
    {name:"Orchard",actions:list(record(decoded.orchard).actions).length,balance:integer(record(decoded.orchard).valueBalanceZat)},
    {name:"Ironwood",actions:list(record(decoded.ironwood).actions).length,balance:integer(record(decoded.ironwood).valueBalanceZat)},
  ].filter(pool=>pool.actions>0);
}
export function publicFee(decoded:Record<string,unknown>,coinbase:boolean):bigint|null {
  if(coinbase)return 0n;
  if(!Array.isArray(decoded.vin) || decoded.vin.length || list(decoded.vjoinsplit).length)return null;
  const outputs=transparentTotal(decoded),active=pools(decoded);
  if(outputs===null || !active.length || active.some(pool=>pool.balance===null))return null;
  const fee=active.reduce((sum,pool)=>sum+pool.balance!,0n)-outputs;
  return fee>=0n?fee:null;
}
export function coinbaseValue(decoded:Record<string,unknown>):bigint|null {
  const outputs=transparentTotal(decoded),active=pools(decoded);
  if(outputs===null || list(decoded.vjoinsplit).length || active.some(pool=>pool.balance===null))return null;
  const created=outputs-active.reduce((sum,pool)=>sum+pool.balance!,0n);return created>=0n?created:null;
}
export function kindLabel(value:unknown):string {
  return ({coinbase:"Coinbase · block reward",transparent:"Transparent",shielded:"Shielded",mixed:"Mixed",unknown:"Unclassified"} as Record<string,string>)[String(value)] ?? "Unclassified";
}
