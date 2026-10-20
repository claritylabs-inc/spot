import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const root=resolve(process.env.QA_PRIVATE_OUTPUT),out=resolve(process.env.QA_ARTIFACT_OUTPUT),checkout=resolve(process.env.QA_ROUTER_CHECKOUT);
mkdirSync(out,{recursive:true});
const {PNG}=await import(pathToFileURL(join(checkout,'node_modules/pngjs/lib/png.js')));
const hash=value=>createHash('sha256').update(value).digest('hex');
const trace=JSON.parse(readFileSync(join(root,'trace.json')));
const actual=event=>JSON.parse(readFileSync(join(root,event.privateFile)));
const image=(event,index=0)=>PNG.sync.read(Buffer.from(Object.values(actual(event).assets)[index].dataBase64,'base64'));
const crop=(png,rect)=>{const result=new PNG({width:rect.width,height:rect.height});for(let y=0;y<rect.height;y++)png.data.copy(result.data,y*rect.width*4,((rect.y+y)*png.width+rect.x)*4,((rect.y+y)*png.width+rect.x+rect.width)*4);return result;};
const writeImage=(file,bytes)=>{writeFileSync(join(out,file),bytes);return {file,sha256:hash(bytes),bytes:bytes.length};};
const delta=(before,after)=>{let left=before.width,top=before.height,right=-1,bottom=-1,count=0;const colors=new Map();for(let y=0;y<before.height;y++)for(let x=0;x<before.width;x++){const i=(y*before.width+x)*4;if(before.data.readUInt32BE(i)===after.data.readUInt32BE(i))continue;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);count++;const key=before.data.subarray(i,i+4).toString('hex')+'>'+after.data.subarray(i,i+4).toString('hex');colors.set(key,(colors.get(key)??0)+1);}return {changedPixels:count,inclusiveBounds:count?{left,top,right,bottom}:null,colorTransitions:Object.fromEntries(colors)};};
const checkCanvas=(png,frame,placement,scale=1,region={x:0,y:0,width:frame.width,height:frame.height})=>{
 assert.equal(png.width,1024);assert.equal(png.height,768);
 for(let y=0;y<768;y++)for(let x=0;x<1024;x++){
  const inside=x>=placement.x&&y>=placement.y&&x<placement.x+region.width*scale&&y<placement.y+region.height*scale;
  const offset=((region.y+Math.floor((y-placement.y)/scale))*frame.width+region.x+Math.floor((x-placement.x)/scale))*4;
  const expected=inside?frame.data.readUInt32BE(offset):0x808080ff;
  assert.equal(png.data.readUInt32BE((y*1024+x)*4),expected);
 }
 return {everyPixelVerified:true,paddingOpaqueGray:true,scale,placement,region};
};
const evidence={candidate:'857074d99baa09792b66a45d65a3ca73aef53719',sites:[]};
for(const site of ['recaptcha-v2','turnstile']){
 const events=trace.filter(event=>event.site===site);
 const requests=events.filter(event=>event.kind==='logical_request'&&event.origin==='native');
 const full=requests.find(event=>!actual(event).state.frame_image&&!actual(event).questions.same_instruction);
 const refined=requests.find(event=>actual(event).state.frame_image);
 const hover=requests.find(event=>actual(event).questions.same_instruction);
 assert(full&&refined);
 const answer=event=>events.find(item=>item.kind==='model_response'&&item.id===event.id).answers.target;
 const firstBox=answer(full),secondBox=answer(refined);
 const selectedPoint={x:(firstBox.box.left+firstBox.box.right)*512,y:(firstBox.box.top+firstBox.box.bottom)*384};
 const geometry=events.filter(event=>event.kind==='cdp'&&event.method==='DOM.getBoxModel'&&event.seq<full.seq).filter(event=>{const q=event.result.model.content;return selectedPoint.x>Math.min(q[0],q[2],q[4],q[6])&&selectedPoint.x<Math.max(q[0],q[2],q[4],q[6])&&selectedPoint.y>Math.min(q[1],q[3],q[5],q[7])&&selectedPoint.y<Math.max(q[1],q[3],q[5],q[7]);}).at(-1);
 assert(geometry);
 const quad=geometry.result.model.content;
 const rect={x:Math.round(Math.min(quad[0],quad[2],quad[4],quad[6])),y:Math.round(Math.min(quad[1],quad[3],quad[5],quad[7])),width:Math.round(Math.max(quad[0],quad[2],quad[4],quad[6])-Math.min(quad[0],quad[2],quad[4],quad[6])),height:Math.round(Math.max(quad[1],quad[3],quad[5],quad[7])-Math.min(quad[1],quad[3],quad[5],quad[7]))};
 const visible={x:Math.max(0,rect.x),y:Math.max(0,rect.y),width:Math.min(1024,rect.x+rect.width)-Math.max(0,rect.x),height:Math.min(768,rect.y+rect.height)-Math.max(0,rect.y)};
 const before=image(full),frameBefore=crop(before,visible);
 const entry=events.find(event=>event.kind==='native_entry'),returned=events.find(event=>event.kind==='native_return');
 const nativeCaptures=events.filter(event=>event.kind==='cdp_capture'&&event.seq>entry.seq&&event.seq<returned.seq);
 const initialCapture=nativeCaptures.find(event=>event.sha256===full.images[0].sha256);assert(initialCapture);
 const afterCapture=nativeCaptures.at(-1);
 const after=PNG.sync.read(readFileSync(join(root,afterCapture.file))),frameAfter=crop(after,visible);
 const geometryEvents=events.filter(event=>event.kind==='cdp'&&event.method==='DOM.getBoxModel'&&event.params.backendNodeId===geometry.params.backendNodeId&&event.seq>entry.seq&&event.seq<returned.seq);
 assert(geometryEvents.every(event=>JSON.stringify(event.result.model.content)===JSON.stringify(quad)));
 const scale=Math.max(1,Math.min(8,Math.floor(Math.min(1024/visible.width,768/visible.height))));
 const refinementPixels=checkCanvas(image(refined),frameBefore,{x:0,y:0},scale);
 const box=secondBox.box,toX=f=>visible.x+f*1024/scale,toY=f=>visible.y+f*768/scale;
 const located={x:toX(box.left),y:toY(box.top),width:toX(box.right)-toX(box.left),height:toY(box.bottom)-toY(box.top)};
 const center={x:(toX(box.left)+toX(box.right))/2,y:(toY(box.top)+toY(box.bottom))/2};
 const region={x:Math.max(0,Math.floor(located.x-visible.x)-4),y:Math.max(0,Math.floor(located.y-visible.y)-4),right:Math.min(visible.width,Math.ceil(located.x+located.width-visible.x)+4),bottom:Math.min(visible.height,Math.ceil(located.y+located.height-visible.y)+4)};
 const movements=events.filter(event=>event.kind==='cdp'&&event.method==='Input.dispatchMouseEvent');
 const moves=movements.filter(event=>event.params.type==='mouseMoved'),presses=movements.filter(event=>event.params.type==='mousePressed'),releases=movements.filter(event=>event.params.type==='mouseReleased');
 assert(movements.every(event=>event.topSession));assert.equal(moves.at(-1).params.x,center.x);assert.equal(moves.at(-1).params.y,center.y);
 const difference=delta(frameBefore,frameAfter);
 const bounds=difference.inclusiveBounds;
 const containment=!bounds||(bounds.left>=region.x&&bounds.top>=region.y&&bounds.right<region.right&&bounds.bottom<region.bottom);
 const frameImages=[frameBefore,frameAfter].map((png,index)=>({...writeImage(site+'-frame-'+(index?'after':'before')+'.png',PNG.sync.write(png)),rgbaSha256:hash(png.data),derivedLosslessFromActualFullCapture:true,width:png.width,height:png.height}));
 const hoverProof=hover?(()=>{
  const request=actual(hover),assets=Object.values(request.assets),targetScale=Math.max(1,Math.min(8,Math.floor(Math.min(1024/(region.right-region.x),768/(region.bottom-region.y)))));
  const files=['hover-frame-before','hover-frame-after','hover-target-before','hover-target-after'];
  const transport=assets.map((asset,index)=>({role:files[index],...writeImage(site+'-'+files[index]+'.png',Buffer.from(asset.dataBase64,'base64'))}));
  checkCanvas(PNG.sync.read(Buffer.from(assets[0].dataBase64,'base64')),frameBefore,visible);
  checkCanvas(PNG.sync.read(Buffer.from(assets[1].dataBase64,'base64')),frameAfter,visible);
  const targetRegion={x:region.x,y:region.y,width:region.right-region.x,height:region.bottom-region.y};
  for(let index=2;index<4;index++)checkCanvas(PNG.sync.read(Buffer.from(assets[index].dataBase64,'base64')),index===2?frameBefore:frameAfter,{x:0,y:0},targetScale,targetRegion);
  return {requestId:hover.id,allFourPixelTransformsVerified:true,transportImages:transport,targetRegion,targetScale,questions:request.questions,answers:events.find(event=>event.kind==='model_response'&&event.id===hover.id).answers};
 })():{requested:false,reason:'Before/after frame RGBA identical; native source skips cosmeticHover.'};
 const hit=events.find(event=>event.kind==='cdp'&&event.method==='DOM.getNodeForLocation');
 const layout=events.find(event=>event.kind==='cdp'&&event.method==='Page.getLayoutMetrics');
 if(presses.length){assert.equal(presses.length,1);assert.equal(releases.length,1);assert(hit&&layout);assert(afterCapture.seq<hit.seq&&hit.seq<presses[0].seq&&presses[0].seq<releases[0].seq);assert.equal(presses[0].params.x,center.x);assert.equal(presses[0].params.y,center.y);assert.equal(hit.params.x,Math.round(center.x+layout.result.cssLayoutViewport.pageX));assert.equal(hit.params.y,Math.round(center.y+layout.result.cssLayoutViewport.pageY));}
 evidence.sites.push({site,fullBox:{requestId:full.id,...firstBox,selectedPoint,imageSha256:full.images[0].sha256},frame:{ownerNodeId:geometry.params.backendNodeId,quad,rect,visible,unchangedRecordedOwnerQuads:true,geometryEventSequences:geometryEvents.map(event=>event.seq),beforeCapture:{seq:initialCapture.seq,sha256:initialCapture.sha256},afterCapture:{seq:afterCapture.seq,sha256:afterCapture.sha256},frameImages},refinedBox:{requestId:refined.id,...secondBox,imageSha256:refined.images[0].sha256,scale,refinementPixels,paddingRefusedBySourceBounds:true,boxInsideActiveImage:box.left>=0&&box.top>=0&&box.right<=visible.width*scale/1024&&box.bottom<=visible.height*scale/768,located,center},delta:difference,containment:{region,allChangedPixelsInside:containment},hover:hoverProof,motion:{allTopSession:true,moves:moves.length,curvePointsAfterInitialAnchor:moves.length-1,start:moves[0].params,end:moves.at(-1).params,firstMoveSeq:moves[0].seq,lastMoveSeq:moves.at(-1).seq,presses:presses.map(event=>({seq:event.seq,...event.params})),releases:releases.map(event=>({seq:event.seq,...event.params})),finalHit:hit?{seq:hit.seq,params:hit.params,result:hit.result}:null,layoutViewport:layout?.result.cssLayoutViewport??null},nativeReturn:returned});
}
writeFileSync(join(out,'geometry-images-motion.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence.sites.map(site=>({site:site.site,visible:site.frame.visible,refineScale:site.refinedBox.scale,located:site.refinedBox.located,delta:site.delta,containment:site.containment,moves:site.motion.moves,presses:site.motion.presses.length}))));
