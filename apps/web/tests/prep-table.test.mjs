import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultPrepFields,prepQuery,sharedPrepFields,examples,defaultExampleMatch,verifiedExample} from '../src/lib/content.ts';
import {transactionKind,publicOutputPreview,utcTimestamp,shieldedComponentCounts} from '../src/lib/prep-table.ts';
test('transaction position is not a payment type; coinbase must come from vin',()=>{
 assert.equal(transactionKind([{txid:'a'.repeat(64),vout:'0'}]),'Transaction');
 assert.equal(transactionKind([{coinbase:'0345420f0101'}]),'Coinbase · block reward');
 assert.equal(transactionKind(undefined),'Not supplied');
});
test('public outputs preserve precision and do not invent shielded addresses',()=>{
 const preview=publicOutputPreview([{value:'9007199254.74099312',scriptPubKey:{addresses:['t-example']}},{valueZat:'1',scriptPubKey:{type:'pubkey'}},{value:'2',scriptPubKey:{}}]);
 assert.equal(preview.total,3);assert.equal(preview.items.length,2);
 assert.equal(preview.items[0].amount,'9007199254.74099312 test ZEC');
 assert.equal(preview.items[1].destination,'pubkey script');assert.equal(preview.items[1].amount,'1 zatoshis');
 assert.deepEqual(publicOutputPreview([]),{total:0,items:[]});assert.equal(publicOutputPreview(null),null);
});
test('field choices survive share links without accepting unsupported or missing identity fields',()=>{
 const defaults=defaultPrepFields('sapling');assert.ok(!defaults.transaction.includes('index'));
 const selected=sharedPrepFields('sapling','height,time','txid,block_height,index');
 assert.deepEqual(prepQuery('sapling',0,undefined,'',100,selected).field_selection,selected);
 assert.ok(!Object.hasOwn(prepQuery('sapling',0,undefined),'to_block'));
 assert.deepEqual(sharedPrepFields('sapling','height','txid,from,to'),defaults);
 assert.deepEqual(sharedPrepFields('sapling','time','txid,block_height'),defaults);
 assert.deepEqual(sharedPrepFields('headers','height,hash','txid'),defaultPrepFields('headers'));
});
test('block time uses UTC consistently and missing data stays missing',()=>{
 assert.equal(utcTimestamp(0),'1970-01-01 00:00:00');assert.equal(utcTimestamp(null),'—');
});
test('example presets demonstrate distinct filters and projections',()=>{
 const queries=examples.map(example=>prepQuery(example.id,0,undefined,defaultExampleMatch(example.id)));
 assert.ok(queries.every(q=>!Object.hasOwn(q,"limit")),"Playground presets omit optional transport limits");
 assert.equal(new Set(queries.map(q=>JSON.stringify(q))).size,10);
 assert.ok(new Set(queries.map(q=>JSON.stringify(q.field_selection))).size>=7);
 assert.deepEqual(prepQuery('versions',0,undefined,'6').transaction_filter,{versions:[6]});
 assert.ok(defaultPrepFields('address').transaction.includes('vout'));
 assert.ok(!defaultPrepFields('transactions').transaction.includes('vout'));
 assert.ok(defaultPrepFields('raw').transaction.includes('raw'));
 assert.equal(verifiedExample('raw').limit,1);
 assert.equal(verifiedExample('orchard').from,4515166);
});
test('shielded examples select lean public counts and use a pool union from block zero',()=>{
 const any=prepQuery('shielded',0,undefined);
 assert.deepEqual(any.transaction_filter,{shielded_pools:['sapling','orchard','ironwood']});
 assert.ok(!Object.hasOwn(any,'limit'));assert.ok(!Object.hasOwn(any,'to_block'));
 for(const name of ['shielded','sapling','orchard','ironwood']) assert.ok(!defaultPrepFields(name).transaction.includes('decoded'));
 assert.deepEqual(defaultPrepFields('sapling').transaction.slice(-2),['sapling_spend_count','sapling_output_count']);
 assert.ok(defaultPrepFields('orchard').transaction.includes('orchard_action_count'));
 assert.ok(defaultPrepFields('ironwood').transaction.includes('ironwood_action_count'));
 assert.deepEqual(prepQuery('ironwood',0).transaction_filter,{has_ironwood:true});
 assert.deepEqual(sharedPrepFields('shielded','height,time',any.field_selection.transaction.join(',')),any.field_selection);
});
test('bundle counts stay public structural counts and distinguish missing from zero',()=>{
 assert.deepEqual(shieldedComponentCounts({vShieldedSpend:[],vShieldedOutput:[{}],orchard:{actions:[{},{}]}}),{saplingSpends:0,saplingOutputs:1,orchardActions:2,ironwoodActions:null});
 assert.deepEqual(shieldedComponentCounts(null),{saplingSpends:null,saplingOutputs:null,orchardActions:null,ironwoodActions:null});
});
