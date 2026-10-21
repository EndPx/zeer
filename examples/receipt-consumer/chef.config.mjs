import {defineConfig,decodeMemo} from '@zeer-dev/chef';

export default defineConfig({
  project:process.env.ZEER_PROJECT??'receipt_reference',
  network:'testnet',
  startHeight:Number(process.env.ZEER_BIRTHDAY_HEIGHT),
  schema:'./schema.graphql',handlerVersion:'receipt-reference-v1',reorgWindow:100,
  shielded:{accountId:process.env.ZEER_ACCOUNT_ID??'inbox',keyFingerprint:process.env.ZEER_KEY_FINGERPRINT??''},
  sync:{pageSize:16,batchSize:1,transactionFilter:{shielded_pools:['sapling','orchard','ironwood']}},
  indexer:{async receipt({block,receipt,context}){
    await context.entities.set('ReadableNote',{
      id:receipt.id,txid:receipt.txid,pool:receipt.pool,outputIndex:receipt.output_index,
      blockHeight:block.height,blockHash:block.hash,valueZat:BigInt(receipt.value_zat),
      receiver:receipt.receiver,memoHex:receipt.memo_hex,...decodeMemo(receipt.memo_hex),
      scope:receipt.scope,origin:receipt.origin,coinbase:receipt.is_coinbase,
    });
  }},
});
