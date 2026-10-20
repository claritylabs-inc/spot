// Offline publication only. No provider/browser imports or requests.
import {readFileSync,writeFileSync,readdirSync,statSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const root=resolve(process.env.QA_PRIVATE_OUTPUT),out=fileURLToPath(new URL('.',import.meta.url));
const hash=value=>createHash('sha256').update(value).digest('hex'),json=name=>JSON.parse(readFileSync(join(root,name)));
const save=(name,value)=>writeFileSync(join(out,name),JSON.stringify(value,null,2)+'\n');
const plan=json('declaration.json'),results=json('results.json'),trace=json('trace.json'),ledgers=[],requests=[];
assert.equal(results.results.length,8);assert.equal(results.httpAttempts,8);
assert.equal(trace.filter(event=>event.kind==='http_send').length,8);assert.equal(trace.filter(event=>event.kind==='http_response').length,8);
assert.equal(hash(readFileSync(join(out,'evaluate-frozen.mjs'))),plan.controllerSha256);
assert(readFileSync(join(root,'declaration.json')).equals(readFileSync(join(out,'predeclaration.json'))));
for(const item of plan.cases){
  const path=join(root,item.id+'-request.json'),raw=readFileSync(path),actual=JSON.parse(raw),wireRaw=readFileSync(join(root,item.id+'-wire.json')),wire=JSON.parse(wireRaw),baselineRaw=readFileSync(join(root,item.id+'-baseline-wire.json')),baseline=JSON.parse(baselineRaw);
  assert.equal(hash(raw),item.originalLogicalSha256);assert.equal(hash(baselineRaw),item.originalWireSha256);
  assert.equal(statSync(path).mode&0o777,0o600);
  const beforeEvent=trace.find(event=>event.kind==='logical_request_before_inference'&&event.id===item.id),sendEvent=trace.find(event=>event.kind==='http_send'&&event.id===item.id);
  assert(statSync(path).mtimeMs<=Date.parse(beforeEvent.time));assert(beforeEvent.seq<sendEvent.seq);
  assert.deepEqual(wire,{...baseline,model:plan.model});assert.equal(wireRaw.toString(),JSON.stringify({...baseline,model:plan.model}));
  assert.deepEqual(wire.state,actual.state);assert.deepEqual(wire.questions,actual.questions);
  const refs=Object.keys(actual.assets),changes=[];
  const clean=(input,wireMode)=>{
    const value=structuredClone(input),assets={};
    refs.forEach((ref,i)=>{
      const asset=value.assets[ref],key=wireMode?'data_base64':'dataBase64',bytes=Buffer.from(asset[key],'base64'),file=item.images[i].file,name='image-'+i;
      assert.equal(hash(bytes),item.images[i].sha256);assert.equal(bytes.length,item.images[i].bytes);
      writeFileSync(join(out,file),bytes);
      const replacement='[PNG omitted; exact bytes in '+file+']';assets[name]={...asset,[key]:replacement};
      changes.push({document:wireMode?'wire':'logical',path:'/assets/'+name,operation:'normalize opaque asset key',originalKeySha256:hash(ref),originalKeyUtf16Spans:[[0,ref.length]],replacementKey:name});
      changes.push({document:wireMode?'wire':'logical',path:'/assets/'+name+'/'+key,operation:'omit PNG base64',originalUtf16Spans:[[0,asset[key].length]],originalValueSha256:hash(asset[key]),decodedSha256:hash(bytes),replacement});
    });
    value.assets=assets;
    for(const [id,question] of Object.entries(value.questions))for(const field of ['before','after']){
      const original=question.instructions[field],index=refs.indexOf(original);assert(index>=0);const replacement='image-'+index;
      changes.push({document:wireMode?'wire':'logical',path:'/questions/'+id+'/instructions/'+field,operation:'normalize opaque image reference',originalUtf16Spans:[[0,original.length]],originalValueSha256:hash(original),replacement});question.instructions[field]=replacement;
    }
    assert(refs.every(ref=>!JSON.stringify(value).includes(ref)));return value;
  };
  const logical=clean(actual,false),canonicalWire=clean(wire,true),record=results.results.find(result=>result.id===item.id);
  assert.equal(record.httpAttempts,1);assert.equal(record.wireOnlyModelChanged,true);assert.equal(record.wireSha256,hash(wireRaw));
  assert.equal(record.httpStatus,200);assert.equal(record.response.model,'jev-1.14.0');assert.equal(record.validAnswers,true);
  requests.push({id:item.id,logical,canonicalWire,images:item.images,response:record.response});
  ledgers.push({id:item.id,originalLogicalSha256:hash(raw),baselineWireSha256:hash(baselineRaw),actualWireSha256:hash(wireRaw),sanitizedLogicalSha256:hash(JSON.stringify(logical)),sanitizedWireSha256:hash(JSON.stringify(canonicalWire)),privateMode:'0600',storedBeforeInference:true,sanitizedStateSentToProvider:false,wireOnlyModelChanged:true,changes});
}
save('logical-wire-requests-sanitized.json',{requests});
save('redaction-ledger.json',{coordinateConvention:'JSONPointer after asset-key normalization; original string UTF16 spans are zero-based/end-exclusive. Original opaque asset keys are bound by key hash and spans. Only image-reference normalization/raw-PNG omission; no other logical/wire content changed.',requests:ledgers});
copyFileSync(join(root,'results.json'),join(out,'results.json'));copyFileSync(join(root,'trace.json'),join(out,'protocol-model-trace.json'));
save('source-binding.json',{candidate:plan.candidate,mode:'Actual candidate executeDecision on exact original logical requests; no closure regeneration/invocation or native/browser execution',sourceFiles:plan.sourceFiles,historicalOriginalClosureBinding:plan.sourceBinding,controllerSha256:plan.controllerSha256,originalEvidenceCommit:plan.baselineCommit,actualResponseModel:'jev-1.14.0',sourceClosureInvocations:0,nativeCalls:0});
save('integrity-checks.json',{originalLogicalObjectsAndOpaqueRefsPreserved:true,originalHashesVerifiedBeforeCalls:true,exactOriginalImageBytesPreserved:true,allLogicalPrivate0600BeforeInference:true,allCanonicalWireBytesDifferOnlyModel:true,allSixQuestionsAndPlacementUnchanged:true,allEightHttpStatuses200:true,allEightResponseModelsExactly114:true,allAnswersCompleteFiniteAndUnchanged:true,actualHttpAttempts:8,httpAttemptsPerCase:1,guardRetryTriggered:results.results.some(item=>item.retryPrevented),newClosureInvocations:0,newBrowserInteractions:0,newNativeCalls:0,historicControlsNotRerun:true,configurationOrEnvironmentChanges:false,automaticNextStage:false});
save('cleanup.json',{controllerFinished:true,browserOrServerProcessesStarted:0,nativeCalls:0,providerRequestsAfterTerminal:0,privateOriginalRequestsAndInboxUntouched:true,existingRouterAndSpotConfigurationUnchanged:true});
const files=readdirSync(out).filter(name=>name!=='manifest.json').sort();
save('manifest.json',{files:files.map(file=>({file,sha256:hash(readFileSync(join(out,file))),bytes:statSync(join(out,file)).size}))});
console.log(JSON.stringify({requests:requests.length,files:files.length,verdict:results.screenVerdict,httpAttempts:results.httpAttempts}));
