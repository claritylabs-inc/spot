import {spawn,execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';

const candidate='857074d99baa09792b66a45d65a3ca73aef53719';
const checkout=resolve(process.env.QA_ROUTER_CHECKOUT),root=resolve(process.env.QA_PRIVATE_OUTPUT);
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:checkout,encoding:'utf8'}).trim(),candidate);
const url=path=>pathToFileURL(join(checkout,path)).href;
const hash=value=>createHash('sha256').update(value).digest('hex');
const save=(name,value)=>writeFileSync(join(root,name),typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value,null,2),{mode:0o600});
const events=[];let seq=0,site='setup',requestIndex=0,nativeCalls=0;
const log=(kind,data)=>{events.push({seq:++seq,time:dayjs().toISOString(),site,kind,...data});save('trace.json',events);};
const goals=JSON.parse(readFileSync(join(root,'goals.json')));
const captureImage=(bytes,prefix)=>{const sha256=hash(bytes),file=prefix+'-'+sha256+'.png';save(file,bytes);return {sha256,file,bytes:bytes.length,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};};
const actualFetch=globalThis.fetch;
async function observedDecision(actual,input,options={},origin){
 const id='request-'+String(++requestIndex).padStart(3,'0');
 const json=JSON.stringify(input);save(id+'.json',json);
 const images=Object.entries(input.assets??{}).map(([ref,asset])=>({ref,...captureImage(Buffer.from(asset.dataBase64,'base64'),'model')}));
 log('logical_request',{id,origin,privateFile:id+'.json',sha256:hash(json),stateSha256:hash(JSON.stringify(input.state)),questionIds:Object.keys(input.questions),questions:input.questions,images,stateFields:Object.keys(input.state),...(input.state.action?{action:input.state.action}:{})});
 let attempts=0;
 try{
  const response=await actual(input,{...options,fetch:async(endpoint,init)=>{
   attempts++;save(id+'-wire-'+attempts+'.json',init.body);
   const wire=JSON.parse(init.body);assert.deepEqual(wire.state,input.state);assert.deepEqual(wire.questions,input.questions);
   log('provider_request',{id,attempt:attempts,modelRequested:wire.model,stateAndQuestionsEqualLogical:true});
   const response=await actualFetch(endpoint,init);
   const errorBody=response.ok?undefined:await response.clone().json().catch(()=>null);
   const safe=value=>typeof value==='string'?value.replace(/[A-Za-z0-9_.~+/-]{80,}/g,'[long value omitted]').slice(0,240):undefined;
   log('provider_http',{id,attempt:attempts,status:response.status,...(errorBody?{validation:{errorType:safe(errorBody.detail?.error_type),message:safe(errorBody.detail?.message)}}:{})});
   return response;
  }});
  log('model_response',{id,origin,model:response.model,answers:response.answers,attempts});return response;
 }catch(error){log('model_failure',{id,origin,errorClass:error.name,code:error.code,attempts});throw error;}
}
// Observation-only import binding: canonical primitive/provider files stay unchanged.
// The wrapper receives the actual logical object, saves it before inference, and
// delegates unchanged arguments to the actual candidate provider implementation.
globalThis[Symbol.for('spot.qa.nativeDecision')]=(actual,input,options)=>observedDecision(actual,input,options,'native');
const wrapper=join(root,'decision-observer.mjs');
save('decision-observer.mjs',`import {executeDecision as actual} from ${JSON.stringify(url('packages/server/src/providers/decisions.ts'))};\nexport const executeDecision=(input,options)=>globalThis[Symbol.for('spot.qa.nativeDecision')](actual,input,options);\n`);
let importBindings=0;
const hooks=registerHooks({resolve(specifier,context,next){
 if(context.parentURL===url('packages/server/src/browse/primitives.ts')&&specifier==='../providers/decisions.js'){
  importBindings++;return {url:pathToFileURL(wrapper).href,shortCircuit:true};
 }
 return next(specifier,context);
}});
const {CdpConnection}=await import(url('packages/server/src/browse/cdp.ts'));
const {BrowserTargets}=await import(url('packages/server/src/browse/targets.ts'));
const {createBrowserRuntime,skillBrowser}=await import(url('packages/server/src/browse/primitives.ts'));
const {createSkillHarness}=await import(url('packages/server/src/skills/harness.ts'));
const {solveCaptcha}=await import(url('packages/server/src/skills/challenge/captcha.ts'));
const {executeDecision}=await import(url('packages/server/src/providers/decisions.ts'));
assert.equal(importBindings,1,'Native logical request observer must be bound before browser startup');
log('source_binding',{candidate,importBindings,wrapperSha256:hash(readFileSync(wrapper)),primitiveSourceSha256:hash(readFileSync(join(checkout,'packages/server/src/browse/primitives.ts'))),providerSourceSha256:hash(readFileSync(join(checkout,'packages/server/src/providers/decisions.ts')))});
if(process.env.QA_IMPORT_ONLY==='1'){hooks.deregister();console.log('Source import binding ready; no browser/provider call.');process.exit(0);}

