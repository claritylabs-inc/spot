import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const checkoutUrl=pathToFileURL(resolve(process.env.QA_ROUTER_CHECKOUT)+'/');
const {browserTools}=await import(new URL('packages/server/src/browse/tools.ts',checkoutUrl));
const {CAPTCHA_CLICK_DESCRIPTION}=await import(new URL('packages/server/src/skills/browser.ts',checkoutUrl));
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const {CdpConnection}=await import(new URL('packages/server/src/browse/cdp.ts',checkoutUrl));
const {BrowserTargets}=await import(new URL('packages/server/src/browse/targets.ts',checkoutUrl));
const {createBrowserRuntime,skillBrowser}=await import(new URL('packages/server/src/browse/primitives.ts',checkoutUrl));
const {createSkillHarness}=await import(new URL('packages/server/src/skills/harness.ts',checkoutUrl));
const {solveCaptcha}=await import(new URL('packages/server/src/skills/challenge/captcha.ts',checkoutUrl));
const {executeDecision}=await import(new URL('packages/server/src/providers/decisions.ts',checkoutUrl));
const root=resolve(process.env.QA_PRIVATE_OUTPUT)+'/';
const events=[];let seq=0,spyCalls=0,requestIndex=0;
const hash=x=>createHash('sha256').update(x).digest('hex');
const log=(kind,data)=>{events.push({seq:++seq,time:new Date().toISOString(),kind,...data});writeFileSync(root+'trace.json',JSON.stringify(events,null,2),{mode:0o600});};
const prior=JSON.parse(readFileSync(new URL('../gate-4bbe20e-sol/gate-request-sanitized.json',import.meta.url)));
const goal=prior.state.goal;
assert(Buffer.from(goal).equals(Buffer.from(prior.state.goal)));
const chrome=spawn('google-chrome',['--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=9222','--remote-debugging-address=127.0.0.1','--user-data-dir='+root+'chrome-profile','--window-size=1024,856','about:blank'],{env:{...process.env,DISPLAY:':99'},stdio:'ignore'});
let cdp;
const controller=new AbortController();
const budget=setTimeout(()=>controller.abort(),6*60_000);
try{
 let version;for(let i=0;i<100;i++){try{version=await fetch('http://127.0.0.1:9222/json/version').then(r=>r.json());break;}catch{await new Promise(r=>setTimeout(r,100));}}
 if(!version)throw Error('Chrome unavailable');
 cdp=await CdpConnection.connect(version.webSocketDebuggerUrl,controller.signal);
 let targets;
 const send=cdp.send.bind(cdp);
 cdp.send=async(method,params={},sessionId)=>{
  const result=await send(method,params,sessionId);
  if(method==='Page.captureScreenshot'){
   const bytes=Buffer.from(result.data,'base64'),sha256=hash(bytes),file='capture-'+sha256+'.png';writeFileSync(root+file,bytes,{mode:0o600});
   log('cdp_capture',{method,sessionId,topSession:sessionId===targets?.active()?.sessionId,sha256,file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)});
  }else if(method.startsWith('Input.') || method==='Emulation.setDeviceMetricsOverride')log('cdp',{method,params,sessionId});
  return result;
 };
 const state={domains:['2captcha.com'],adoptedDomains:[],redirects:new Set(),pages:new Map(),networkHosts:new Set(),signupSubmissions:0};
 targets=new BrowserTargets(cdp,{sandbox:true,networkHosts:state.networkHosts,signal:controller.signal});await targets.start();
 const runtime=createBrowserRuntime({cdp,targets,state,isSandbox:true,signal:controller.signal,tenantId:'spot-authorized-gate-qa',environment:process.env});
 await runtime.navigateTop('https://2captcha.com/demo/cloudflare-turnstile');await runtime.wait(5);
 const actorDescription=browserTools(runtime,{sandbox:true,identity:false,uploads:false,downloads:false,emailAcceptance:false}).captcha_click.description;
 assert.equal(actorDescription,CAPTCHA_CLICK_DESCRIPTION);
 const browser=skillBrowser(runtime,{identity:false,inbox:false,sandbox:true,uploads:false,downloads:false,allowed:state.domains});
 // The sole host seam: all other candidate primitives remain unchanged.
 browser.captchaClick=async(target)=>{spyCalls++;log('diagnostic_stop_spy',{target,call:spyCalls});return {ok:false,error:'Gate diagnostic stops before native dispatch'};};
 const decide=async(request,signal)=>{
  const actualRequest={tenantId:'spot-authorized-gate-qa',...request};
  if(request.questions.relevant){
   assert.equal(request.state.goal,goal);
   assert.equal(JSON.stringify(request.questions),JSON.stringify(prior.questions));
   assert.equal(request.state.action.tool,'captcha_click');
   assert.equal(request.state.action.primitive,'captchaClick');
   assert.equal(request.state.action.description,CAPTCHA_CLICK_DESCRIPTION);
   assert.equal(request.state.action.description,actorDescription);
  }
  const privateRequestFile='model-request-'+String(++requestIndex).padStart(3,'0')+'.json';
  const requestJson=JSON.stringify(actualRequest);
  writeFileSync(root+privateRequestFile,requestJson,{mode:0o600});
  const images=Object.entries(request.assets??{}).map(([ref,a])=>{
   const bytes=Buffer.from(a.dataBase64,'base64'),sha256=hash(bytes),file='model-'+sha256+'.png';writeFileSync(root+file,bytes,{mode:0o600});
   return {ref,sha256,file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
  });
  const metadata={privateRequestFile,originalRequestSha256:hash(requestJson),originalStateSha256:hash(JSON.stringify(request.state)),questionIds:Object.keys(request.questions),questions:request.questions,images:images.map(({ref,...x})=>x),stateFields:Object.keys(request.state),...(request.state.observation?{observationFields:Object.keys(request.state.observation)}:{}),screenshotReferenceMatchesAsset:images.some(x=>x.ref===(request.state.observation?.screenshot??request.state.screenshot)),...(request.state.action?{action:request.state.action,visualEvidence:request.state.observation?.visualEvidence??request.state.visualEvidence,goalUtf8Sha256:hash(Buffer.from(request.state.goal)),questionsJsonSha256:hash(JSON.stringify(request.questions)),goalExactlyMatches4bbe:true,questionsExactlyMatch4bbe:true,descriptionEqualsProductionConstant:request.state.action.description===CAPTCHA_CLICK_DESCRIPTION,descriptionEqualsActorTool:request.state.action.description===actorDescription}:{})};
  log('model_request',metadata);
  const response=await executeDecision(actualRequest,{abortSignal:signal,fetch:async(url,init)=>{const r=await fetch(url,init);log('provider_http',{status:r.status});return r;}});
  log('model_response',{questionIds:metadata.questionIds,model:response.model,answers:response.answers});return response;
 };
 const deadline=Date.now()+5*60_000;
 const harness=createSkillHarness({goal,browser,capabilities:new Set(['browser','jev','jev_box']),decide,signal:controller.signal,remainingMs:()=>Math.max(0,deadline-Date.now()),recordAction:a=>log('skill_action',a),recordSkill:r=>log('skill_record',r)});
 log('run',{candidate:'d28fb67ae6c5d05c4294f31b9f8b5d96712ff31d',browser:version.Browser,node:process.version,goal,scope:'one actual skill invocation with only host captchaClick replaced by diagnostic-stop spy'});
 const outcome=await harness.invoke(solveCaptcha,{});log('skill_outcome',{outcome,spyCalls});
 const resultImage=Buffer.from(await runtime.screenshot(),'base64');writeFileSync(root+'result.png',resultImage,{mode:0o600});
 const result={candidate:'d28fb67ae6c5d05c4294f31b9f8b5d96712ff31d',spyCalls,outcome,inputCommands:events.filter(e=>e.kind==='cdp'&&e.method.startsWith('Input.')).length};
 writeFileSync(root+'result.json',JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify(result));
}finally{clearTimeout(budget);controller.abort();cdp?.close();chrome.kill('SIGTERM');}
