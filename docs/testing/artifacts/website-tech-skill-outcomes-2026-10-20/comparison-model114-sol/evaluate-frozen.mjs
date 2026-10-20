import {readFileSync,writeFileSync,existsSync,mkdirSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';

const candidate='af229cc363c6a602f2964bfda2c4961dd0cf6e5f',baselineCommit='f299f7074ae13b1b9905ef37f6723810a453d936',model='jev-1.14.0';
const checkout=resolve(process.env.QA_ROUTER_CHECKOUT),original=resolve(process.env.QA_ORIGINAL_PRIVATE),privateRoot=resolve(process.env.QA_PRIVATE_OUTPUT),out=fileURLToPath(new URL('.',import.meta.url));
assert.notEqual(original,privateRoot);
const hash=value=>createHash('sha256').update(value).digest('hex');
const json=(root,name)=>JSON.parse(readFileSync(join(root,name)));
const save=(root,name,value)=>writeFileSync(join(root,name),typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value,null,2)+'\n',{mode:root===privateRoot?0o600:0o644});
const baseline='docs/testing/artifacts/website-tech-skill-outcomes-2026-10-20/comparison-af229cc-sol/';
const committed=name=>execFileSync('git',['show',baselineCommit+':'+baseline+name]);
const priorResults=JSON.parse(committed('results.json')),priorLedger=JSON.parse(committed('redaction-ledger.json'));
const ids=['preserved-857','border-hover','added-tick','removed-mark','new-spinner','replaced-picture','moved-resized','selected-state'];
const questionIds=['same_instruction','same_images','same_selection','same_control','no_new_mark','style_only'];
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:checkout,encoding:'utf8'}).trim(),candidate);
execFileSync('git',['diff','--exit-code','HEAD','--'],{cwd:checkout,stdio:'pipe'});
const files=['packages/server/src/browse/primitives.ts','packages/server/src/providers/decisions.ts','packages/policy/src/decisions.ts'];
const sourceFiles=Object.fromEntries(files.map(file=>{
  const bytes=readFileSync(join(checkout,file));assert(bytes.equals(execFileSync('git',['show',candidate+':'+file],{cwd:checkout})));
  return [file,hash(bytes)];
}));
const source=readFileSync(join(checkout,files[0]),'utf8'),start=source.indexOf('  const cosmeticHover = async ('),closure=source.slice(start,source.indexOf('\n  // Sandbox clicks',start));
const binding=JSON.parse(committed('source-binding.json'));
assert.equal(sourceFiles[files[0]],binding.sourceFileSha256);assert.equal(hash(closure),binding.closureSha256);
assert(closure.includes('answer.noul >= CAPTCHA_HOVER_MIN'));assert(source.includes('const CAPTCHA_HOVER_MIN = 0.9;'));
const frozen=ids.map((id,index)=>{
  const record=priorResults.results.find(item=>item.id===id),ledger=priorLedger.requests.find(item=>item.id===id);
  const raw=readFileSync(join(original,id+'-request.json')),wireRaw=readFileSync(join(original,id+'-wire.json')),request=JSON.parse(raw),wire=JSON.parse(wireRaw);
  assert.equal(statSync(join(original,id+'-request.json')).mode&0o777,0o600);
  assert.equal(hash(raw),record.actualRequestSha256);assert.equal(hash(raw),ledger.originalLogicalSha256);assert.equal(hash(wireRaw),ledger.originalWireSha256);
  assert.equal(wire.model,'jev-latest');assert.deepEqual(wire.state,request.state);assert.deepEqual(wire.questions,request.questions);
  assert.deepEqual(Object.keys(request.questions),questionIds);
  const refs=Object.keys(request.assets);assert.equal(refs.length,4);assert.equal(new Set(refs).size,4);assert(refs.every(ref=>!JSON.stringify(request.state).includes(ref)));
  const images=refs.map((ref,imageIndex)=>{
    const bytes=Buffer.from(request.assets[ref].dataBase64,'base64'),file=id+'-transport-'+imageIndex+'.png';
    assert.equal(hash(bytes),record.images[imageIndex].sha256);assert(bytes.equals(committed(file)));
    assert.equal(wire.assets[ref].data_base64,request.assets[ref].dataBase64);
    assert.equal(bytes.readUInt32BE(16),1024);assert.equal(bytes.readUInt32BE(20),768);
    return {file,sha256:hash(bytes),bytes:bytes.length};
  });
  questionIds.forEach((key,i)=>{assert.equal(request.questions[key].instructions.before,refs[i<3?0:2]);assert.equal(request.questions[key].instructions.after,refs[i<3?1:3]);});
  assert.equal(record.expected,index<2);
  return {id,raw,wireRaw,request,wire,metadata:{id,expectedApproval:index<2,originalLogicalSha256:hash(raw),originalWireSha256:hash(wireRaw),stateSha256:hash(JSON.stringify(request.state)),questionsSha256:hash(JSON.stringify(request.questions)),images,originalVisible:record.visible,originalLocated:record.located,originalRegion:record.region,originalTargetScale:record.targetScale}};
});
const declaration={candidate,baselineCommit,model,controllerSha256:hash(readFileSync(fileURLToPath(import.meta.url))),sourceBinding:binding,sourceFiles,caseOrder:ids,cases:frozen.map(item=>item.metadata),threshold:.9,questionIds,singleIntendedVariable:"executeDecision options.model='jev-1.14.0'; wire model only",maximumHttpAttempts:8,httpAttemptsPerCase:1,timeoutMsPerCase:60000,retriesOrVariants:false,sourceClosureInvocations:0,nativeCalls:0,criteria:{positive:'Both positives require all six finite Noul answers >= .9',negative:'All six negatives require at least one Noul below .9',model:'Every response must report jev-1.14.0',incomplete:'Missing/invalid answers, model identity mismatch, transport or contract failure cannot pass',aggregate:'PASS frozen regression diagnostic only if every case passes; otherwise reject this screen. No automatic adoption or next stage.'},historicControlsOnly:['unchanged_fast_path','deterministic_containment_refusal']};
if(process.argv[2]==='--prepare'){
  assert(!existsSync(join(privateRoot,'declaration.json')),'Refusing to overwrite frozen predeclaration');
  assert(!existsSync(join(out,'predeclaration.json')),'Refusing to overwrite public predeclaration');
  mkdirSync(privateRoot,{recursive:true,mode:0o700});assert.equal(statSync(privateRoot).mode&0o777,0o700);
  for(const item of frozen){save(privateRoot,item.id+'-request.json',item.raw);save(privateRoot,item.id+'-baseline-wire.json',item.wireRaw);}
  const record={recordedAt:dayjs().toISOString(),...declaration};save(privateRoot,'declaration.json',record);save(out,'predeclaration.json',record);
  console.log(JSON.stringify({prepared:true,cases:frozen.length,model,sourceAndOriginalHashesVerified:true,providerCalls:0}));
  process.exit(0);
}
assert.equal(process.argv[2],'--run');assert.equal(statSync(privateRoot).mode&0o777,0o700);
const prepared=json(privateRoot,'declaration.json'),{recordedAt,...preparedBody}=prepared;assert.deepEqual(preparedBody,declaration);
assert(readFileSync(join(privateRoot,'declaration.json')).equals(readFileSync(join(out,'predeclaration.json'))));
assert(!existsSync(join(privateRoot,'run-started.json')),'Refusing repeat evaluation');
for(const item of frozen){assert(readFileSync(join(privateRoot,item.id+'-request.json')).equals(item.raw));assert.equal(statSync(join(privateRoot,item.id+'-request.json')).mode&0o777,0o600);}
assert(process.env.TYPESAFE_API_KEY?.trim(),'Existing authorized direct provider key is unavailable');
save(privateRoot,'run-started.json',{time:dayjs().toISOString(),declarationSha256:hash(readFileSync(join(privateRoot,'declaration.json')))});
const {executeDecision}=await import(pathToFileURL(join(checkout,'packages/server/src/providers/decisions.ts')));
let httpAttempts=0;const results=[],events=[];
const log=(kind,data)=>{events.push({seq:events.length+1,time:dayjs().toISOString(),kind,...data});save(privateRoot,'trace.json',events);};
log('source_and_frozen_inputs_verified',{candidate,model,predeclarationSha256:hash(readFileSync(join(privateRoot,'declaration.json'))),logicalRequests:frozen.length,sourceFiles});
for(const item of frozen){
  const record={id:item.id,expectedApproval:item.metadata.expectedApproval,logicalRequestSha256:hash(item.raw),httpAttempts:0,wireOnlyModelChanged:false};
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(60000)]),began=performance.now();
  // Private actual logical request is already stored byte-identically and mode0600 before any inference.
  log('logical_request_before_inference',{id:item.id,sha256:hash(item.raw),privateMode:'0600'});
  try{
    const response=await executeDecision(JSON.parse(item.raw),{model,timeoutMs:60000,abortSignal:signal,fetch:async(endpoint,init)=>{
      if(record.httpAttempts>=1||httpAttempts>=8){record.retryPrevented=true;controller.abort();throw Error('One-send guard forbids another provider attempt');}
      const wire=JSON.parse(init.body),expectedWire={...item.wire,model};assert.deepEqual(wire,expectedWire);
      assert.equal(init.body,JSON.stringify(expectedWire),'Canonical wire bytes differ beyond model');
      save(privateRoot,item.id+'-wire.json',init.body);record.wireSha256=hash(init.body);record.wireOnlyModelChanged=true;
      record.httpAttempts++;httpAttempts++;log('http_send',{id:item.id,wireSha256:record.wireSha256,attempt:record.httpAttempts,total:httpAttempts});
      const transportBegan=performance.now(),response=await fetch(endpoint,init);record.httpStatus=response.status;record.httpHeadersLatencyMs=Math.round(performance.now()-transportBegan);
      log('http_response',{id:item.id,status:response.status});return response;
    }});
    save(privateRoot,item.id+'-response.json',response);record.response=response;
    record.modelMatches=response.model===model;
    record.validAnswers=Object.keys(response.answers).length===6&&questionIds.every(id=>response.answers[id]?.type==='noul'&&Number.isFinite(response.answers[id].noul)&&response.answers[id].noul>=0&&response.answers[id].noul<=1);
    record.computedApproval=record.validAnswers?questionIds.every(id=>response.answers[id].noul>=.9):null;
    record.criterionPass=record.modelMatches&&record.validAnswers&&record.computedApproval===record.expectedApproval;
    record.classification=!record.modelMatches?'model_identity_inconclusive':!record.validAnswers?'invalid_answers_inconclusive':record.expectedApproval?(record.computedApproval?'semantic_true_positive':'semantic_false_negative'):(record.computedApproval?'semantic_false_positive':'semantic_true_negative');
  }catch(error){
    record.criterionPass=false;record.classification='transport_contract_or_code_failure';
    record.failure={errorClass:error.name,code:error.code,...(error.decisionDiagnostics?{decisionDiagnostics:error.decisionDiagnostics}:{})};
  }
  record.elapsedMs=Math.round(performance.now()-began);results.push(record);log('case_result',record);
  save(privateRoot,'results.json',{candidate,model,httpAttempts,sourceClosureInvocations:0,nativeCalls:0,results,screenVerdict:results.every(item=>item.criterionPass)?'PASS_so_far':'FAIL'});
}
assert.equal(results.length,8);assert(httpAttempts<=8);
const final={candidate,model,httpAttempts,sourceClosureInvocations:0,nativeCalls:0,results,screenVerdict:results.every(item=>item.criterionPass)?'PASS_FROZEN_REGRESSION_DIAGNOSTIC_ONLY':'FAIL_SCREEN',finishedAt:dayjs().toISOString()};save(privateRoot,'results.json',final);
log('terminal',{screenVerdict:final.screenVerdict,httpAttempts,cases:results.length});
console.log(JSON.stringify({screenVerdict:final.screenVerdict,httpAttempts,cases:results.length,models:[...new Set(results.map(item=>item.response?.model).filter(Boolean))],nativeCalls:0}));
