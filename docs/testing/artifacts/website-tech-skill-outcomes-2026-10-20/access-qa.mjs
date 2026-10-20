// Preserved workflow replay; run from repository root. Runtime/private output stays in .context.
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {ConvexHttpClient} from 'convex/browser';
import {anyApi} from 'convex/server';
import {rows,run,signInWithEmailCode} from '../../../../scripts/lib/local-convex-e2e.mjs';
import {writeFileSync} from 'node:fs';
const runId=crypto.randomUUID();
const org=rows('organizations').find(o=>o.name==='Cove');const users=rows('users');const op=users.find(u=>u.email==='terry@claritylabs.inc');const clientUser=users.find(u=>u.email==='adyan@cove.dev');const results=[];
const client=new ConvexHttpClient('http://127.0.0.1:8083',{logger:false});
await assert.rejects(client.query(anyApi.websiteTech.getForOperator,{orgId:org._id}));results.push('Anonymous websiteTech query rejected');
await signInWithEmailCode(client,anyApi,clientUser.email);
await assert.rejects(client.query(anyApi.websiteTech.getForOperator,{orgId:org._id}));results.push('Signed-in tenant websiteTech query rejected');
assert.throws(()=>run('operatorAgent:invokeRegisteredToolInternal',{operatorUserId:clientUser._id,channel:'mcp',toolName:'get_organization',input:{orgId:org._id},idempotencyKey:`skill-qa-client-denial:${runId}`,conversationKey:'skill-qa-consumer'}));results.push('Actual registered operator executor rejects client actor');
const result=JSON.parse(run('operatorAgent:invokeRegisteredToolInternal',{operatorUserId:op._id,channel:'mcp',toolName:'get_organization',input:{orgId:org._id},idempotencyKey:`skill-qa-safe-read:${runId}`,conversationKey:'skill-qa-consumer'}));assert.equal(result.outcome.result.websiteTech,null);results.push('Actual local registered get_organization succeeds with websiteTech:null before scan');
const s=await createServer({server:{middlewareMode:true},appType:'custom',configFile:false});try{const m=await s.ssrLoadModule('/convex/lib/tenantMcpToolCatalog.ts');for(const name of ['get_organization','research_client_tech_stack']){assert(!m.tenantMcpToolNames().includes(name));assert.throws(()=>m.resolveTenantMcpToolCall(name,{},true),/Unknown tool/)}results.push('Actual imported tenant catalog and dispatcher exclude both operator tools')}finally{await s.close()}
writeFileSync('.context/qa/skill-outcomes-sol/access-results.json',JSON.stringify({scope:'Verified native-local backend; registered internal executor with channel mcp, not HTTP/OAuth transport',results},null,2));console.log(results.map(x=>'PASS '+x).join('\n'));
