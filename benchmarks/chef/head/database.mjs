import assert from 'node:assert/strict';
import pg from 'pg';
import {digest} from './common.mjs';

export function databaseBudget(deadline){
  const remaining=Math.floor(deadline-performance.now());
  assert.ok(remaining>0,'Database snapshot deadline');return Math.min(5000,remaining);
}

export async function closeDatabaseClient(client,deadline){
  const timeout=Math.max(1,Math.min(1000,Math.floor(deadline-performance.now())));
  let timer;
  try{
    await Promise.race([client.end(),new Promise((_,reject)=>{timer=setTimeout(()=>{
      client.connection?.stream?.destroy();reject(new Error('Database teardown deadline'));
    },timeout);})]);
  }finally{clearTimeout(timer);}
}

export async function readDatabaseSnapshot({connectionString,project,deadline}){
  assert.match(project,/^head_[a-f0-9]{22}$/);
  const timeout=databaseBudget(deadline);
  const client=new pg.Client({connectionString,connectionTimeoutMillis:timeout,query_timeout:timeout,
    statement_timeout:timeout,lock_timeout:timeout,idle_in_transaction_session_timeout:timeout});
  const query=text=>client.query({text,query_timeout:databaseBudget(deadline)});
  try{
    await client.connect();
    await query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const state=(await query(`SELECT height,hash,status FROM "chef_${project}".state WHERE singleton=true`)).rows[0];
    const entities={BlockSummary:[],TransactionMeta:[],Totals:[]};
    for(const row of(await query(`SELECT entity,data FROM "chef_${project}".entities ORDER BY entity,id`)).rows){assert.ok(Object.hasOwn(entities,row.entity));entities[row.entity].push(row.data);}
    await query('COMMIT');
    return {checkpoint:{height:Number(state.height),hash:state.hash},read_status:state.status,entities,sha256:digest(entities)};
  }finally{await closeDatabaseClient(client,deadline);}
}
