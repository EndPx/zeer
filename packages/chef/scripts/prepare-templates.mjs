import {mkdir,copyFile} from 'node:fs/promises';
const output=new URL('../templates/shielded/',import.meta.url);
await mkdir(output,{recursive:true});
const sources={
 'schema.graphql':'examples/receipt-consumer/schema.graphql',
 'consumer.mjs':'examples/receipt-consumer/consumer.mjs',
 'consume.mjs':'examples/receipt-consumer/consume.mjs',
 'query.mjs':'examples/shielded-inbox/query.mjs',
 'query.graphql':'examples/shielded-inbox/query.graphql',
 'read-transaction.mjs':'examples/shielded-inbox/read-transaction.mjs',
 'install-scanner.mjs':'tools/scanner/install-scanner.mjs',
 'CONSUMER.md':'examples/receipt-consumer/README.md',
 'LICENSE':'LICENSE',
};
for(const [name,source]of Object.entries(sources))await copyFile(new URL('../../../'+source,import.meta.url),new URL(name,output));
console.error(`Prepared ${Object.keys(sources).length} explicit shielded template assets.`);
