import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {PostgresStore,parseModel} from '@zeer-dev/chef';
import config from './chef.config.ts';

test('PostgreSQL restart and rollback restore totals, coverage and outpoint state together',async t=>{
 const url=process.env.CHEF_TEST_DATABASE_URL;
 assert.ok(url,'Set CHEF_TEST_DATABASE_URL to a disposable local test database');
 const project='address_'+randomBytes(8).toString('hex');
 const model=parseModel(await readFile(new URL('./schema.graphql',import.meta.url),'utf8'));
 const options={project,model,fingerprint:model.fingerprint,startHeight:0,network:'regtest',reorgWindow:4};
 let store=new PostgresStore(url,options);
 t.after(async()=>{await store.close();const client=new pg.Client({connectionString:url});await client.connect();try{assert.match(project,/^address_[0-9a-f]{16}$/);await client.query(`DROP SCHEMA "chef_${project}" CASCADE`);}finally{await client.end();}});
 await store.migrate();await store.acquire();
 const hash=n=>n.toString(16).padStart(64,'0');
 const blocks=[0,1].map(height=>({height,hash:hash(height+10),previousHash:hash(height?10:0),time:height}));
 const txs=[{txid:hash(1),blockHeight:0,index:0,version:4,locktime:0,decoded:{vin:[{coinbase:'00'}],vout:[{n:0,value:'1',scriptPubKey:{address:'tA'}}]}},
 {txid:hash(2),blockHeight:1,index:0,version:4,locktime:0,decoded:{vin:[{txid:hash(1),vout:0}],vout:[{n:0,value:'0.9',scriptPubKey:{address:'tB'}}]}}];
 await store.applyBatch(blocks,async(block,entities)=>{const context={entities};await config.indexer.block({block,context});await config.indexer.transaction({block,transaction:txs[block.height],context});});
 await store.close();store=new PostgresStore(url,options);await store.acquire();
 assert.equal((await store.read(v=>v.get('AddressSummary','tA'))).spentZat,'100000000');
 assert.equal((await store.checkpoint()).height,1);
 await store.markReconciling();await store.rollback(0,blocks[0].hash);await store.markReady();
 const after=await store.read(async v=>({summary:await v.get('AddressSummary','tA'),destination:await v.get('AddressSummary','tB'),output:await v.get('ObservedOutput',`${hash(1)}:0`),coverage:await v.get('Coverage','chain'),activity:await v.get('AddressActivity',`${hash(2)}:tA`)}));
 assert.equal(after.summary.receivedZat,'100000000');assert.equal(after.summary.spentZat,'0');
 assert.equal(after.destination,null);assert.equal(after.output.spentBy,null);assert.equal(after.activity,null);
 assert.equal(after.coverage.processedBlocks,1);assert.equal(after.coverage.lastHeight,0);
});
