import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';

export function privateRpcHost(hostname){
  if(isIP(hostname)!==4)return false;
  const [a,b]=hostname.split('.').map(Number);
  return a===127||a===10||(a===192&&b===168)||(a===172&&b>=16&&b<=31);
}
export const guardedMessage=(receive,failed)=>message=>{try{receive(message);}catch{failed('IPC_VALIDATION_FAILED');}};

export const now = () => process.hrtime.bigint().toString();
export const seconds = (end, start) => Number(BigInt(end) - BigInt(start)) / 1e9;
export const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const rank = (values, fraction) => {
  assert.ok(values.length && values.every(Number.isFinite));
  return [...values].sort((a,b) => a-b)[Math.max(0, Math.ceil(values.length * fraction)-1)];
};
export const stats = values => ({samples: values.length, median_seconds: values.length % 2
  ? rank(values,.5) : (rank(values,.5) + [...values].sort((a,b)=>a-b)[values.length/2])/2,
  p95_seconds: rank(values,.95), min_seconds: Math.min(...values), max_seconds: Math.max(...values)});

export function blockReference(block) {
  assert.ok(Number.isInteger(block.height) && /^[a-f0-9]{64}$/.test(block.hash) && Array.isArray(block.tx));
  return {height:block.height, hash:block.hash, previousHash:block.previousblockhash,
    time:block.time, transactions:block.tx.map(tx=>typeof tx==='string'?tx:tx.txid)};
}

export function expectedEntities(blocks) {
  const summaries=[], transactions=[]; const pools={sapling:0,orchard:0,ironwood:0,transparent:0};
  for(const block of blocks) {
    const header=blockReference(block);
    summaries.push({id:String(block.height),height:block.height,hash:block.hash,time:String(block.time),transactionCount:block.tx.length});
    block.tx.forEach((tx,index)=>{
      assert.equal(typeof tx,'object'); assert.ok(/^[a-f0-9]{64}$/.test(tx.txid));
      transactions.push({id:tx.txid,height:block.height,transactionIndex:index,version:tx.version,locktime:tx.locktime});
      if(tx.vShieldedSpend?.length||tx.vShieldedOutput?.length)pools.sapling++;
      if(tx.orchard?.actions?.length)pools.orchard++;
      if(tx.ironwood?.actions?.length)pools.ironwood++;
      if(tx.vin?.length||tx.vout?.length)pools.transparent++;
    });
    if(summaries.length>1)assert.equal(header.previousHash,blocks[summaries.length-2].hash,'Disconnected reference chain');
  }
  const sort=rows=>rows.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  return {entities:{BlockSummary:sort(summaries),TransactionMeta:sort(transactions),Totals:[{id:'all',blocks:blocks.length,transactions:transactions.length}]},pools};
}

export function summarize(rows,profiles=[5,1]) {
  assert.ok(rows.length);
  const result={};
  for(const poll of profiles) {
    const selected=rows.flatMap(row=>row.profiles.filter(p=>p.poll_seconds===poll).map(p=>({row,p})));
    assert.equal(selected.length,rows.length,'Unpaired samples');
    for(const {row,p}of selected)assert.equal(p.hash,row.hash,'Different observed branch');
    result[String(poll)]={
      source_to_graphql:stats(selected.map(({row,p})=>seconds(p.graphql_ns,row.source_ns))),
      prep_to_graphql:stats(selected.map(({row,p})=>seconds(p.graphql_ns,row.prep_ns))),
      prep_to_commit_ack:stats(selected.map(({row,p})=>seconds(p.commit_ns,row.prep_ns))),
    };
  }
  result.source_to_prep=stats(rows.map(row=>seconds(row.prep_ns,row.source_ns)));
  result.paired_graphql_improvement=stats(rows.map(row=>seconds(row.profiles.find(p=>p.poll_seconds===profiles[0]).graphql_ns,row.profiles.find(p=>p.poll_seconds===profiles[1]).graphql_ns)));
  return result;
}
