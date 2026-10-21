import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const checkout=process.env.QA_ROUTER_CHECKOUT;
if(!checkout)throw Error('QA_ROUTER_CHECKOUT required');
const {PNG}=await import(pathToFileURL(checkout+'/node_modules/pngjs/lib/png.js'));
import {bind} from './cosmetic-source.mts';
const root=process.env.QA_PRIVATE_OUTPUT?.replace(/\/?$/, '/');
const priorRoot=process.env.QA_PRIOR_ARTIFACTS?.replace(/\/?$/, '/');
if(!root || !priorRoot)throw Error('QA_PRIVATE_OUTPUT and QA_PRIOR_ARTIFACTS required');
const hash=b=>createHash('sha256').update(b).digest('hex');
const trace=JSON.parse(readFileSync(priorRoot+'runtime-trace.json'));
const prior=trace.find(e=>e.kind==='real_jev' && e.questionIds.includes('hover_only'));
const quad=trace.find(e=>e.seq===49).result.model.content;
const xs=[0,2,4,6].map(i=>quad[i]),ys=[1,3,5,7].map(i=>quad[i]);
const visible={x:Math.round(Math.min(...xs)),y:Math.round(Math.min(...ys)),width:Math.round(Math.max(...xs)-Math.min(...xs)),height:Math.round(Math.max(...ys)-Math.min(...ys))};
const originals=prior.images.map(image=>{const bytes=readFileSync(priorRoot+image.file);assert.equal(hash(bytes),image.sha256);return {meta:image,decoded:PNG.sync.read(bytes)};});
const result={candidate:'7ad8e5e05cf5a3c076a9a67b190cef0f89f11a36',scope:'one read-only real-provider request, no browser runtime/press',placement:visible,originalImages:prior.images,sourceExtraction:JSON.parse(readFileSync(new URL('./source-extraction.json',import.meta.url))),originalBytesVerified:true,providerAttempts:0};
const capture=request=>{
 assert.deepEqual(Object.keys(request.questions),prior.questionIds);
 const core=q=>typeof q.instructions==='string'?q.instructions:q.instructions.question;
 result.coreQuestionsUnchanged=prior.questionIds.every(id=>core(prior.questions[id])===core(request.questions[id]));assert(result.coreQuestionsUnchanged);
 result.questions=request.questions;result.state={...request.state,before:'asset-before',after:'asset-after'};
 const padded=Object.values(request.assets).map((asset,index)=>{
  const bytes=Buffer.from(asset.dataBase64,'base64'),png=PNG.sync.read(bytes),original=originals[index].decoded;
  assert.equal(png.width,1024);assert.equal(png.height,768);assert.equal(original.width,visible.width);assert.equal(original.height,visible.height);
  for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){
   const inside=x>=visible.x && x<visible.x+visible.width && y>=visible.y && y<visible.y+visible.height;
   for(let c=0;c<4;c++){
    const expected=inside?original.data[((y-visible.y)*original.width+x-visible.x)*4+c]:(c===3?255:128);
    assert.equal(png.data[(y*png.width+x)*4+c],expected);
   }
  }
  const file=index===0?'padded-before.png':'padded-after.png';writeFileSync(root+file,bytes,{mode:0o600});
  return {file,sha256:hash(bytes),width:png.width,height:png.height,bytes:bytes.length,embeddedPixelsEqual:true,outsideExactlyOpaqueGray:true};
 });
 result.transportImages=padded;result.placementIdentical=true;result.unrelatedPagePixelsIncluded=false;
 writeFileSync(root+'request-validation.json',JSON.stringify(result,null,2),{mode:0o600});
};
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,init)=>{
 assert(String(url).startsWith('https://api.typesafe.ai/v1/systemone'));
 result.providerAttempts++;
 const response=await originalFetch(url,init);result.httpStatus=response.status;
 const body=await response.clone().json().catch(()=>null);
 if(response.ok){result.model=body.model;result.answers=body.answers;result.usage=body.usage;}
 else{
  const detail=body?.detail;
  const safe=s=>typeof s==='string'?s.replace(/[A-Za-z0-9_+\/-]{80,}={0,2}/g,'[long data omitted]').slice(0,300):undefined;
  result.providerValidation={error_type:safe(detail?.error_type),message:safe(detail?.message)};
 }
 return response;
};
const cosmeticHover=bind({tenantId:'spot-authorized-live-qa',environment:process.env},AbortSignal.timeout(30_000),capture);
const started=Date.now();
result.cosmeticHoverApproved=await cosmeticHover(...originals.map(x=>({visible,pixels:x.decoded.data})),prior.target);
result.elapsedMs=Date.now()-started;result.finishedAt=new Date().toISOString();
writeFileSync(root+'provider-result.json',JSON.stringify(result,null,2),{mode:0o600});
console.log(JSON.stringify({httpStatus:result.httpStatus,providerAttempts:result.providerAttempts,model:result.model,answers:result.answers,cosmeticHoverApproved:result.cosmeticHoverApproved,providerValidation:result.providerValidation,placement:result.placement,transportImages:result.transportImages}));