const controller=new AbortController();
const chrome=spawn('google-chrome',['--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=9222','--remote-debugging-address=127.0.0.1','--user-data-dir='+join(root,'chrome-profile'),'--window-size=1024,856','about:blank'],{env:{...process.env,DISPLAY:':99'},stdio:'ignore'});
let cdp,targets;
const results=[];
try{
 let version;for(let i=0;i<100;i++){try{version=await actualFetch('http://127.0.0.1:9222/json/version').then(response=>response.json());break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}
 assert(version,'Chrome must start');
 cdp=await CdpConnection.connect(version.webSocketDebuggerUrl,controller.signal);
 const send=cdp.send.bind(cdp);
 cdp.send=async(method,params={},sessionId)=>{
  const began=dayjs().valueOf();
  try{
   const result=await send(method,params,sessionId);
   if(method==='Page.captureScreenshot')log('cdp_capture',{method,sessionId,topSession:sessionId===targets?.active()?.sessionId,params:{format:params.format,clip:params.clip},...captureImage(Buffer.from(result.data,'base64'),'capture')});
   else if(method.startsWith('Input.')||['DOM.getFrameOwner','DOM.getBoxModel','DOM.getNodeForLocation','Page.getLayoutMetrics','Emulation.setDeviceMetricsOverride'].includes(method))log('cdp',{method,params,sessionId,topSession:sessionId===targets?.active()?.sessionId,result,durationMs:dayjs().valueOf()-began});
   return result;
  }catch(error){log('cdp_error',{method,sessionId,errorClass:error.name});throw error;}
 };
 const networkHosts=new Set();
 targets=new BrowserTargets(cdp,{sandbox:true,networkHosts,signal:controller.signal});await targets.start();
 const frames=targets.frames.bind(targets);
 targets.frames=async(...args)=>{const result=await frames(...args);log('frame_inventory',{frames:result.map(frame=>{let location;try{const u=new URL(frame.url);location=u.origin+u.pathname;}catch{location='(non-http frame)';}return {frameId:frame.frameId,location};})});return result;};
 const generation=targets.generation.bind(targets),seen=new Map();
 targets.generation=frameId=>{const value=generation(frameId);if(seen.get(frameId)!==value){seen.set(frameId,value);log('generation',{frameId,generation:value});}return value;};
 for(const entry of [{site:'recaptcha-v2',url:'https://2captcha.com/demo/recaptcha-v2',goal:goals.v2},{site:'turnstile',url:'https://2captcha.com/demo/cloudflare-turnstile',goal:goals.turnstile}]){
  site=entry.site;const job=new AbortController(),timer=setTimeout(()=>job.abort(),6*60*1000);
  const signal=AbortSignal.any([controller.signal,job.signal]);
  const state={domains:['2captcha.com'],adoptedDomains:[],redirects:new Set(),pages:new Map(),networkHosts,signupSubmissions:0};
  const runtime=createBrowserRuntime({cdp,targets,state,isSandbox:true,signal,tenantId:'spot-authorized-live-qa',environment:process.env});
  const browser=skillBrowser(runtime,{identity:false,inbox:false,sandbox:true,uploads:false,downloads:false,allowed:state.domains});
  const originalNative=browser.captchaClick;
  browser.captchaClick=async target=>{nativeCalls++;log('native_entry',{target,call:nativeCalls});const result=await originalNative(target);log('native_return',{ok:result.ok,...(!result.ok?{error:result.error}:{})});return result;};
  try{
   await runtime.navigateTop(entry.url);await runtime.wait(5);
   const deadline=dayjs().valueOf()+5*60*1000;
   const harness=createSkillHarness({goal:entry.goal,browser,capabilities:new Set(['browser','jev','jev_box']),decide:(request,signal)=>observedDecision(executeDecision,{tenantId:'spot-authorized-live-qa',...request},{abortSignal:signal},'skill'),signal,remainingMs:()=>Math.max(0,deadline-dayjs().valueOf()),recordAction:action=>log('skill_action',action),recordSkill:record=>log('skill_record',record)});
   log('job_start',{candidate,browser:version.Browser,node:process.version,url:entry.url,goal:entry.goal,goalSha256:hash(Buffer.from(entry.goal)),scope:'one actual skill invocation, native primitives; no stop spy'});
   const outcome=await harness.invoke(solveCaptcha,{});log('skill_outcome',{outcome});save(site+'-outcome.json',outcome);
   const image=Buffer.from(await runtime.screenshot(),'base64');save(site+'-result.png',image);
   results.push({site,outcome,resultImage:{file:site+'-result.png',sha256:hash(image)},nativeCalls:events.filter(event=>event.site===site&&event.kind==='native_entry').length,inputCommands:events.filter(event=>event.site===site&&event.kind==='cdp'&&event.method.startsWith('Input.')).length});
  }catch(error){log('job_failure',{errorClass:error.name,code:error.code});results.push({site,errorClass:error.name,code:error.code});}
  finally{clearTimeout(timer);job.abort();}
  save('results.json',{candidate,results});
 }
 console.log(JSON.stringify({candidate,results:results.map(({site,outcome,nativeCalls,inputCommands,errorClass,code})=>({site,status:outcome?.status,data:outcome?.data,nativeCalls,inputCommands,errorClass,code}))}));
}finally{controller.abort();cdp?.close();chrome.kill('SIGTERM');hooks.deregister();delete globalThis[Symbol.for('spot.qa.nativeDecision')];}
