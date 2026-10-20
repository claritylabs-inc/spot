// Preserved workflow replay; run from repository root. Runtime/private output stays in .context.
import {ConvexHttpClient} from 'convex/browser';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const config=JSON.parse(readFileSync('.convex/local/default/config.json','utf8'));
assert.deepEqual(config.ports,{cloud:8083,site:8084});
export const admin=new ConvexHttpClient('http://127.0.0.1:8083',{logger:false});admin.setAdminAuth(config.adminKey);
export async function guard(){const env=await admin.query('_system/cli/queryEnvironmentVariables:get',{name:'SPOT_ENV'});assert.equal(env.value,'local');for(const name of ['CL_ROUTER_URL','CL_ROUTER_SECRET'])assert.equal(await admin.query('_system/cli/queryEnvironmentVariables:get',{name}),null,'Shared router must be isolated');}
export async function data(table){return (await admin.query('_system/cli/tableData',{table,order:'desc',paginationOpts:{numItems:100,cursor:null}})).page;}
export async function mutate(fn,args){await guard();return admin.function(fn,undefined,args)}
