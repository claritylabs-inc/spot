import {readFileSync,writeFileSync,mkdirSync,copyFileSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const root=resolve(process.env.QA_PRIVATE_OUTPUT),out=resolve(process.env.QA_ARTIFACT_OUTPUT),checkout=resolve(process.env.QA_ROUTER_CHECKOUT);
const hash=value=>createHash('sha256').update(value).digest('hex');
mkdirSync(join(out,'images'),{recursive:true});
const trace=JSON.parse(readFileSync(join(root,'trace.json'))),requests=[],ledgers=[];
const pointer=value=>value.replaceAll('~','~0').replaceAll('/','~1');
const patterns=[['public demo sitekey',/\b(?:0x|1x|2x|3x)[A-Za-z0-9_-]{18,}\b|\b6L[A-Za-z0-9_-]{20,}\b/g,'[REDACTED_DEMO_SITEKEY]'],['public API key placeholder',/YOUR_API_KEY/g,'[REDACTED_API_KEY_PLACEHOLDER]'],['sample response token or long opaque example',/[A-Za-z0-9_.~+/-]{80,}/g,'[REDACTED_SAMPLE_TOKEN]']];
const imageNames=new Map();
for(const meta of trace.filter(event=>event.kind==='logical_request')){
 const path=join(root,meta.privateFile),raw=readFileSync(path,'utf8'),actual=JSON.parse(raw);
 assert.equal(statSync(path).mode&0o777,0o600);assert.equal(hash(raw),meta.sha256);assert.equal(hash(JSON.stringify(actual.state)),meta.stateSha256);
 assert(statSync(path).mtimeMs<=Date.parse(meta.time)+2);
 const wire=JSON.parse(readFileSync(join(root,meta.id+'-wire-1.json')));
 assert.deepEqual(wire.state,actual.state);assert.deepEqual(wire.questions,actual.questions);
 const refs=new Map(),images=[],changes=[];
 const request=structuredClone(actual),assets={};
 Object.entries(actual.assets??{}).forEach(([ref,asset],index)=>{
  const normalized='image-'+(index+1),bytes=Buffer.from(asset.dataBase64,'base64'),sha256=hash(bytes),file='images/'+sha256+'.png';
  assert.equal(wire.assets[ref].data_base64,asset.dataBase64);
  writeFileSync(join(out,file),bytes);refs.set(ref,normalized);imageNames.set('model-'+sha256+'.png',file);imageNames.set('capture-'+sha256+'.png',file);
  assets[normalized]={...asset,dataBase64:'[PNG omitted; exact bytes in '+file+']'};
  images.push({ref:normalized,file,sha256,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),bytes:bytes.length});
  changes.push({path:'/assets/'+normalized+'/dataBase64',operation:'omit raw PNG/base64',decodedSha256:sha256,originalBase64Utf16Length:asset.dataBase64.length});
 });
 if(request.assets){request.assets=assets;changes.push({path:'/assets',operation:'normalize opaque asset keys consistently with state image references'});}
 function sanitize(value,path=''){
  if(Array.isArray(value))return value.map((item,index)=>sanitize(item,path+'/'+index));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,sanitize(item,path+'/'+pointer(key))]));
  if(typeof value!=='string')return value;
  if(refs.has(value)){changes.push({path,operation:'normalize opaque image reference',originalUtf16Spans:[[0,value.length]],originalValueSha256:hash(value),replacement:refs.get(value)});return refs.get(value);}
  // Raw image omission above is already recorded and must not be token-sanitized.
  if(path.endsWith('/dataBase64'))return value;
  const spans=[];
  for(const [reason,regex,replacement]of patterns){const matches=[...value.matchAll(regex)];if(matches.length){changes.push({path,operation:'replace string spans',reason,replacement,originalUtf16Spans:matches.map(match=>[match.index,match.index+match[0].length])});spans.push(...matches.map(match=>({start:match.index,end:match.index+match[0].length,replacement})));}}
  spans.sort((a,b)=>a.start-b.start);let text='',last=0;for(const span of spans){assert(span.start>=last);text+=value.slice(last,span.start)+span.replacement;last=span.end;}return text+value.slice(last);
 }
 const sanitized=sanitize(request);
 const response=trace.find(event=>event.kind==='model_response'&&event.id===meta.id);
 requests.push({id:meta.id,site:meta.site,origin:meta.origin,request:sanitized,images,response});
 ledgers.push({id:meta.id,site:meta.site,fullLogicalRequestStoredBeforeInference:true,privateFileMode:'0600',originalRequestSha256:meta.sha256,originalStateSha256:meta.stateSha256,sanitizedRequestSha256:hash(JSON.stringify(sanitized)),sanitizedStateSha256:hash(JSON.stringify(sanitized.state)),sanitizedStateSentToProvider:false,changes});
}
// Include every captured viewport as a separate image; the protocol trace never embeds bytes.
for(const event of trace.filter(event=>event.kind==='cdp_capture')){
 const bytes=readFileSync(join(root,event.file)),file='images/'+event.sha256+'.png';assert.equal(hash(bytes),event.sha256);writeFileSync(join(out,file),bytes);imageNames.set(event.file,file);
}
const sessions=new Map(),frames=new Map();
function clean(value,key){
 if(Array.isArray(value))return value.map(item=>clean(item));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([name,item])=>[name,clean(item,name)]));
 if(typeof value==='string'){
  if(key==='sessionId'){if(!sessions.has(value))sessions.set(value,'session-'+(sessions.size+1));return sessions.get(value);}
  if(key==='frameId'){if(!frames.has(value))frames.set(value,'frame-'+(frames.size+1));return frames.get(value);}
  return imageNames.get(value)??value;
 }
 return value;
}
const publicTrace=clean(trace).map(event=>{
 if(event.kind==='logical_request')event.images=event.images.map((image,index)=>({...image,ref:'image-'+(index+1)}));
 return event;
});
writeFileSync(join(out,'logical-requests-sanitized.json'),JSON.stringify({requests},null,2)+'\n');
writeFileSync(join(out,'redaction-ledger.json'),JSON.stringify({coordinateConvention:'JSONPointer in each original logical request; UTF16 spans are zero-based and end-exclusive',requests:ledgers},null,2)+'\n');
writeFileSync(join(out,'protocol-model-trace.json'),JSON.stringify(publicTrace,null,2)+'\n');
copyFileSync(join(root,'results.json'),join(out,'results.json'));
for(const site of ['recaptcha-v2','turnstile'])copyFileSync(join(root,site+'-result.png'),join(out,site+'-result.png'));

