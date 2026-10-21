import {readFileSync,writeFileSync,statSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';

const candidate='af229cc363c6a602f2964bfda2c4961dd0cf6e5f';
const checkout=resolve(process.env.QA_ROUTER_CHECKOUT),root=resolve(process.env.QA_PRIVATE_OUTPUT),prior=resolve(process.env.QA_PRIOR_ARTIFACTS),priorPrivate=resolve(process.env.QA_PRIOR_PRIVATE);
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:checkout,encoding:'utf8'}).trim(),candidate);
assert.equal(statSync(root).mode&0o777,0o700);
assert.notEqual(root,priorPrivate);assert.notEqual(root,prior);
assert(existsSync(join(root,'declaration.json')),'Resume requires the original immutable declaration');
const hash=value=>createHash('sha256').update(value).digest('hex');
const save=(name,value)=>writeFileSync(join(root,name),typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value,null,2),{mode:0o600});
const moduleUrl=path=>pathToFileURL(join(checkout,path)).href;
const {PNG}=await import(moduleUrl('node_modules/pngjs/lib/png.js'));
const {default:ts}=await import(moduleUrl('node_modules/typescript/lib/typescript.js'));
const plan=JSON.parse(readFileSync(new URL('./corpus-plan.json',import.meta.url)));
const fixture=readFileSync(new URL('./fixture.html',import.meta.url));
const source=readFileSync(join(checkout,'packages/server/src/browse/primitives.ts'),'utf8');
const closure=source.slice(source.indexOf('  const cosmeticHover = async ('),source.indexOf('\n  // Sandbox clicks',source.indexOf('  const cosmeticHover = async (')));
const ast=ts.createSourceFile('primitives.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let canvas;
const visit=node=>{if(ts.isFunctionDeclaration(node)&&node.name?.text==='grayCanvas')canvas=node.getText(ast);ts.forEachChild(node,visit);};visit(ast);assert(canvas);
const constants=['CAPTCHA_HOVER_MIN','HOVER_MARGIN','MAX_HOVER_SCALE'].map(name=>source.match(new RegExp(`const ${name} = [0-9.]+;`))[0]).join('\n');
const sourceBinding={candidate,sourceFileSha256:hash(source),closureSha256:hash(closure),grayCanvasSha256:hash(canvas),constants,method:'Verbatim current cosmeticHover closure and grayCanvas helper, exact constants, actual candidate executeDecision; only observation/one-send transport guard wrapped.'};
assert.deepEqual(JSON.parse(readFileSync(join(root,'source-binding.json'))),sourceBinding);
const declaration=JSON.parse(readFileSync(join(root,'declaration.json')));assert.equal(declaration.planSha256,hash(JSON.stringify(plan)));assert.equal(declaration.fixtureSha256,hash(fixture));assert.deepEqual(declaration.plan,plan);
const {bind}=await import(pathToFileURL(join(root,'bound-source.mts')));
const previous=JSON.parse(readFileSync(join(root,'results.json')));assert.equal(previous.results.length,1);assert.equal(previous.results[0].id,'preserved-857');assert.equal(previous.providerRequests,1);const events=JSON.parse(readFileSync(join(root,'trace.json'))),results=previous.results;let seq=events.at(-1).seq,providerRequests=previous.providerRequests;
const log=(kind,data)=>{events.push({seq:++seq,time:dayjs().toISOString(),kind,...data});save('trace.json',events);};
log('corpus_resume_no_preserved_call',{planSha256:hash(JSON.stringify(plan)),fixtureSha256:hash(fixture),sourceBinding});
const decoded=bytes=>PNG.sync.read(bytes);
const crop=(png,rect)=>{const frame=new PNG({width:rect.width,height:rect.height});for(let y=0;y<rect.height;y++)png.data.copy(frame.data,y*rect.width*4,((rect.y+y)*png.width+rect.x)*4,((rect.y+y)*png.width+rect.x+rect.width)*4);return frame;};
const difference=(before,after)=>{let left=before.width,top=before.height,right=-1,bottom=-1,count=0;for(let y=0;y<before.height;y++)for(let x=0;x<before.width;x++){const offset=(y*before.width+x)*4;if(before.data.readUInt32BE(offset)===after.data.readUInt32BE(offset))continue;count++;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}return {changedPixels:count,bounds:count?{left,top,right,bottom}:null};};
const mapping=(visible,located)=>{const region={x:Math.max(0,Math.floor(located.x-visible.x)-4),y:Math.max(0,Math.floor(located.y-visible.y)-4),right:Math.min(visible.width,Math.ceil(located.x+located.width-visible.x)+4),bottom:Math.min(visible.height,Math.ceil(located.y+located.height-visible.y)+4)};return {region,scale:Math.max(1,Math.min(8,Math.floor(Math.min(1024/(region.right-region.x),768/(region.bottom-region.y)))))};};
const checkCanvas=(png,frame,placement,scale,region)=>{
 assert.equal(png.width,1024);assert.equal(png.height,768);
 for(let y=0;y<768;y++)for(let x=0;x<1024;x++){
  const inside=x>=placement.x&&y>=placement.y&&x<placement.x+region.width*scale&&y<placement.y+region.height*scale;
  const expected=inside?frame.data.readUInt32BE(((region.y+Math.floor((y-placement.y)/scale))*frame.width+region.x+Math.floor((x-placement.x)/scale))*4):0x808080ff;
  assert.equal(png.data.readUInt32BE((y*1024+x)*4),expected,'Source image transform mismatch');
 }
};
async function evaluate(pair){
 const {id,before,after,visible,located,expected}=pair;const started=dayjs().valueOf();
 const delta=difference(before,after),{region,scale}=mapping(visible,located);
 const contained=!delta.bounds||(delta.bounds.left>=region.x&&delta.bounds.top>=region.y&&delta.bounds.right<region.right&&delta.bounds.bottom<region.bottom);
 const record={id,expected,source:pair.source,visible,located,delta,region,targetScale:scale,contained,closureInvocations:1,logicalRequests:0,providerRequests:0,beforeRgbaSha256:hash(before.data),afterRgbaSha256:hash(after.data)};
 const caseController=new AbortController();
 const signal=AbortSignal.any([caseController.signal,AbortSignal.timeout(60000)]);
 const observe=async(actual,request,settings)=>{
  record.logicalRequests++;assert.equal(record.logicalRequests,1,'One logical request per pair');
  const raw=JSON.stringify(request);save(id+'-request.json',raw);record.actualRequestSha256=hash(raw);
  log('logical_request',{id,sha256:hash(raw),questions:request.questions,stateFields:Object.keys(request.state)});
  try{
   const refs=Object.keys(request.assets);assert.equal(refs.length,4);assert.equal(new Set(refs).size,4);assert(refs.every(ref=>/^[a-f0-9-]{36}$/.test(ref)));
   assert(refs.every(ref=>!JSON.stringify(request.state).includes(ref)),'No images in shared state');
   const expectedIds=['same_instruction','same_images','same_selection','same_control','no_new_mark','style_only'];assert.deepEqual(Object.keys(request.questions),expectedIds);
   const pairs=expectedIds.map((key,index)=>{
    const instructions=request.questions[key].instructions,wanted=index<3?refs.slice(0,2):refs.slice(2,4);
    assert.equal(instructions.before,wanted[0]);assert.equal(instructions.after,wanted[1]);
    const found=refs.filter(ref=>JSON.stringify(instructions).includes(ref));assert.deepEqual(found,wanted);return {questionId:key,imageIndexes:index<3?[0,1]:[2,3]};
   });
   const assets=Object.values(request.assets),images=[];
   for(let i=0;i<4;i++){
    const bytes=Buffer.from(assets[i].dataBase64,'base64'),png=decoded(bytes),frame=i%2===0?before:after;
    checkCanvas(png,frame,i<2?visible:{x:0,y:0},i<2?1:scale,i<2?{x:0,y:0,width:visible.width,height:visible.height}:{x:region.x,y:region.y,width:region.right-region.x,height:region.bottom-region.y});
    const file=id+'-transport-'+i+'.png';save(file,bytes);images.push({file,sha256:hash(bytes),bytes:bytes.length});
    if(pair.preservedFiles)assert(bytes.equals(readFileSync(join(prior,pair.preservedFiles[i]))),'Preserved 3965f4ec canvas byte mismatch');
   }
   record.images=images;record.questionImagePairs=pairs;record.transformsVerified=true;record.sharedStateHasNoImages=true;record.preservedByteIdentity=!!pair.preservedFiles;
  }catch(error){record.validationFailure='Input/transform/reference validation stopped case before inference';throw error;}
  try{
   const response=await actual(request,{...settings,fetch:async(endpoint,init)=>{
    if(record.providerRequests>=1||providerRequests>=10){record.retryPrevented=true;caseController.abort();throw Error('Bounded evaluation forbids another provider request');}
    const wire=JSON.parse(init.body);save(id+'-wire.json',init.body);assert.deepEqual(wire.state,request.state);assert.deepEqual(wire.questions,request.questions);for(const ref of Object.keys(request.assets))assert.equal(wire.assets[ref].data_base64,request.assets[ref].dataBase64);
    record.wireStateQuestionsAssetsEqual=true;record.providerRequests++;providerRequests++;
    const response=await fetch(endpoint,init);record.httpStatus=response.status;log('provider_http',{id,status:response.status,providerRequests});return response;
   }});
   save(id+'-response.json',response);record.model=response.model;record.answers=response.answers;
   log('model_response',{id,model:response.model,answers:response.answers});return response;
  }catch(error){record.providerOrCodeFailure={errorClass:error.name,code:error.code};throw error;}
 };
 try{record.approved=await bind({tenantId:'spot-authorized-comparison-qa',environment:process.env},signal,observe)({visible,pixels:before.data},{visible,pixels:after.data},pair.target,located);}
 catch(error){record.closureError={errorClass:error.name,code:error.code};}
 record.elapsedMs=dayjs().valueOf()-started;
 record.path=record.validationFailure?'pre_inference_validation_failure':record.providerOrCodeFailure||record.closureError?'provider_or_code_failure':!delta.changedPixels?'unchanged_fast_path':!contained?'deterministic_containment_refusal':'real_provider_comparison';
 record.classification=record.path==='real_provider_comparison'?(expected?(record.approved?'semantic_true_positive':'semantic_false_negative'):(record.approved?'semantic_false_positive':'semantic_true_negative')):record.path==='unchanged_fast_path'||record.path==='deterministic_containment_refusal'?(record.approved===expected?'expected_code_path':'unexpected_code_result'):record.path;
 results.push(record);save('results.json',{candidate,providerRequests,results});log('case_result',record);return record;
}

// Independent corpus: all ground truth is captured and frozen before corpus inference.
const server=createServer((request,response)=>{if(request.url!=='/fixture'){response.writeHead(404);return response.end();}response.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});response.end(fixture);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const fixtureUrl='http://127.0.0.1:'+server.address().port+'/fixture';
const chrome=spawn('google-chrome',['--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=9222','--remote-debugging-address=127.0.0.1','--user-data-dir='+join(root,'corpus-chrome-profile'),'--window-size=1024,856','about:blank'],{env:{...process.env,DISPLAY:':99'},stdio:'ignore'});
let cdp;
try{
 const {CdpConnection}=await import(moduleUrl('packages/server/src/browse/cdp.ts'));
 let version;for(let i=0;i<100;i++){try{version=await fetch('http://127.0.0.1:9222/json/version').then(r=>r.json());break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}
 assert(version);cdp=await CdpConnection.connect(version.webSocketDebuggerUrl,AbortSignal.timeout(10*60*1000));
 const {targetInfos}=await cdp.send('Target.getTargets');const target=targetInfos.find(item=>item.type==='page');assert(target);
 const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
 await cdp.send('Page.enable',{},sessionId);await cdp.send('Runtime.enable',{},sessionId);await cdp.send('Emulation.setDeviceMetricsOverride',{width:1024,height:768,deviceScaleFactor:1,mobile:false},sessionId);
 const send=cdp.send.bind(cdp);let inputCommands=0;cdp.send=async(method,params={},session)=>{if(method.startsWith('Input.'))inputCommands++;return send(method,params,session);};
 const evaluateTop=async expression=>{const result=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);assert(!result.exceptionDetails,'Controlled fixture evaluation failed');return result.result.value;};
 await cdp.send('Page.navigate',{url:fixtureUrl},sessionId);
 let ready=false;for(let i=0;i<100;i++){try{ready=await evaluateTop('typeof window.fixtureObservation === "function"');if(ready)break;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}assert(ready);
 log('browser_ready',{browser:version.Browser,node:process.version,viewport:await evaluateTop('({width:innerWidth,height:innerHeight})')});
 const capture=async(id,phase,state)=>{
  await evaluateTop(`window.applyFixture(${JSON.stringify(state)}); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  const observation=await evaluateTop('window.fixtureObservation()');
  const result=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);
  const bytes=Buffer.from(result.data,'base64'),png=decoded(bytes);assert.equal(png.width,1024);assert.equal(png.height,768);
  save(id+'-'+phase+'-viewport.png',bytes);const frame=crop(png,observation.frame);save(id+'-'+phase+'-frame.png',PNG.sync.write(frame));
  log('fixture_capture',{id,phase,observation,viewportSha256:hash(bytes),frameRgbaSha256:hash(frame.data)});return {observation,frame};
 };
 const captured=[],groundTruth=[];
 for(const item of plan.cases){
  const before=await capture(item.id,'before',item.before),after=await capture(item.id,'after',item.after);
  const b=before.observation,a=after.observation;assert.equal(b.state,item.before);assert.equal(a.state,item.after);assert.deepEqual(b.frame,a.frame);
  const delta=difference(before.frame,after.frame);
  if(item.id==='unchanged')assert.deepEqual(before.frame.data,after.frame.data);else assert(delta.changedPixels>0);
  if(item.id==='border-hover'){assert.deepEqual(b.control,a.control);assert.equal(b.mark,a.mark);assert.equal(b.picture,a.picture);assert.equal(b.checked,a.checked);assert.notEqual(b.borderColor,a.borderColor);}
  if(item.id==='added-tick'){assert.equal(b.mark,null);assert.equal(a.mark,'tick');assert.equal(a.checked,'true');}
  if(item.id==='removed-mark'){assert.equal(b.mark,'tick');assert.equal(a.mark,null);}
  if(item.id==='new-spinner')assert.equal(a.mark,'static spinner');
  if(item.id==='replaced-picture'){assert.equal(b.picture,'mountain landscape');assert.equal(a.picture,'boat on water');}
  if(item.id==='changed-instruction')assert.notEqual(b.instruction,a.instruction);
  if(item.id==='moved-resized'){assert.equal(a.control.x-b.control.x,1);assert.equal(a.control.y-b.control.y,1);assert.equal(a.control.width-b.control.width,2);assert.equal(a.control.height-b.control.height,2);}
  if(item.id==='selected-state'){assert.equal(b.picture,a.picture);assert.equal(b.selected,'false');assert.equal(a.selected,'true');assert.equal(a.badge,'✓');}
  const truth={...item,beforeObservation:b,afterObservation:a,delta,expectedFrozenBeforeInference:true};groundTruth.push(truth);
  captured.push({id:item.id,before:before.frame,after:after.frame,visible:b.frame,located:b.control,expected:item.expected,source:'Controlled browser-rendered fixture; supplied before-DOM geometry',target:plan.target});
 }
 save('corpus-ground-truth.json',groundTruth);log('all_corpus_truth_frozen',{sha256:hash(JSON.stringify(groundTruth)),cases:groundTruth.length});
 for(const pair of captured)await evaluate(pair);
 assert.equal(inputCommands,0);save('browser-summary.json',{browser:version.Browser,controlledDomFixtureSetup:true,nativeInputCommands:inputCommands,corpusCases:captured.length});
}finally{cdp?.close();chrome.kill('SIGTERM');await new Promise(resolve=>server.close(resolve));save('cleanup-requested.json',{browserTerminationRequested:true,fixtureServerStopped:!server.listening});}
console.log(JSON.stringify({candidate,providerRequests,results:results.map(({id,approved,path,classification})=>({id,approved,path,classification}))}));
