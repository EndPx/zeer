// Live SDK check of all new scalar projections against the independent oracle.
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { PrepClient } from '../../../packages/prep-client/src/index.js';
const oracle = JSON.parse(gunzipSync(await readFile('benchmarks/fixtures/mainnet-public-2048/oracle.json.gz')));
const expected = new Map(oracle.transactions.map(row => [row.id, row]));
const client = new PrepClient({ url: process.env.PREP_URL, token: process.env.PREP_API_TOKEN });
let count=0, pages=0;
const seen=new Set();
const hash=createHash('sha256');
for await (const page of client.stream({from_block:1,to_block:2049,limit:128,field_selection:{block:[],transaction:['txid','block_height','version','locktime','size_bytes','transparent_input_count','transparent_output_count']}})) {
  pages++;
  for (const row of page.data.transactions) {
    const wanted=expected.get(row.txid);
    if (!wanted || seen.has(row.txid) || row.block_height!==wanted.minedHeight || row.version!==wanted.version || String(row.locktime)!==wanted.locktime || row.size_bytes!==wanted.sizeBytes || row.transparent_input_count!==wanted.transparentInputCount || row.transparent_output_count!==wanted.transparentOutputCount) throw new Error('SDK_PROJECTION_MISMATCH');
    seen.add(row.txid);count++;hash.update(JSON.stringify(row));
  }
}
if(count!==16962) throw new Error('SDK_INCOMPLETE');
const report={status:'PASS',pages,transactions:count,ordered_projection_sha256:hash.digest('hex'),node:process.version};
await writeFile(process.env.ZEER_SDK_RESULT,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
process.stdout.write(JSON.stringify(report)+'\n');
