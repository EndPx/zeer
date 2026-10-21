import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export function verifyProjection({headers,rows,from,checkpoint}){
 assert.equal(headers.length,checkpoint.height-from+1);
 for(let i=0;i<headers.length;i++){assert.equal(headers[i].height,from+i);if(i)assert.equal(headers[i].previous_hash,headers[i-1].hash);}
 assert.equal(headers.at(-1).hash,checkpoint.hash);
 const expected=headers.flatMap(block=>Array.from({length:12},(_,i)=>({id:`${block.height}:${i}`,blockHeight:block.height,blockHash:block.hash,observationIndex:i,value:(BigInt(block.height)*12n+BigInt(i)).toString()})));
 expected.sort((a,b)=>a.blockHeight-b.blockHeight||Buffer.compare(Buffer.from(a.id),Buffer.from(b.id)));
 assert.deepEqual(rows,expected);assert.equal(new Set(rows.map(row=>row.id)).size,expected.length);
 return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
