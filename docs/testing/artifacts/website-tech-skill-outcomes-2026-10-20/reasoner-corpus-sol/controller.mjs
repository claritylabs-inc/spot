// Ordinary local Chrome fixture capture ONLY. No provider/credential/candidate runtime imports.
import {readFileSync,writeFileSync,mkdirSync,existsSync,openSync,closeSync,rmSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import {chromium} from 'playwright';
import {crop,difference,mapping,contained,canvas,verifyCanvas} from './pixels.mjs';
const here=dirname(fileURLToPath(import.meta.url)),spot=resolve(here,'../../../../..'),scratch=join(spot,'.context/qa/reasoner-corpus-sol'),router=join(spot,'.context/qa/comparison-af229cc/cl-router');
const {PNG}=await import(pathToFileURL(join(router,'node_modules/pngjs/lib/png.js'))),{default:ts}=await import(pathToFileURL(join(router,'node_modules/typescript/lib/typescript.js')));
const hash=x=>createHash('sha256').update(x).digest('hex'),save=(name,data)=>writeFileSync(join(here,name),JSON.stringify(data,null,2)+'\n');
const plan=JSON.parse(readFileSync(join(here,'case-plan.json'))),fixture=readFileSync(join(here,'fixture.html')),candidate='af229cc363c6a602f2964bfda2c4961dd0cf6e5f',roles=['frame_before','frame_after','target_before','target_after'];
assert.equal(plan.cases.length,16);assert.equal(plan.cases.filter(c=>c.kind==='positive').length,6);assert.equal(plan.cases.filter(c=>c.kind==='negative').length,10);
const bindingPaths=['case-plan.json','fixture.html','controller.mjs','pixels.mjs','make-plan.mjs'];
const inputFiles=bindingPaths.map(path=>({path,sha256:hash(readFileSync(join(here,path)))}));
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:router,encoding:'utf8'}).trim(),candidate);
const source=readFileSync(join(router,'packages/server/src/browse/primitives.ts'),'utf8');assert.equal(source,execFileSync('git',['show',candidate+':packages/server/src/browse/primitives.ts'],{cwd:router,encoding:'utf8',maxBuffer:20*1024*1024}));
const start=source.indexOf('  const cosmeticHover = async ('),closure=source.slice(start,source.indexOf('\n  // Sandbox clicks',start));
const accepted=JSON.parse(readFileSync(join(here,'../reasoner-probe-sol/predeclaration.json')));assert.equal(hash(closure),accepted.closureSha256);
const ast=ts.createSourceFile('primitives.ts',closure,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let node;function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='questions')node=n.initializer;ts.forEachChild(n,visit)}visit(ast);
const definitions=node.properties.map((p,i)=>{const a=p.initializer.arguments;return {id:p.name.getText(ast),question:a[2].text,...(a[3]?{scope:a[3].text}:{}),before:i<3?'frame_before':'target_before',after:i<3?'frame_after':'target_after'}});assert.deepEqual(definitions,accepted.definitions);
const acceptedTemplate=JSON.parse(readFileSync(join(here,'../reasoner-probe-sol/request-sanitized.json'))),template=structuredClone(acceptedTemplate);for(let i=0;i<4;i++)template.messages[0].content[2+i*2].image='{{'+roles[i]+'}}';
const sourceBinding={candidate,sourcePath:'packages/server/src/browse/primitives.ts',sourceSha256:hash(source),closureSha256:hash(closure),questionsSha256:hash(JSON.stringify(definitions)),definitions,acceptedProbeCommit:'889daaa761d3b55dd3a147fc97c4c7659eca8e3b',acceptedProbeDeclarationSha256:hash(readFileSync(join(here,'../reasoner-probe-sol/predeclaration.json'))),acceptedTemplateSha256:hash(readFileSync(join(here,'../reasoner-probe-sol/request-sanitized.json'))),templateSha256:hash(JSON.stringify(template)),constants:{threshold:0.9,margin:4,maxScale:8,viewport:{width:1024,height:768}},execution:'Source binding / pure pixel transform only; candidate closure, BrowserTargets, Box and native primitives NOT executed'};
const phase=process.argv[2];assert(['freeze','capture'].includes(phase));
if(phase==='freeze'){
 assert(!existsSync(join(here,'freeze.json')),'No overwrite of frozen declaration');save('source-binding.json',sourceBinding);save('request-template.json',template);save('freeze.json',{recordedAt:dayjs().toISOString(),inputFiles,sourceBindingSha256:hash(readFileSync(join(here,'source-binding.json'))),requestTemplateSha256:hash(readFileSync(join(here,'request-template.json'))),caseCounts:plan.counts,expectationsFrozenBeforeCapture:true,inferenceAuthorized:false,modelVisibleFields:'Only unchanged neutral template and four role image bytes; never case ID, expected labels, DOM observations or case facts'});console.log('FROZEN case table/fixture/controller/mapping/source/questions/template before capture; no browser or inference');
}else{
 const freeze=JSON.parse(readFileSync(join(here,'freeze.json')));assert.deepEqual(inputFiles,freeze.inputFiles);assert.equal(hash(readFileSync(join(here,'source-binding.json'))),freeze.sourceBindingSha256);assert.equal(hash(readFileSync(join(here,'request-template.json'))),freeze.requestTemplateSha256);
 closeSync(openSync(join(scratch,'capture-attempted.lock'),'wx',0o600));const receipt={startedAt:dayjs().toISOString(),scope:'Headed ordinary Chrome; local controlled fixture; not candidate execution',cases:[],modelCalls:0,browserRequests:[],cleanup:{}};let browser,server;
 const persist=()=>save('capture-receipt.json',receipt);
 try{
  server=createServer((req,res)=>{receipt.browserRequests.push({path:req.url,method:req.method});if(req.url!=='/fixture'){res.writeHead(404);return res.end()}res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});res.end(fixture)});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;receipt.serverPort=server.address().port;
  const env=Object.fromEntries(['PATH','HOME','USER','LOGNAME','SHELL','LANG','LC_ALL','TMPDIR'].filter(n=>process.env[n]).map(n=>[n,process.env[n]]));env.DISPLAY=':99';
  browser=await chromium.launchPersistentContext(join(scratch,'chrome-profile'),{executablePath:'/usr/bin/google-chrome',headless:false,viewport:{width:1024,height:768},deviceScaleFactor:1,env,args:['--no-sandbox','--disable-background-networking','--no-first-run']});receipt.browserVersion=browser.browser().version();
  await browser.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());const page=browser.pages()[0];await page.goto(origin+'/fixture');
  for(const c of plan.cases){
   const rec={id:c.id,startedAt:dayjs().toISOString(),status:'started',geometrySource:'fixed synthetic fixture definitions + observed DOM; not Box',files:[]};receipt.cases.push(rec);persist();mkdirSync(join(here,c.id));const captures=[];
   for(const phase of ['before','after']){
    const observed=await page.evaluate(({spec,phase})=>window.renderFixture(spec,phase),{spec:c.render,phase});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const stable=await page.evaluate(()=>window.fixtureObservation());assert.deepEqual(stable,observed);
    const def=c.render,st=def[phase];assert.deepEqual(observed.frame,def.frame);assert.deepEqual(observed.target,{x:def.frame.x+def.target.x+(st.dx||0),y:def.frame.y+def.target.y,width:def.target.width+(st.dw||0),height:def.target.height+(st.dh||0)});
    const bytes=await page.screenshot({type:'png',animations:'disabled'}),file=c.id+'/viewport-'+phase+'.png';writeFileSync(join(here,file),bytes);const png=PNG.sync.read(bytes);assert.equal(png.width,1024);assert.equal(png.height,768);rec.files.push({role:'original_'+phase,path:file,sha256:hash(bytes),rgbaSha256:hash(png.data),bytes:bytes.length});captures.push({png,observed});
   }
   rec.before=captures[0].observed;rec.after=captures[1].observed;rec.visible=rec.before.frame;rec.located=rec.before.target;rec.mapping=mapping(rec.visible,rec.located);
   const frames=captures.map(x=>crop(PNG,x.png,rec.visible));rec.delta=difference(...frames);rec.viewportDelta=difference(captures[0].png,captures[1].png);rec.contained=contained(rec.delta,rec.mapping.region);assert.equal(rec.contained,c.expected.containment);assert(rec.delta.changedPixels>0);assert.equal(rec.delta.changedPixels,rec.viewportDelta.changedPixels,'No excluded page changes');
   for(let i=0;i<4;i++){const png=canvas(PNG,frames[i%2],rec.visible,rec.mapping,i>=2),bytes=PNG.sync.write(png),file=c.id+'/'+roles[i]+'.png';const proof=verifyCanvas(png,frames[i%2],rec.visible,rec.mapping,i>=2);writeFileSync(join(here,file),bytes);rec.files.push({role:roles[i],path:file,sha256:hash(bytes),rgbaSha256:hash(png.data),bytes:bytes.length,...proof})}
   rec.status='captured';rec.finishedAt=dayjs().toISOString();persist();console.log('CAPTURED '+c.id+' delta='+rec.delta.changedPixels+' contained='+rec.contained);
  }
  receipt.status='complete';
 }catch(e){receipt.status='interrupted';receipt.error={name:e.name,message:e.message};throw e}
 finally{if(browser)await browser.close();receipt.cleanup.browserClosed=!!browser;if(server){await new Promise(r=>server.close(r));receipt.cleanup.serverClosed=true}rmSync(join(scratch,'chrome-profile'),{recursive:true,force:true});receipt.cleanup.profileRemoved=!existsSync(join(scratch,'chrome-profile'));receipt.finishedAt=dayjs().toISOString();persist()}
}
