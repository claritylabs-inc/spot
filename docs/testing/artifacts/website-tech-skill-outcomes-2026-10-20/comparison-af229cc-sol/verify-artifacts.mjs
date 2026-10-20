// Offline artifact integrity/workflow receipt check; no network or browser.
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const out=fileURLToPath(new URL('.',import.meta.url)),checkout=resolve(process.env.QA_ROUTER_CHECKOUT);
const {PNG}=await import(pathToFileURL(join(checkout,'node_modules/pngjs/lib/png.js')));
const hash=value=>createHash('sha256').update(value).digest('hex');
const bytes=name=>readFileSync(join(out,name)),json=name=>JSON.parse(bytes(name)),png=name=>PNG.sync.read(bytes(name));
for(const item of json('manifest.json').files){assert.equal(hash(bytes(item.file)),item.sha256);assert.equal(bytes(item.file).length,item.bytes);}
const all=json('results.json'),requests=json('logical-wire-requests-sanitized.json').requests;
assert.equal(all.results.length,10);assert.equal(all.providerRequests,8);assert.equal(requests.length,8);
const expectedIds=['same_instruction','same_images','same_selection','same_control','no_new_mark','style_only'];
for(const request of requests){
  const {logical,canonicalWire}=request,record=all.results.find(item=>item.id===request.id);
  assert.deepEqual(logical.state,canonicalWire.state);assert.deepEqual(logical.questions,canonicalWire.questions);
  assert.deepEqual(Object.keys(logical.questions),expectedIds);
  assert(!JSON.stringify(logical.state).includes('image-'));
  assert.equal(record.httpStatus,200);assert.equal(record.model,'jev-1.13.0');assert.equal(record.providerRequests,1);
  const sourceFrames=request.id==='preserved-857'?['../live-857074d-sol/recaptcha-v2-frame-before.png','../live-857074d-sol/recaptcha-v2-frame-after.png']:[request.id+'-before-frame.png',request.id+'-after-frame.png'];
  for(let i=0;i<4;i++){
    const image=png(record.images[i].file),frame=png(sourceFrames[i%2]),full=i<2,scale=full?1:record.targetScale;
    assert.equal(hash(bytes(record.images[i].file)),record.images[i].sha256);
    const region=full?{x:0,y:0,width:frame.width,height:frame.height}:{x:record.region.x,y:record.region.y,width:record.region.right-record.region.x,height:record.region.bottom-record.region.y};
    const placement=full?record.visible:{x:0,y:0};assert.equal(image.width,1024);assert.equal(image.height,768);
    for(let y=0;y<768;y++)for(let x=0;x<1024;x++){
      const inside=x>=placement.x&&y>=placement.y&&x<placement.x+region.width*scale&&y<placement.y+region.height*scale;
      const expected=inside?frame.data.readUInt32BE(((region.y+Math.floor((y-placement.y)/scale))*frame.width+region.x+Math.floor((x-placement.x)/scale))*4):0x808080ff;
      assert.equal(image.data.readUInt32BE((y*1024+x)*4),expected);
    }
    if(request.id==='preserved-857')assert(bytes(record.images[i].file).equals(bytes('../live-857074d-sol/'+['recaptcha-v2-hover-frame-before.png','recaptcha-v2-hover-frame-after.png','recaptcha-v2-hover-target-before.png','recaptcha-v2-hover-target-after.png'][i])));
  }
  expectedIds.forEach((id,index)=>{
    const instructions=logical.questions[id].instructions,pair=index<3?['image-0','image-1']:['image-2','image-3'];
    assert.equal(instructions.before,pair[0]);assert.equal(instructions.after,pair[1]);
    assert.deepEqual(Object.keys(logical.assets).filter(ref=>JSON.stringify(instructions).includes(ref)),pair);
  });
  assert.equal(record.approved,Object.values(request.response.answers).every(answer=>answer.type==='noul'&&answer.noul>=.9));
}
for(const item of json('corpus-ground-truth.json'))for(const phase of ['before','after']){
  const viewport=png(item.id+'-'+phase+'-viewport.png'),frame=png(item.id+'-'+phase+'-frame.png'),rect=item[phase+'Observation'].frame;
  for(let y=0;y<frame.height;y++)assert(viewport.data.subarray(((rect.y+y)*viewport.width+rect.x)*4,((rect.y+y)*viewport.width+rect.x+rect.width)*4).equals(frame.data.subarray(y*frame.width*4,(y+1)*frame.width*4)));
}
const binding=json('source-binding.json'),source=readFileSync(join(checkout,'packages/server/src/browse/primitives.ts'),'utf8');
assert.equal(hash(source),binding.sourceFileSha256);
const start=source.indexOf('  const cosmeticHover = async ('),closure=source.slice(start,source.indexOf('\n  // Sandbox clicks',start));
assert.equal(hash(closure),binding.closureSha256);assert(bytes('source-closure.ts').toString().includes(closure));
assert(Object.values(json('cleanup.json')).every(value=>typeof value!=='boolean'||value));
console.log(JSON.stringify({manifest:'PASS',requestPairsAndWire:'PASS',allPixelsAndFrameCrops:'PASS',preservedByteIdentity:'PASS',sourceBinding:'PASS',cases:10,httpRequests:8,nativeInput:0}));
