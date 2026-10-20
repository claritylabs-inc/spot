import {execFileSync as verifyCandidate} from 'node:child_process';
if(verifyCandidate('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!=="cc8bb050c20f6cb45798da7c6eb986d4b0b884af")throw Error('Exact candidate guard failed');
// Preserved workflow replay; run from repository root. Runtime/private output stays in .context.
import {ConvexHttpClient} from 'convex/browser';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const config=JSON.parse(readFileSync('.convex/local/default/config.json','utf8'));
assert.deepEqual(config.ports,{cloud:8083,site:8084});
export const admin=new ConvexHttpClient('http://127.0.0.1:8083',{logger:false});admin.setAdminAuth(config.adminKey);
export async function guard(){const [env,url,secret]=await Promise.all(['SPOT_ENV','CL_ROUTER_URL','CL_ROUTER_SECRET'].map(name=>admin.query('_system/cli/queryEnvironmentVariables:get',{name})));assert.equal(env.value,'local');assert.equal(url,null,'Shared router must be isolated');assert.equal(secret,null,'Shared router must be isolated');}
export async function data(table){const rows=[];let cursor=null;for(let page=0;page<50;page++){const result=await admin.query('_system/cli/tableData',{table,order:'desc',paginationOpts:{numItems:100,cursor}});rows.push(...result.page);if(result.isDone)return rows;cursor=result.continueCursor;}throw Error('Local table exceeds bounded 5000-row QA read');}
export async function mutate(fn,args){await guard();return admin.function(fn,undefined,args)}
