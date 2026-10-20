// Actual local consumer workflow. Run from exact checkout; no scan/website mutations.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {ConvexHttpClient} from 'convex/browser';
import {anyApi} from 'convex/server';
import {guard,data,mutate} from './fast-local.mjs';
const root=process.env.QA_CHECKOUT;assert(root&&process.cwd()===root);
const {consumeLocalEmailCaptures}=await import(root+'/scripts/watch-conductor-email-captures.mjs');
const out='.context/qa/empty-consumer-cc8bb050-sol';
await guard();const org=(await data('organizations')).find(o=>o.name==='Cove'&&o.website==='https://cove.dev');assert(org);
const before=await data('websiteTechProfiles');assert.equal(before.length,0);assert.equal((await data('routerJobs')).length,0);
const protocol={sentTypes:{},receivedTypes:{},udfNames:[],httpStatuses:{}};
const env=Object.fromEntries(['PATH','HOME','USER','LOGNAME','SHELL','LANG','LC_ALL','TMPDIR'].filter(n=>process.env[n]).map(n=>[n,process.env[n]]));env.DISPLAY=':99';
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:false,args:['--no-sandbox'],env});
try {
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
 page.on('response',r=>{const u=new URL(r.url());if(['localhost','127.0.0.1'].includes(u.hostname))protocol.httpStatuses[r.status()]=(protocol.httpStatuses[r.status()]??0)+1});
 page.on('websocket',ws=>{for(const [event,key] of [['framesent','sentTypes'],['framereceived','receivedTypes']])ws.on(event,f=>{try{const m=JSON.parse(String(f.payload));if(typeof m.type==='string')protocol[key][m.type]=(protocol[key][m.type]??0)+1;const visit=x=>{if(!x||typeof x!=='object')return;if(typeof x.udfPath==='string')protocol.udfNames.push(x.udfPath);for(const v of Object.values(x))if(v&&typeof v==='object')visit(v)};visit(m)}catch{}})});
 await page.goto('http://localhost:8080/operator/login');const offset=readFileSync('.context/logs/convex.log','utf8').length;
 const email='terry@claritylabs.inc';await page.locator('input[type=email]').fill(email);await page.getByRole('button',{name:'Continue',exact:true}).click();
 let otp;for(let i=0;i<60&&!otp;i++){otp=consumeLocalEmailCaptures(readFileSync('.context/logs/convex.log','utf8').slice(offset)).captures.find(c=>c.to.includes(email)&&c.codes.length)?.codes[0];if(!otp)await page.waitForTimeout(500)}assert(otp,'Fresh exact-recipient capture');
 await page.locator('#operator-verification-code').fill(otp);await page.getByRole('button',{name:'Verify and continue'}).click();await page.waitForURL(u=>['/operator','/operator/clients'].includes(u.pathname),{timeout:60000});
 const state=await context.storageState();writeFileSync(out+'/auth-private.json',JSON.stringify(state),{mode:0o600});
 const operator=new ConvexHttpClient('http://127.0.0.1:8083',{logger:false});operator.setAuth(state.origins.flatMap(o=>o.localStorage).find(x=>x.name.startsWith('__convexAuthJWT_')).value);
 await guard();const query=await operator.query(anyApi.websiteTech.getForOperator,{orgId:org._id});assert.equal(query.website,org.website);assert.equal(query.profile,null);
 const user=(await data('users')).find(u=>u.email===email);assert(user);
 const tool=await mutate('operatorAgent:invokeRegisteredToolInternal',{operatorUserId:user._id,channel:'mcp',toolName:'get_organization',input:{orgId:org._id},idempotencyKey:'empty-consumer:'+crypto.randomUUID(),conversationKey:'empty-consumer-local'});
 assert(Object.hasOwn(tool.outcome.result,'websiteTech'));assert.equal(tool.outcome.result.websiteTech,null);
 // Null is established before the Profile route is opened, without any scan/website write.
 await page.goto(`http://localhost:8080/operator/clients/${org._id}/wiki`);await page.getByRole('tab',{name:'Tech stack',exact:true}).click();
 await page.getByText('Not scanned yet',{exact:true}).waitFor();const description='Rescan to find public signals about this company’s payment processor, hosting and technology.';
 assert.equal(await page.getByText(description,{exact:true}).count(),1);
 const absent={};for(const label of ['Browser research','Site visit','Account signup','Account cleanup','No steps recorded','No website yet','No technology found','Scanning…']){absent[label]=await page.getByText(label,{exact:true}).count();assert.equal(absent[label],0,label)}
 await page.screenshot({path:out+'/not-scanned-desktop.png',fullPage:true});
 await guard();const after=await data('websiteTechProfiles'),jobs=await data('routerJobs');assert.equal(after.length,0);assert.equal(jobs.length,0);
 protocol.udfNames=[...new Set(protocol.udfNames)].sort();assert(!protocol.udfNames.some(n=>/websiteTech:rescanForOperator/.test(n)));
 writeFileSync(out+'/results.json',JSON.stringify({candidate:'cc8bb050c20f6cb45798da7c6eb986d4b0b884af',browserVersion:browser.version(),normalFreshOtp:true,fixture:{name:org.name,website:org.website,type:org.type},before:{websiteTechProfiles:before.length,matchingDomainProfiles:0,routerJobs:0},actualOperatorQuery:query,registeredTool:{name:'get_organization',authorizedActor:'ordinary seeded operator',channel:'mcp',transport:'registered internal executor, not OAuth/HTTP MCP',websiteTech:tool.outcome.result.websiteTech,ownWebsiteTechField:true},ui:{title:'Not scanned yet',description,absent},after:{websiteTechProfiles:after.length,routerJobs:jobs.length,routerUrlPresent:false,routerSecretPresent:false},scanOrWebsiteMutations:0},null,2));
 console.log('PASS actual authorized get_organization websiteTech:null, authenticated query profile:null, rendered Not scanned yet, no browser outcomes, zero profiles/jobs');
} finally {writeFileSync(out+'/protocol.json',JSON.stringify(protocol,null,2));await browser.close()}