const {default:ts}=await import(pathToFileURL(join(checkout,'node_modules/typescript/lib/typescript.js')));
const source=readFileSync(join(checkout,'packages/server/src/browse/primitives.ts'),'utf8');
const ast=ts.createSourceFile('primitives.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),closures=[];
const selected=new Set(['locate','cosmeticHover','challengeFrames','openFence','glideTo','enlargedFrame','grayCanvas','cursorPath']);
function visit(node){
 const name=node.name?.text;
 if(name&&((selected.has(name)&&(ts.isVariableDeclaration(node)||ts.isFunctionDeclaration(node)))||(name==='captchaClick'&&ts.isPropertyAssignment(node)&&node.getText(ast).includes('await challengeFrames')))){
  const text=node.getText(ast);closures.push({name,nodeKind:ts.SyntaxKind[node.kind],sha256:hash(text),startLine:ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1,endLine:ast.getLineAndCharacterOfPosition(node.getEnd()).line+1});
 }
 ts.forEachChild(node,visit);
}
visit(ast);assert(closures.some(node=>node.name==='captchaClick'));
const files=['packages/server/src/browse/primitives.ts','packages/server/src/browse/targets.ts','packages/server/src/skills/harness.ts','packages/server/src/skills/gate.ts','packages/server/src/skills/challenge/captcha.ts','packages/server/src/providers/decisions.ts'];
const sourceBinding={candidate:'857074d99baa09792b66a45d65a3ca73aef53719',canonicalSourceEdited:false,typescriptExecutedThroughTsx:true,providerImportBindings:trace.find(event=>event.kind==='source_binding').importBindings,observerWrapperSha256:trace.find(event=>event.kind==='source_binding').wrapperSha256,method:'Node registerHooks redirects only primitives.ts executeDecision import to a private observation wrapper. Same actual input and options delegate to unchanged candidate provider; only fetch is observed. Controller skill decisions use the same provider function. No scripted decisions or source guard changes.',sourceFiles:Object.fromEntries(files.map(file=>[file,hash(readFileSync(join(checkout,file)))])),closures,logicalRequests:requests.length,providerHttpAttempts:trace.filter(event=>event.kind==='provider_http').length,allWireStatesQuestionsAssetsEqualLogical:true,actualNativeCalls:trace.filter(event=>event.kind==='native_entry').length,stopSpy:false};
writeFileSync(join(out,'source-binding.json'),JSON.stringify(sourceBinding,null,2)+'\n');
console.log(JSON.stringify({logicalRequests:requests.length,ledgers:ledgers.length,sourceClosures:closures.length,imageFiles:new Set(imageNames.values()).size}));
