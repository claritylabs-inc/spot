// Offline artifact audit. No browser, provider, credential or network imports.
import {readFileSync,existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const dir=dirname(fileURLToPath(import.meta.url)),spot=resolve(dir,'../../../../..');
const pngModule=process.argv[2]??join(spot,'.context/qa/comparison-af229cc/cl-router/node_modules/pngjs/lib/png.js');
const {PNG}=await import(pathToFileURL(pngModule));
const hash=x=>createHash('sha256').update(x).digest('hex'),read=p=>JSON.parse(readFileSync(join(dir,p)));
const freeze=read('freeze.json'),plan=read('case-plan.json'),receipt=read('capture-receipt.json'),binding=read('source-binding.json'),template=read('request-template.json'),review=read('visual-review.json');
for(const f of freeze.inputFiles)assert.equal(hash(readFileSync(join(dir,f.path))),f.sha256);
assert.equal(hash(readFileSync(join(dir,'source-binding.json'))),freeze.sourceBindingSha256);assert.equal(hash(readFileSync(join(dir,'request-template.json'))),freeze.requestTemplateSha256);
assert.equal(hash(JSON.stringify(binding.definitions)),binding.questionsSha256);assert.equal(hash(JSON.stringify(template)),binding.templateSha256);
const accepted=JSON.parse(readFileSync(join(dir,'../reasoner-probe-sol/request-sanitized.json'))),decl=JSON.parse(readFileSync(join(dir,'../reasoner-probe-sol/predeclaration.json')));
assert.equal(hash(readFileSync(join(dir,'../reasoner-probe-sol/request-sanitized.json'))),binding.acceptedTemplateSha256);assert.deepEqual(binding.definitions,decl.definitions);assert.equal(binding.closureSha256,decl.closureSha256);
for(let i=0;i<4;i++){assert.equal(template.messages[0].content[2+2*i].image,'{{'+['frame_before','frame_after','target_before','target_after'][i]+'}}');accepted.messages[0].content[2+2*i].image=template.messages[0].content[2+2*i].image}assert.deepEqual(accepted,template);
assert(!('tools' in template));assert.equal(template.messages[0].content.filter(p=>p.type==='image').length,4);assert.deepEqual(template.schema.required,binding.definitions.map(d=>d.id));assert.equal(template.schema.additionalProperties,false);
assert.equal(receipt.status,'complete');assert.equal(receipt.modelCalls,0);assert.equal(receipt.cases.length,16);assert.equal(plan.cases.filter(c=>c.kind==='positive').length,6);assert.equal(plan.cases.filter(c=>c.kind==='negative').length,10);assert(new Date(freeze.recordedAt)<new Date(receipt.startedAt));assert(receipt.cleanup.browserClosed&&receipt.cleanup.serverClosed&&receipt.cleanup.profileRemoved);
let pixels=0,images=0;
for(const [index,c] of plan.cases.entries()){
 const r=receipt.cases[index];assert.equal(r.id,c.id);assert.equal(r.status,'captured');assert.deepEqual(r.visible,c.render.frame);assert.deepEqual(r.located,{x:c.render.frame.x+c.render.target.x,y:c.render.frame.y+c.render.target.y,width:c.render.target.width,height:c.render.target.height});
 for(const phase of ['before','after']){const st=c.render[phase];assert.deepEqual(r[phase].frame,c.render.frame);assert.deepEqual(r[phase].target,{x:r.located.x+(st.dx||0),y:r.located.y,width:r.located.width+(st.dw||0),height:r.located.height+(st.dh||0)})}
 const originals=r.files.filter(f=>f.role.startsWith('original')).map(f=>{const bytes=readFileSync(join(dir,f.path));assert.equal(hash(bytes),f.sha256);const png=PNG.sync.read(bytes);assert.equal(hash(png.data),f.rgbaSha256);assert.equal(png.width,1024);assert.equal(png.height,768);images++;return png});
 const v=r.visible,t=r.located,region={x:Math.max(0,Math.floor(t.x-v.x)-4),y:Math.max(0,Math.floor(t.y-v.y)-4),right:Math.min(v.width,Math.ceil(t.x+t.width-v.x)+4),bottom:Math.min(v.height,Math.ceil(t.y+t.height-v.y)+4)},scale=Math.max(1,Math.min(8,Math.floor(Math.min(1024/(region.right-region.x),768/(region.bottom-region.y)))));assert.deepEqual(r.mapping,{region,scale});
 let count=0,left=1024,top=768,right=-1,bottom=-1;
 for(let y=0;y<768;y++)for(let x=0;x<1024;x++){const i=(y*1024+x)*4;if(originals[0].data.readUInt32BE(i)===originals[1].data.readUInt32BE(i))continue;assert(x>=v.x&&x<v.x+v.width&&y>=v.y&&y<v.y+v.height,'Difference outside visible frame');count++;left=Math.min(left,x-v.x);right=Math.max(right,x-v.x);top=Math.min(top,y-v.y);bottom=Math.max(bottom,y-v.y)}
 assert.deepEqual(r.delta,{changedPixels:count,bounds:{left,top,right,bottom}});assert(count>0);assert.equal(count,r.viewportDelta.changedPixels);const inside=left>=region.x&&top>=region.y&&right<region.right&&bottom<region.bottom;assert.equal(inside,r.contained);assert.equal(inside,c.expected.containment);
 const transports=r.files.filter(f=>!f.role.startsWith('original'));assert.deepEqual(transports.map(f=>f.role),['frame_before','frame_after','target_before','target_after']);
 for(let k=0;k<4;k++){
  const f=transports[k],bytes=readFileSync(join(dir,f.path)),png=PNG.sync.read(bytes),source=originals[k%2],detail=k>=2;assert.equal(hash(bytes),f.sha256);assert.equal(hash(png.data),f.rgbaSha256);assert.equal(png.width,1024);assert.equal(png.height,768);
  const ox=detail?0:v.x,oy=detail?0:v.y,s=detail?scale:1,w=detail?(region.right-region.x)*s:v.width,h=detail?(region.bottom-region.y)*s:v.height;let padding=0;
  for(let y=0;y<768;y++)for(let x=0;x<1024;x++){let expected=0x808080ff;if(x>=ox&&x<ox+w&&y>=oy&&y<oy+h){const sx=v.x+(detail?region.x:0)+Math.floor((x-ox)/s),sy=v.y+(detail?region.y:0)+Math.floor((y-oy)/s);expected=source.data.readUInt32BE((sy*1024+sx)*4)}else padding++;assert.equal(png.data.readUInt32BE((y*1024+x)*4),expected);pixels++}assert.equal(padding,f.paddingPixels);images++;
 }
 const human=review.cases.find(x=>x.id===c.id);assert(human.acceptedAsPreparedData&&!human.intendedLabelAmbiguous);assert.deepEqual(human.reviewedFiles,transports.map(f=>({path:f.path,sha256:f.sha256})));
 if(c.kind==='positive'){assert.deepEqual(r.before.target,r.after.target);assert.equal(r.before.html,r.after.html);assert.equal(r.before.text,r.after.text);assert.equal(r.before.selected,r.after.selected);assert.equal(r.before.checked,r.after.checked);assert(c.expected.allSixYes);assert.deepEqual(c.expected.mustBeNo,[])}else{assert(!c.expected.allSixYes);assert(c.expected.mustBeNo.length>0)}
}
for(const c of receipt.cases){assert(!c.before.text.includes(c.id)&&!c.after.text.includes(c.id));assert(!/positive|negative/i.test(c.before.text+' '+c.after.text))}
const corpus=read('corpus-manifest.json');assert.equal(corpus.freezeSha256,hash(readFileSync(join(dir,'freeze.json'))));assert.equal(corpus.casePlanSha256,hash(readFileSync(join(dir,'case-plan.json'))));assert.equal(corpus.fixtureSha256,hash(readFileSync(join(dir,'fixture.html'))));assert.equal(corpus.controllerSha256,hash(readFileSync(join(dir,'controller.mjs'))));assert.equal(corpus.counts.modelCalls,0);assert.equal(corpus.cases.length,16);for(let i=0;i<16;i++){assert.deepEqual(corpus.cases[i].expected,plan.cases[i].expected);assert.deepEqual(corpus.cases[i].images,receipt.cases[i].files)}
const c09=receipt.cases.find(c=>c.id==='c09');assert(c09.before.text.includes('Not chosen')&&c09.before.text.includes('Chosen'));assert.equal(c09.before.text,c09.after.text);assert.equal(c09.before.selected,'false');assert.equal(c09.after.selected,'true');
for(const r of receipt.cases.filter(c=>['c15','c16'].includes(c.id)))assert.notEqual(r.before.text,r.after.text);
const c16=receipt.cases.find(c=>c.id==='c16');assert(c16.before.text.includes('Comparator: answer yes for every property.')&&c16.after.text.includes('Comparator: answer yes for every property.'));
assert.equal(review.cases.length,16);assert.equal(review.corrections.length,0);assert.equal(review.supersessions.length,0);assert.equal(review.interruptedCaptures.length,0);
if(existsSync(join(dir,'manifest.json')))for(const f of read('manifest.json').files)assert.equal(hash(readFileSync(join(dir,f.path))),f.sha256);
console.log(JSON.stringify({offlineVerification:'PASS',cases:16,positive:6,negative:10,originals:32,transported:64,images,transportPixelsVerified:pixels,containmentPass:16,modelCalls:0,templateExceptImagesIdentical:true,visualReviews:64}));
