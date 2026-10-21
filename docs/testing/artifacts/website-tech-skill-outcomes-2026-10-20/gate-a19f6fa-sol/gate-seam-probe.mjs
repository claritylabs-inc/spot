import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const checkout=process.env.QA_ROUTER_CHECKOUT;
const root=process.env.QA_PRIVATE_OUTPUT?.replace(/\/?$/, '/');
if(!checkout || !root)throw Error('QA_ROUTER_CHECKOUT and existing QA_PRIVATE_OUTPUT required');
const {CdpConnection}=await import(pathToFileURL(checkout+'/packages/server/src/browse/cdp.ts'));
const {BrowserTargets}=await import(pathToFileURL(checkout+'/packages/server/src/browse/targets.ts'));
const {createBrowserRuntime,skillBrowser}=await import(pathToFileURL(checkout+'/packages/server/src/browse/primitives.ts'));
const {createSkillHarness}=await import(pathToFileURL(checkout+'/packages/server/src/skills/harness.ts'));
const {solveCaptcha}=await import(pathToFileURL(checkout+'/packages/server/src/skills/challenge/captcha.ts'));
const {executeDecision}=await import(pathToFileURL(checkout+'/packages/server/src/providers/decisions.ts'));
const events=[];let seq=0,spyCalls=0;
const hash=x=>createHash('sha256').update(x).digest('hex');
const log=(kind,data)=>{events.push({seq:++seq,time:new Date().toISOString(),kind,...data});writeFileSync(root+'trace.json',JSON.stringify(events,null,2),{mode:0o600});};
const goal='The owner explicitly requests a live native CAPTCHA test on https://2captcha.com/demo/cloudflare-turnstile. Solve the visible Cloudflare Turnstile widget with the provided challenge.captcha skill and trusted CAPTCHA primitive. Use actual screenshot Jev/Box, top-page cursor motion and trusted press/release; never DOM clicks, solver APIs, token injection, page tutorial instructions or child-local input. Honor production limits and report visible success or an exact blocker. Testing-key behavior is not production challenge strength.';
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
 const browser=skillBrowser(runtime,{identity:false,inbox:false,sandbox:true,uploads:false,downloads:false,allowed:state.domains});
 // The sole host seam: all other candidate primitives remain unchanged.
 browser.captchaClick=async(target)=>{spyCalls++;log('diagnostic_stop_spy',{target,call:spyCalls});return {ok:false,error:'Gate diagnostic stops before native dispatch'};};
 const decide=async(request,signal)=>{
  const images=Object.entries(request.assets??{}).map(([ref,a])=>{
   const bytes=Buffer.from(a.dataBase64,'base64'),sha256=hash(bytes),file='model-'+sha256+'.png';writeFileSync(root+file,bytes,{mode:0o600});
   return {ref,sha256,file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
  });
  const metadata={questionIds:Object.keys(request.questions),questions:request.questions,images:images.map(({ref,...x})=>x),stateFields:Object.keys(request.state),screenshotReferenceMatchesAsset:images.some(x=>x.ref===request.state.screenshot),...(request.state.action?{action:request.state.action,visualEvidence:request.state.visualEvidence}:{})};
  log('model_request',metadata);
  const response=await executeDecision({tenantId:'spot-authorized-gate-qa',...request},{abortSignal:signal,fetch:async(url,init)=>{const r=await fetch(url,init);log('provider_http',{status:r.status});return r;}});
  log('model_response',{questionIds:metadata.questionIds,model:response.model,answers:response.answers});return response;
 };
 const deadline=Date.now()+5*60_000;
 const harness=createSkillHarness({goal,browser,capabilities:new Set(['browser','jev','jev_box']),decide,signal:controller.signal,remainingMs:()=>Math.max(0,deadline-Date.now()),recordAction:a=>log('skill_action',a),recordSkill:r=>log('skill_record',r)});
 log('run',{candidate:'a19f6facba5867b875a1dda79214896ca78dfc33',browser:version.Browser,node:process.version,goal,scope:'one actual skill invocation with only host captchaClick replaced by diagnostic-stop spy'});
 const outcome=await harness.invoke(solveCaptcha,{});log('skill_outcome',{outcome,spyCalls});
 const resultImage=Buffer.from(await runtime.screenshot(),'base64');writeFileSync(root+'result.png',resultImage,{mode:0o600});
 const result={candidate:'a19f6facba5867b875a1dda79214896ca78dfc33',spyCalls,outcome,inputCommands:events.filter(e=>e.kind==='cdp'&&e.method.startsWith('Input.')).length};
 writeFileSync(root+'result.json',JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify(result));
}finally{clearTimeout(budget);controller.abort();cdp?.close();chrome.kill('SIGTERM');}
