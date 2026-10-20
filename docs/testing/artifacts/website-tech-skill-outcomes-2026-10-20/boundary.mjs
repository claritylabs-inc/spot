// Preserved workflow replay; run from repository root. Runtime/private output stays in .context.
import {execFileSync} from 'node:child_process';
const testedCandidate=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import ts from 'typescript';
import vm from 'node:vm';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const checks=[];
const check=async(name,fn)=>{await fn();checks.push({name,status:'PASS'});console.log('PASS '+name)};
const s=await createServer({server:{middlewareMode:true},appType:'custom',configFile:false});
try {
 const {clRouterBrowse}=await s.ssrLoadModule('/convex/lib/clRouterClient.ts');
 const good={provider:'browserbase',model:'fixture',text:'',finished:false,steps:0,pages:[],networkHosts:[]};
 const skill={name:'inbox.wait_for_email',version:'1',status:'succeeded',summary:'Observed synthetic workflow',steps:0};
 const run=(skills,include=true)=>clRouterBrowse({input:{url:'https://skill-qa.example',goal:'Local boundary probe'}},{executeJob:async()=>({...good,...(include?{skills}: {})})});
 await check('old response without skills remains compatible',async()=>assert.equal((await run(undefined,false)).skills,undefined));
 await check('all four statuses and zero step count accepted',async()=>{for(const status of ['succeeded','blocked','failed','skipped'])assert.equal((await run([{...skill,status}])).skills[0].status,status)});
 await check('40 outcomes accepted; 41 rejected',async()=>{assert.equal((await run(Array.from({length:40},()=>skill))).skills.length,40);await assert.rejects(run(Array.from({length:41},()=>skill)),/browse response is invalid/)});
 await check('bounded fields reject name/version/summary overflow',async()=>{for(const [key,length] of [['name',101],['version',41],['summary',501]])await assert.rejects(run([{...skill,[key]:'x'.repeat(length)}]),/browse response is invalid/)});
 await check('bad status/type/negative/fractional steps rejected',async()=>{for(const patch of [{status:'pending'},{steps:-1},{steps:1.5},{steps:'1'},{name:4},{summary:null}])await assert.rejects(run([{...skill,...patch}]),/browse response is invalid/);await assert.rejects(run({}),/browse response is invalid/)});
 const source=readFileSync('convex/actions/websiteTech.ts','utf8');
 const file=ts.createSourceFile('websiteTech.ts',source,ts.ScriptTarget.Latest,true);
 const node=file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='skillOutcomes');assert(node);
 const code=ts.transpileModule(node.getText(file),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const {isResearchEmailAddress}=await s.ssrLoadModule('/convex/lib/websiteTech.ts');
 const context=vm.createContext({URL,isResearchEmailAddress});
 vm.runInContext(code,context);
 const password=randomBytes(24).toString('base64url');
 const inboxUrl='https://local.invalid/research-inbox?token='+randomBytes(24).toString('base64url');
 const verification='https://verify.example/confirm?token='+randomBytes(24).toString('base64url');
 const parsed=await run([{...skill,summary:`Open ${inboxUrl} then ${verification} with synthetic@research.spot.insure and other@example.com password ${password}`,extra:'DROP_ME',nested:{secret:'DROP_ME'}}]);
 const projected=context.skillOutcomes(parsed.skills,{password,inboxUrl});
 await check('actual skillOutcomes source drops extra keys',async()=>assert.deepEqual(Object.keys(projected[0]).sort(),['name','status','steps','summary','version']));
 await check('summary redacts inbox capability, verification URL, test email, other email and password',async()=>{const text=projected[0].summary;for(const raw of [inboxUrl,verification,password,'synthetic@research.spot.insure','other@example.com'])assert(!text.includes(raw));for(const expected of ['the test inbox','verify.example','the test email address','[email]','[password]'])assert(text.includes(expected));assert(!text.includes('token='))});
 await check('projection caps 40 rows and preserves absent skills',async()=>{assert.equal(context.skillOutcomes(undefined,undefined),undefined);assert.equal(context.skillOutcomes(Array.from({length:41},()=>skill),undefined).length,40)});
 writeFileSync('.context/qa/skill-outcomes-sol/projected-fixture.json',JSON.stringify(projected));
} finally {await s.close();writeFileSync('.context/qa/skill-outcomes-sol/boundary-results.json',JSON.stringify({candidate:testedCandidate,scope:'Actual imported clRouterBrowse with synthetic executeJob. skillOutcomes is actual source extracted/transpiled; no full action runtime claim.',checks},null,2))}
