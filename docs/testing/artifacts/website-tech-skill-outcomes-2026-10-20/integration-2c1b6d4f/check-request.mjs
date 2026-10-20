// Offline source-function + actual consumer transport capture. No Convex/provider calls.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import Ajv2020 from 'ajv/dist/2020.js';
import {createServer} from 'vite';

const candidate='2c1b6d4fbb1570c065ea5e0470b74c74c41489bb';
const root=path.resolve(process.argv[2]??'.');
assert.equal(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),candidate,'Use the exact isolated candidate checkout');
const out=path.resolve(process.argv[3]??'.context/qa/skill-integration-2c1b6d4f/request-results.json');
mkdirSync(path.dirname(out),{recursive:true});
const source=readFileSync(path.join(root,'convex/actions/websiteTech.ts'),'utf8');
const file=ts.createSourceFile('websiteTech.ts',source,ts.ScriptTarget.Latest,true);
const names=new Set(['CATEGORIES','findingsSchema','BROWSE_GOAL']);
const functions=new Set(['settle','browseCompanySite']);
const selected=file.statements.filter(node=>
 ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>names.has(d.name.getText(file)))||
 ts.isFunctionDeclaration(node)&&functions.has(node.name?.text));
assert.equal(selected.length,5);
const code=ts.transpileModule(selected.map(n=>n.getText(file)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const spec=JSON.parse(readFileSync(path.join(root,'contracts/cl-router/openapi.v1.json'),'utf8'));
const ajv=new Ajv2020({strict:true,allErrors:true,validateFormats:false});
const id=name=>'https://spot.local/integration/schemas/'+name;
const refs=value=>Array.isArray(value)?value.map(refs):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,key==='$ref'&&typeof item==='string'?item.replace('#/components/schemas/', 'https://spot.local/integration/schemas/'):refs(item)])):value;
for(const [name,schema] of Object.entries(spec.components.schemas))ajv.addSchema({...refs(schema),$id:id(name)});
const validate=ajv.getSchema(id('BrowseRequest'));
const expected=['site.find_pages','page.dismiss_overlays','account.signup','account.sign_in','inbox.wait_for_email','account.verify_email','account.enter_otp','challenge.captcha','checkout.observe_payment'];
const checks=[];const captures=[];
const pass=(name)=>{checks.push({name,status:'PASS'});console.log('PASS '+name)};
const syntheticReply={provider:'sandbox',model:'offline-fixture',finished:false,steps:0,text:'',pages:[],networkHosts:[]};
const server=await createServer({root,configFile:false,appType:'custom',server:{middlewareMode:true}});
try{
 const {clRouterBrowse}=await server.ssrLoadModule('/convex/lib/clRouterClient.ts');
 for(const mode of ['identity-and-inbox','identity-without-inbox','identity-creation-fails']){
  let body;let traceOptions;
  const identity={email:'synthetic@example.com',name:'Synthetic QA',password:randomBytes(24).toString('base64url'),...(mode==='identity-and-inbox'?{inboxUrl:'https://local.invalid/research-inbox?token='+randomBytes(24).toString('base64url')}:{})};
  const ctx={offline:true};const trace={traceId:'qa-website-tech-integration',channel:'company_research'};
  const context=vm.createContext({z,signupIdentity:async()=>{if(mode==='identity-creation-fails')throw new Error('Synthetic identity issuance failure');return identity},clRouterBrowse,durableRouterClientOptionsWithTrace:(observedCtx,options)=>{assert.equal(observedCtx,ctx);traceOptions=options;return {executeJob:async(operation,payload)=>{assert.equal(operation,'browse');body=payload;return syntheticReply}}}});
  vm.runInContext(code,context);
  const result=await context.browseCompanySite(ctx,'skill-qa.example',trace);
  assert.equal(result.response,syntheticReply);
  assert(validate(body),'Actual serialized request must satisfy the pinned strict schema');
  assert.deepEqual([...body.config.skills],expected);
  assert.equal(body.config.skills.includes('account.cleanup'),false);
  assert.deepEqual(Object.keys(body).sort(),['config','executionBudgetMs','input','tenantId']);
  assert.equal(typeof body.tenantId,'string');assert(body.tenantId.length>0);
  assert.equal(body.executionBudgetMs,360000);assert.equal(body.input.maxSteps,30);
  assert.deepEqual({...traceOptions},{...trace,taskKind:'website_tech_browse'});
  assert(!Object.hasOwn(body,'trace'));assert(!Object.hasOwn(body.input,'trace'));assert(!Object.hasOwn(body.config,'executionBudgetMs'));
  for(const text of ['resume only from the observed state','submitting signup is not proof of account creation','Do not delete accounts','without entering payment details'])assert(body.input.goal.includes(text));
  assert.equal(Object.hasOwn(body.input,'signup'),mode!=='identity-creation-fails');
  captures.push({mode,valid:true,bodyKeys:Object.keys(body),tenantInjected:true,skills:[...body.config.skills],signupPresent:!!body.input.signup,inboxPresent:!!body.input.signup?.inboxUrl,traceInBody:false,durableTraceKeys:Object.keys(traceOptions),executionBudgetMs:body.executionBudgetMs,maxSteps:body.input.maxSteps,goalLength:body.input.goal.length});
  pass(mode+': source request + real serializer valid; exact nine skills, cleanup excluded, trace/options separated');
  if(mode==='identity-creation-fails'){
   let legacy;
   const request={input:body.input,executionBudgetMs:360000};
   const response=await clRouterBrowse(request,{executeJob:async(_operation,payload)=>{legacy=payload;return syntheticReply}});
   assert(validate(legacy));assert(!Object.hasOwn(legacy,'config'));assert.equal(response.skills,undefined);
   pass('No-config request and old response without skills remain compatible');
   let disabled;await clRouterBrowse({...request,config:{skills:[]}},{executeJob:async(_operation,payload)=>{disabled=payload;return syntheticReply}});assert(validate(disabled));assert.deepEqual(disabled.config.skills,[]);
   pass('Explicit empty skill list remains schema/transport compatible');
  }
 }
 const vocabulary=spec.components.schemas.BrowseRequest.properties.config.properties.skills.items.enum;
 assert.equal(vocabulary.length,10);assert.equal(new Set(vocabulary).size,10);assert(vocabulary.includes('account.cleanup'));assert(expected.every(name=>vocabulary.includes(name)));
 pass('Pinned contract supports all ten names; research selects nine rather than relying on defaults');
}finally{await server.close();writeFileSync(out,JSON.stringify({candidate,scope:'Executed actual browseCompanySite/goal/schema source extracted via TypeScript, with in-memory identity and durable-options seams, through actual imported candidate clRouterBrowse. Strict Ajv validation; no full Convex action, router runtime, provider or UI acceptance.',checks,captures},null,2)+'\n')}
