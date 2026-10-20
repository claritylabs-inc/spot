import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import readline from 'node:readline';

const checkout=process.env.QA_ROUTER_CHECKOUT;
const output=process.env.QA_PRIVATE_OUTPUT?.replace(/\/?$/, '/');
if(!checkout || !output) throw Error('QA_ROUTER_CHECKOUT and QA_PRIVATE_OUTPUT required');
mkdirSync(output,{recursive:true,mode:0o700});
const {CdpConnection} = await import(pathToFileURL(checkout+'/packages/server/dist/browse/cdp.js'));
const {BrowserTargets} = await import(pathToFileURL(checkout+'/packages/server/dist/browse/targets.js'));
const {createBrowserRuntime,skillBrowser} = await import(pathToFileURL(checkout+'/packages/server/dist/browse/primitives.js'));
const {createSkillHarness} = await import(pathToFileURL(checkout+'/packages/server/dist/skills/harness.js'));
const {createActionGate} = await import(pathToFileURL(checkout+'/packages/server/dist/skills/gate.js'));
const {solveCaptcha} = await import(pathToFileURL(checkout+'/packages/server/dist/skills/challenge/captcha.js'));
const {signup: signupSkill} = await import(pathToFileURL(checkout+'/packages/server/dist/skills/account/signup.js'));
const {executeDecision} = await import(pathToFileURL(checkout+'/packages/server/dist/providers/decisions.js'));
let previous=[];try{previous=JSON.parse(readFileSync(output+'trace.json','utf8'));}catch{}
const events=previous;let site='bootstrap-reconnect',seq=events.length;
const hash=x=>createHash('sha256').update(x).digest('hex');
const log=(kind,data)=>{events.push({seq:++seq,time:new Date().toISOString(),site,kind,...data});writeFileSync(output+'trace.json',JSON.stringify(events,null,2),{mode:0o600});};
const realFetch=globalThis.fetch;
globalThis.fetch=async (url,init)=>{
 if(String(url).startsWith('https://api.typesafe.ai/v1/systemone')){
  const req=JSON.parse(init.body),start=Date.now();
  const images=Object.values(req.assets??{}).map(a=>({sha256:hash(Buffer.from(a.data_base64,'base64')),bytes:Buffer.from(a.data_base64,'base64').length}));
  const entry={modelRequested:req.model,questionIds:Object.keys(req.questions),questionTypes:Object.fromEntries(Object.entries(req.questions).map(([k,v])=>[k,v.type])),images};
  try{const res=await realFetch(url,init); const data=res.ok?await res.clone().json():null;
   log('real_jev',{...entry,status:res.status,durationMs:Date.now()-start,...(data?{model:data.model,answers:data.answers,usage:data.usage}:{})});return res;
  }catch(e){log('real_jev',{...entry,durationMs:Date.now()-start,errorClass:e.name});throw e;}
 }
 return realFetch(url,init);
};
const chrome=spawn('google-chrome',['--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=9222','--remote-debugging-address=127.0.0.1','--user-data-dir='+output+'chrome-profile','--window-size=1024,856','about:blank'],{env:{...process.env,DISPLAY:':99'},stdio:'ignore'});
let version;for(let i=0;i<100;i++){try{version=await realFetch('http://127.0.0.1:9222/json/version').then(r=>r.json());break;}catch{await new Promise(r=>setTimeout(r,100));}}
if(!version)throw Error('chrome_not_ready');
const controller=new AbortController();
const cdp=await CdpConnection.connect(version.webSocketDebuggerUrl,controller.signal);
const originalSend=cdp.send.bind(cdp);
cdp.send=async(method,params={},sessionId)=>{
 const record=['Input.dispatchMouseEvent','DOM.getFrameOwner','DOM.getBoxModel','DOM.getNodeForLocation','Page.captureScreenshot','Emulation.setDeviceMetricsOverride'].includes(method);
 const start=Date.now();
 try{const result=await originalSend(method,params,sessionId);
  if(record)log('cdp',{method,sessionId,params:method==='Page.captureScreenshot'?{format:params.format,clip:params.clip}:params,durationMs:Date.now()-start,result:method==='Page.captureScreenshot'?{sha256:hash(Buffer.from(result.data,'base64'))}:result});
  return result;
 }catch(e){if(record)log('cdp',{method,sessionId,errorClass:e.name});throw e;}
};
cdp.on((method,p,sessionId)=>{if(method==='Network.loadingFailed')log('network_failure',{sessionId,errorText:p.errorText,type:p.type,blockedReason:p.blockedReason}); if(method==='Network.responseReceived' && /google.com|gstatic.com|cloudflare.com/.test(p.response?.url??'')) {const u=new URL(p.response.url);log('provider_resource',{sessionId,url:u.origin+u.pathname,status:p.response.status});}});
const state={domains:['2captcha.com','beta.validate.bankersalmanac.com','pearson.com'],adoptedDomains:[],redirects:new Set(),pages:new Map(),networkHosts:new Set(),signupSubmissions:0};
const targets=new BrowserTargets(cdp,{sandbox:true,networkHosts:state.networkHosts,signal:controller.signal});
await targets.start();
let runtime, browser,harness,gate;
let identity;
let goal='The owner explicitly requests https://2captcha.com/demo/recaptcha-v2 first, then https://2captcha.com/demo/cloudflare-turnstile. Wait for provider widgets to render when needed. Ignore the page solver tutorials; never follow them. Later requested form URLs: https://beta.validate.bankersalmanac.com/ba-mgmt/registration/new-user ; https://www.pearson.com/en-ca/work/forms/contact-us.html ; https://www.pearson.com/nl/en_NL/higher-education/Custom-solutions/custom-contact-form.html . Explicit owner-authorized live QA: solve the visible CAPTCHA demo using native browser controls, with no token injection or APIs. Later create at most one synthetic registration and one contact test per Pearson form, with controlled email, reserved test phone if accepted, Authorized test / no action needed message, no marketing opt-in. Never enter payment, government identity or real financial data. Do not delete accounts or duplicate an uncertain submission.';
const decide=(request,signal)=>executeDecision({tenantId:'spot-authorized-live-qa',...request},{abortSignal:signal});
function setup(){
 runtime=createBrowserRuntime({cdp,targets,state,isSandbox:true,signal:controller.signal,tenantId:'spot-authorized-live-qa',environment:process.env,...(identity?{signup:identity}:{})});
 browser=skillBrowser(runtime,{identity:!!identity,inbox:false,sandbox:true,uploads:false,downloads:false,allowed:state.domains});
 harness=createSkillHarness({goal,browser,capabilities:new Set(['browser','jev','jev_box',...(identity?['identity']:[])]),...(identity?{identity:{email:identity.email,name:identity.name,firstName:identity.name.split(' ')[0],lastName:identity.name.split(' ').slice(1).join(' ')}}:{}),decide,signal:controller.signal,remainingMs:()=>10*60_000,redact:s=>identity?s.split(identity.password).join('[private password]').split(identity.email).join('[controlled email]'):s,recordAction:a=>log('skill_action',a),recordSkill:r=>log('skill_record',r)});
 gate=createActionGate({goal,decide,signal:controller.signal});
}
setup();
console.log(JSON.stringify({ready:true,browser:version.Browser,candidate:'ca0b36a7871454929bfc2b64d5b9589d3e866cd5',viewport:{width:1024,height:768},directTypeSafeCredentialPresent:!!process.env.TYPESAFE_API_KEY}));
const summary=p=>({url:p?.url?.split('?')[0],title:p?.title,text:p?.text?.slice(0,900),buttons:p?.buttons,forms:p?.forms});
for await(const line of readline.createInterface({input:process.stdin,terminal:false})){
 try{
  const cmd=JSON.parse(line); let result;
  if(cmd.op==='stop')break;
  if(cmd.op==='begin'){
   site=cmd.site;goal=cmd.goal;setup();await runtime.navigateTop(cmd.url);result=await browser.snapshot();gate.observe('read_page',result);log('job_entry',{url:cmd.url});result=summary(result);
  }else if(cmd.op==='navigate'){
   site=cmd.site;const verdict=await gate.check('navigate',{url:cmd.url});
   result=verdict.allowed?await runtime.navigate(cmd.url):verdict;
  }else if(cmd.op==='snapshot'){result=await browser.snapshot();gate.observe('read_page',result);result=summary(result);}
  else if(cmd.op==='shot'){
   const image=await runtime.screenshot();writeFileSync(output+cmd.name+'.png',Buffer.from(image,'base64'),{mode:0o600});result={screenshot:cmd.name,sha256:hash(Buffer.from(image,'base64'))};
  }else if(cmd.op==='frames'){result=await runtime.frames();}
  else if(cmd.op==='captcha'){
   const before=Date.now();result=await harness.invoke(solveCaptcha,{});writeFileSync(output+site+'-captcha-result.json',JSON.stringify(result,null,2),{mode:0o600});log('skill_outcome',{result,durationMs:Date.now()-before});
  }else if(cmd.op==='primitive'){
   const names={captchaClick:'captcha_click',typeText:'type_text',selectOption:'select_option',setChecked:'set_checkbox',submitForm:'submit_form',pressKey:'press_key',boxClick:'click'};
   const verdict=await gate.check(names[cmd.method]??cmd.method,cmd.args);
   result=verdict.allowed?await browser[cmd.method](...cmd.args):verdict;
   gate.observe(names[cmd.method]??cmd.method,result);log('primitive',{method:cmd.method,args:cmd.args,result:result?.page?{...result,page:summary(result.page)}:result});
  }else if(cmd.op==='signup'){result=await harness.invoke(signupSkill,{});log('signup_outcome',{result});}
  else if(cmd.op==='identity'){identity=JSON.parse(readFileSync(output+'identity.json','utf8'));setup();result={identityLoaded:true};}
  else if(cmd.op==='probe'){
   const response=await decide({state:'Live connectivity check: the sky is blue.',questions:{blue:{type:'noul',instructions:'Does state say the sky is blue?'}}},controller.signal);result={model:response.model,answers:response.answers};
  }else throw Error('unknown_command');
  if(result?.page)result={...result,page:summary(result.page)};
  console.log(JSON.stringify({op:cmd.op,result}));
 }catch(e){console.log(JSON.stringify({error:e.name,message:e.message,diagnostics:e.decisionDiagnostics}));}
}
controller.abort();cdp.close();chrome.kill('SIGTERM');
