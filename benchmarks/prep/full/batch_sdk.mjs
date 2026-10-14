// Exercise the real new Rust routes through the SDK and independent frozen data.
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { PrepClient, ReorgError } from '../../../packages/prep-client/src/index.js';

const manifest=JSON.parse(await readFile('benchmarks/fixtures/mainnet-transactions-v1/manifest.json','utf8'));
const oracle=JSON.parse(gunzipSync(await readFile('benchmarks/fixtures/mainnet-public-2048/oracle.json.gz')));
const positions=new Map(), counts=new Map();
for(const row of oracle.transactions){const index=counts.get(row.minedHeight)??0;positions.set(row.id,index);counts.set(row.minedHeight,index+1);}
for(const block of oracle.blocks)assert.equal(counts.get(Number(block.id)),block.transactionCount);
const api=new PrepClient({url:process.env.PREP_URL,token:process.env.PREP_API_TOKEN});
const capabilities=await api.getCapabilities();
assert.equal(capabilities.transactions.max_ids,128);
const base={from_block:1,to_block:2049};
const ids=manifest.records.map(row=>row.txid);
const first=await api.getTransactions({...base,txids:ids});
assert.equal(first.complete,true);assert.equal(first.transactions.length,128);assert.deepEqual(first.missing_txids,[]);
for(const row of first.transactions){
 const expected=manifest.records.find(value=>value.txid===row.txid);assert.ok(expected);
 assert.equal(row.block_height,expected.mined_height);assert.equal(row.index,positions.get(row.txid));
 for(const field of ['version','locktime','size_bytes','transparent_input_count','transparent_output_count'])assert.equal(row[field],expected[field]);
}
const absent='0'.repeat(64);assert.ok(!oracle.transactions.some(row=>row.id===absent));
const duplicate=await api.getTransactions({...base,txids:[ids[0],absent,ids[0],absent],at:first.snapshot});
assert.equal(duplicate.transactions.length,1);assert.deepEqual(duplicate.missing_txids,[absent]);
const raw=await api.getTransactions({...base,txids:ids.slice(0,2),fields:['txid','block_height','index','raw'],at:first.snapshot});
for(const row of raw.transactions)assert.equal(row.raw,manifest.records.find(value=>value.txid===row.txid).raw_hex);
const empty=await api.getTransactions({...base,txids:[],at:first.snapshot});assert.deepEqual(empty.transactions,[]);assert.deepEqual(empty.missing_txids,[]);
await assert.rejects(api.getTransactions({...base,txids:[ids[0]],at:{...first.snapshot,epoch:String(BigInt(first.epoch)+1n)}}),ReorgError);
await assert.rejects(api.getTransactions({...base,txids:[ids[0]],at:{...first.snapshot,boundary_hash:absent}}),ReorgError);
const report={status:'PASS',node:process.version,verified_metadata_rows:128,verified_raw_rows:raw.transactions.length,duplicate_and_missing_accounting:true,empty_batch:true,
 snapshot_reuse:true,epoch_conflict_rejected:true,boundary_conflict_rejected:true,capabilities,snapshot:first.snapshot};
await writeFile(process.env.ZEER_SDK_RESULT,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
process.stdout.write(JSON.stringify({status:'PASS',metadata:128,raw:2})+'\n');
