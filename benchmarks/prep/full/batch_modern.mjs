// Read-only verification of public v4/v5 batch payloads, not note decryption.
import { readFile,writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { PrepClient } from '../../../packages/prep-client/src/index.js';
const fixture=JSON.parse(await readFile('benchmarks/fixtures/mainnet-nu5-full-v1/fixture.json','utf8'));
const expected=fixture.blocks.flatMap(block=>block.decoded.tx.map((tx,index)=>({txid:tx.txid,block_height:block.decoded.height,index,version:tx.version,locktime:tx.locktime,size_bytes:tx.hex.length/2,transparent_input_count:tx.vin.length,transparent_output_count:tx.vout.length,raw:tx.hex})));
const api=new PrepClient({url:process.env.PREP_URL,token:process.env.PREP_API_TOKEN});
const query={from_block:fixture.blocks[0].decoded.height,to_block:fixture.blocks.at(-1).decoded.height+1,txids:expected.map(row=>row.txid),fields:['txid','block_height','index','version','locktime','size_bytes','transparent_input_count','transparent_output_count','raw','decoded']};
const first=await api.getTransactions(query);
assert.equal(first.complete,true);assert.deepEqual(first.missing_txids,[]);
assert.deepEqual(first.transactions.map(({decoded,...row})=>row),expected);
assert.ok(first.transactions.every(row=>typeof row.decoded.version==='string' && typeof row.decoded.locktime==='string'));
const pinned=await api.getTransactions({...query,at:first.snapshot});
assert.deepEqual(pinned.transactions,first.transactions);
const report={status:'PASS',blocks:fixture.blocks.length,transactions:expected.length,versions:[...new Set(expected.map(row=>row.version))].sort(),raw_equal:true,metadata_equal:true,snapshot_reused:true,source_kind:fixture.source_kind,limitations:fixture.limitations};
await writeFile(process.env.ZEER_SDK_RESULT,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
process.stdout.write(JSON.stringify({status:'PASS',transactions:expected.length})+'\n');
