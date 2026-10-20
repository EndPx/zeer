import test from 'node:test';
import assert from 'node:assert/strict';
import {formatZat,outputZat,outputDestination,publicFee,coinbaseValue,pools} from '../src/lib/transaction-view.ts';
test('public coinbase value distinguishes transparent reward and shielded net inflow exactly',()=>{
 const transparent={vin:[{coinbase:'00'}],vout:[{valueZat:'26041666'}]};
 assert.equal(formatZat(coinbaseValue(transparent)),'0.26041666 test ZEC');assert.equal(publicFee(transparent,true),0n);
 const privateReward={vin:[{coinbase:'00'}],vout:[],ironwood:{actions:[{}],valueBalanceZat:'-26057666'}};
 assert.equal(coinbaseValue(privateReward),26057666n);assert.equal(pools(privateReward)[0].name,'Ironwood');
 assert.equal(publicFee(privateReward,true),0n);
});
test('fee derives only from available public balances without resolving transparent prevouts',()=>{
 const shielded={vin:[],vout:[],ironwood:{actions:[{},{}],valueBalanceZat:'15000'}};
 assert.equal(formatZat(publicFee(shielded,false)),'0.00015000 test ZEC');
 assert.equal(publicFee({...shielded,vin:[{txid:'previous',vout:'0'}]},false),null);
 assert.equal(publicFee({...shielded,ironwood:{actions:[{}]}},false),null);
 assert.equal(publicFee({...shielded,ironwood:{actions:[{}],valueBalanceZat:'-1'}},false),null);
});
test('amounts and destinations preserve integer precision without inventing receivers',()=>{
 assert.equal(outputZat({valueZat:'9007199254740993'}),9007199254740993n);
 assert.equal(outputZat({value:'0.00000001'}),1n);assert.equal(outputZat({value:0.1}),null);
 assert.equal(outputDestination({scriptPubKey:{addresses:['tPublic']}}),'tPublic');
 assert.equal(outputDestination({scriptPubKey:{type:'pubkey'}}),'pubkey script');
 assert.equal(outputDestination({}),'Address not provided');
 assert.equal(formatZat(null),'Not provided');
});
