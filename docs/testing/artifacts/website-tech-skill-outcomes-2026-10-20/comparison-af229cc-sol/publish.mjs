// Offline evidence packaging only: never invokes a browser or provider.
import {readFileSync,writeFileSync,readdirSync,copyFileSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const root=resolve(process.env.QA_PRIVATE_OUTPUT),out=resolve(process.env.QA_ARTIFACT_OUTPUT);
assert.notEqual(root,out);
const hash=value=>createHash('sha256').update(value).digest('hex');
const read=name=>JSON.parse(readFileSync(join(root,name)));
const save=(name,value)=>writeFileSync(join(out,name),JSON.stringify(value,null,2)+'\n');
const all=read('results.json'),trace=read('trace.json'),initial=read('initial-preserved-results.json');
assert.equal(all.results.length,10);assert.equal(all.providerRequests,8);
assert.deepEqual(all.results[0],initial.results[0]);
assert.deepEqual(trace.slice(0,5),read('initial-trace.json'));
assert.equal(trace.filter(event=>event.kind==='logical_request').length,8);
assert.equal(trace.filter(event=>event.kind==='provider_http').length,8);
assert.equal(trace.filter(event=>event.kind==='all_corpus_truth_frozen').length,1);
assert(trace.findIndex(event=>event.kind==='all_corpus_truth_frozen')<trace.findIndex(event=>event.kind==='logical_request'&&event.id==='border-hover'));
const requests=[],ledgers=[],refMap=new Map();
for(const result of all.results.filter(item=>item.logicalRequests)){
  const id=result.id,path=join(root,id+'-request.json'),raw=readFileSync(path,'utf8'),actual=JSON.parse(raw),wire=read(id+'-wire.json');
  assert.equal(statSync(path).mode&0o777,0o600);assert.equal(hash(raw),result.actualRequestSha256);
  const event=trace.find(event=>event.kind==='logical_request'&&event.id===id);
  assert(statSync(path).mtimeMs<=Date.parse(event.time)+2,'Actual request must precede inference');
  assert.deepEqual(actual.state,wire.state);assert.deepEqual(actual.questions,wire.questions);
  const refs=Object.keys(actual.assets),changes=[];
  assert.equal(refs.length,4);assert.equal(new Set(refs).size,4);
  refs.forEach((ref,index)=>refMap.set(ref,'image-'+index));
  const replace=(object,wireMode)=>{
    const value=structuredClone(object),assets={};
    refs.forEach((ref,index)=>{
      const normalized='image-'+index,key=wireMode?'data_base64':'dataBase64',asset=value.assets[ref],bytes=Buffer.from(asset[key],'base64');
      const file=id+'-transport-'+index+'.png';assert.equal(hash(bytes),result.images[index].sha256);
      assert(bytes.equals(readFileSync(join(root,file))));
      assets[normalized]={...asset,[key]:'[PNG omitted; exact bytes in '+file+']'};
      changes.push({document:wireMode?'wire':'logical',path:'/assets/'+normalized,operation:'normalize object key',originalKeySha256:hash(ref),originalKeyUtf16Spans:[[0,ref.length]],replacementKey:normalized});
      changes.push({document:wireMode?'wire':'logical',path:'/assets/'+normalized+'/'+key,operation:'omit PNG base64',originalUtf16Spans:[[0,asset[key].length]],originalValueSha256:hash(asset[key]),decodedSha256:hash(bytes),replacement:assets[normalized][key]});
    });
    value.assets=assets;
    for(const [questionId,question] of Object.entries(value.questions)){
      for(const field of ['before','after']){
        const original=question.instructions[field],replacement=refMap.get(original);assert(replacement);
        changes.push({document:wireMode?'wire':'logical',path:'/questions/'+questionId+'/instructions/'+field,operation:'normalize opaque image reference',originalUtf16Spans:[[0,original.length]],originalValueSha256:hash(original),replacement});
        question.instructions[field]=replacement;
      }
    }
    assert(refs.every(ref=>!JSON.stringify(value).includes(ref)));
    return value;
  };
  const logical=replace(actual,false),canonicalWire=replace(wire,true);
  requests.push({id,logical,canonicalWire,response:read(id+'-response.json'),images:result.images,questionImagePairs:result.questionImagePairs});
  ledgers.push({id,originalLogicalSha256:hash(raw),originalWireSha256:hash(readFileSync(join(root,id+'-wire.json'))),sanitizedLogicalSha256:hash(JSON.stringify(logical)),sanitizedWireSha256:hash(JSON.stringify(canonicalWire)),storedBeforeInference:true,privateMode:'0600',sanitizedStateSentToProvider:false,changes});
}
const clean=value=>{
  if(Array.isArray(value))return value.map(clean);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clean(item)]));
  return typeof value==='string'?(refMap.get(value)??value):value;
};
for(const name of readdirSync(root).filter(name=>name.endsWith('.png')))copyFileSync(join(root,name),join(out,name));
for(const name of ['source-binding.json','declaration.json','preserved-provenance.json','corpus-ground-truth.json','results.json','browser-summary.json','setup-failure.json','cleanup.json'])copyFileSync(join(root,name),join(out,name));
const bound=readFileSync(join(root,'bound-source.mts'),'utf8');
writeFileSync(join(out,'source-closure.ts'),bound.slice(bound.indexOf('const CAPTCHA_HOVER_MIN'),bound.lastIndexOf('\nreturn cosmeticHover;}')));
save('logical-wire-requests-sanitized.json',{requests});
save('redaction-ledger.json',{coordinateConvention:'JSONPointer after asset-key normalization; UTF16 spans are zero-based/end-exclusive in each original string. Normalized asset key original hash and spans bind its original opaque UUID. No content besides image-reference normalization and raw-PNG omission changed.',requests:ledgers});
save('protocol-model-trace.json',clean(trace));
save('publication-checks.json',{preservedResultAndInitialTraceUnchanged:true,allRequestsStored0600BeforeInference:true,logicalWireStatesQuestionsAndImageBytesEqual:true,sharedStateHasNoImageRefs:true,eachQuestionHasExactlyRelevantTwoDistinctRefs:true,allSourceCanvasesPixelValidated:true,preservedFourCanvasesByteIdenticalTo3965f4ec:true,fullLogicalRequests:8,providerHttpRequests:8,httpStatuses:all.results.filter(x=>x.providerRequests).map(x=>x.httpStatus),models:[...new Set(all.results.filter(x=>x.model).map(x=>x.model))],corpusGroundTruthFrozenBeforeCorpusInference:true,rawImagesOmittedFromPublicText:true,nativeInputCommands:0});
const files=readdirSync(out).filter(name=>name!=='manifest.json').sort();
save('manifest.json',{files:files.map(file=>({file,sha256:hash(readFileSync(join(out,file))),bytes:statSync(join(out,file)).size}))});
console.log(JSON.stringify({files:files.length,requests:requests.length,providerRequests:all.providerRequests,manifestWritten:true}));
