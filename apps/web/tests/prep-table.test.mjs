import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultPrepFields,prepQuery,sharedPrepFields} from '../src/lib/content.ts';
import {transactionKind,publicOutputPreview,utcTimestamp} from '../src/lib/prep-table.ts';
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
