import {execFileSync as verifyCandidate} from 'node:child_process';
if(verifyCandidate('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!=="cc8bb050c20f6cb45798da7c6eb986d4b0b884af")throw Error('Exact candidate guard failed');
// Preserved workflow replay; run from repository root. Runtime/private output stays in .context.
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {ConvexHttpClient} from 'convex/browser';
import {anyApi} from 'convex/server';
import {rows,run} from './local-backend.mjs';
const {signInWithEmailCode}=await import(process.env.QA_CHECKOUT+'/scripts/lib/local-convex-e2e.mjs');
import {writeFileSync} from 'node:fs';
const runId=crypto.randomUUID();
const org=rows('organizations').find(o=>o.name==='Cove');const users=rows('users');const op=users.find(u=>u.email==='terry@claritylabs.inc');const clientUser=users.find(u=>u.email==='adyan@cove.dev');const results=[];
const client=new ConvexHttpClient('http://127.0.0.1:8083',{logger:false});
await assert.rejects(client.query(anyApi.websiteTech.getForOperator,{orgId:org._id}));results.push('Anonymous websiteTech query rejected');
await signInWithEmailCode(client,anyApi,clientUser.email);
await assert.rejects(client.query(anyApi.websiteTech.getForOperator,{orgId:org._id}));results.push('Signed-in tenant websiteTech query rejected');
assert.throws(()=>run('operatorAgent:invokeRegisteredToolInternal',{operatorUserId:clientUser._id,channel:'mcp',toolName:'get_organization',input:{orgId:org._id},idempotencyKey:`skill-qa-client-denial:${runId}`,conversationKey:'skill-qa-consumer'}));results.push('Actual registered operator executor rejects client actor');
const result=run('operatorAgent:invokeRegisteredToolInternal',{operatorUserId:op._id,channel:'mcp',toolName:'get_organization',input:{orgId:org._id},idempotencyKey:`skill-qa-safe-read:${runId}`,conversationKey:'skill-qa-consumer'});assert(Object.hasOwn(result.outcome.result,'websiteTech'));results.push('Actual local registered get_organization succeeds for authorized operator with current stored profile; null-before-scan is not a fresh final-run assertion');
const s=await createServer({root:process.cwd(),server:{middlewareMode:true},appType:'custom',configFile:false});try{const m=await s.ssrLoadModule('/convex/lib/tenantMcpToolCatalog.ts');for(const name of ['get_organization','research_client_tech_stack']){assert(!m.tenantMcpToolNames().includes(name));assert.throws(()=>m.resolveTenantMcpToolCall(name,{},true),/Unknown tool/)}results.push('Actual imported tenant catalog and dispatcher exclude both operator tools')}finally{await s.close()}
writeFileSync('.context/qa/final-consumer-cc8bb050-sol/access-results.json',JSON.stringify({scope:'Verified native-local backend; registered internal executor with channel mcp, not HTTP/OAuth transport',results},null,2));console.log(results.map(x=>'PASS '+x).join('\n'));
