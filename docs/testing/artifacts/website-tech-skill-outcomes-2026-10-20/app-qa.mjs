// Preserved workflow replay; run from repository root. Runtime/private output stays in .context.
import {execFileSync} from 'node:child_process';
const testedCandidate=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {writeFileSync} from 'node:fs';
import {stage,browse,skills,names,org,invoke} from './fixtures.mjs';
const out='.context/qa/skill-outcomes-sol';
const runId=crypto.randomUUID();
const profile={status:'completed',browse};
const checks=[];const record=(name,status='PASS',detail)=>{checks.push({name,status,detail});console.log(status+' '+name)};
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:false,args:['--no-sandbox'],env:{...process.env,DISPLAY:':99'}});
const c=await b.newContext({storageState:out+'/auth-private.json',viewport:{width:1440,height:1000}});const p=await c.newPage();
const render=async(pr,scanning=false)=>{if(scanning)return;await stage({legacy:!pr.browse,browse:pr.browse,error:pr.status==='failed'?'Synthetic failure':undefined});await p.waitForTimeout(150)};
const card=()=>p.locator('[data-inline-field-card]').filter({has:p.getByRole('heading',{name:'Browser research',exact:true})});
try{
 await p.goto(`http://localhost:8080/operator/clients/${org._id}/wiki`);await p.getByRole('tab',{name:'Tech stack',exact:true}).click();
 await render(profile);await card().waitFor();
 for(const [,label] of names)await card().locator('[data-inline-field-row]').filter({hasText:label}).waitFor();
 record('All 10 exact known labels and unknown constructor/toString fallback render');
 for(const label of ['Completed','Blocked','Failed','Skipped'])assert(await card().getByText(label,{exact:true}).count()>0);
 record('All four statuses have visible badges');
 await card().getByText('No steps recorded',{exact:true}).waitFor();assert.equal(await card().getByText('Did not run',{exact:true}).count(),0);record('Zero observed steps says No steps recorded');
 await p.getByText('No technology found',{exact:true}).waitFor();record('No findings retains Browser research card');
 await p.screenshot({path:out+'/app-known-desktop.png',fullPage:true});
 await render({...profile,status:'failed'});await p.getByText('Could not scan skill-qa.example',{exact:true}).waitFor();await card().getByText('Sign in',{exact:true}).waitFor();record('Failed scan retains procedure outcomes');await p.screenshot({path:out+'/app-failed.png'});
 const {browse:omit,...legacy}=profile;await render(legacy);await card().getByText('No browser visit is recorded for this scan. Rescan to run one.',{exact:true}).waitFor();assert.equal(await card().getByText('Site visit',{exact:true}).count(),0);record('Legacy missing browse has no invented Site visit');await p.screenshot({path:out+'/app-legacy.png'});
 const {skills:omitSkills,...oldBrowse}=browse;await render({...profile,browse:oldBrowse});await card().getByText('No signup, email verification or checkout results were reported for this scan.',{exact:true}).waitFor();await card().getByText('Site visit',{exact:true}).waitFor();record('Browse without skills retains Site visit and distinct no-outcomes message');

 await render({...profile,browse:{...browse,finished:true,steps:1}});await card().getByText('Finished',{exact:true}).waitFor();await card().getByText('1 step',{exact:true}).waitFor();
 await render({...profile,browse:{...browse,steps:2}});await card().getByText('Stopped before finishing',{exact:true}).waitFor();await card().getByText('2 steps',{exact:true}).waitFor();record('Finished and partial Site visit summaries and singular/plural steps');
 const forty=Array.from({length:40},(_,i)=>({...skills[i%skills.length],name:skills[i%skills.length].name+'.'+i}));await render({...profile,browse:{...browse,skills:forty}});assert.equal(await card().locator('[data-inline-field-row]').count(),41);record('40 skill outcomes render plus one Site visit');
 await p.setViewportSize({width:390,height:844});await p.screenshot({path:out+'/app-40-mobile.png',fullPage:true});
 const overflow=await p.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert(overflow.scroll<=overflow.width);record('40-row mobile document has no horizontal overflow');
 await render(profile);await p.screenshot({path:out+'/app-known-mobile.png',fullPage:true});
 await p.evaluate(()=>{localStorage.setItem('theme','dark');document.documentElement.classList.add('dark');document.documentElement.classList.remove('light')});await p.screenshot({path:out+'/app-known-mobile-dark.png',fullPage:true});record('Mobile and dark render inspected in authenticated app');
 const projected=JSON.parse((await import('node:fs')).readFileSync(out+'/projected-fixture.json','utf8'));await stage({browse:{...browse,skills:projected}});await p.waitForTimeout(150);
 const get=await invoke('get_organization',{orgId:org._id},`skill-qa-get-populated:${runId}`);assert.deepEqual(get.outcome.result.websiteTech.browse.skills,projected);record('Registered local get_organization returns stored sanitized browse.skills');
 const research=await invoke('research_client_tech_stack',{orgId:org._id,force:true},`skill-qa-research-populated:${runId}`);assert.equal(research.outcome.result.queued,true);assert.deepEqual(research.outcome.result.current.browse.skills,projected);record('Registered local research_client_tech_stack.current returns saved skills when queuing');
 await stage();await p.waitForTimeout(150);await p.evaluate(()=>{window.scanStates=[];window.scanObserver=new MutationObserver(()=>{const t=document.body.innerText;for(const [key,value] of [['scanning','Scanning…'],['failed','Could not scan skill-qa.example']])if(t.includes(value)&&!window.scanStates.includes(key))window.scanStates.push(key)});window.scanObserver.observe(document.body,{subtree:true,childList:true,characterData:true})});
 await p.getByRole('button',{name:'Rescan',exact:true}).click();await p.getByText('Could not scan skill-qa.example',{exact:true}).waitFor();const states=await p.evaluate(()=>{window.scanObserver.disconnect();return window.scanStates});writeFileSync(out+'/app-rescan-transitions.json',JSON.stringify(states));assert.deepEqual(states,['scanning','failed']);await card().getByText('No steps recorded',{exact:true}).waitFor();record('Actual navbar Rescan transitions Scanning to failed terminal through live subscription without reload');await p.screenshot({path:out+'/app-rescan-terminal.png'});
 const long={...skills[0],name:'x'.repeat(100),summary:'y'.repeat(500)};await render({...profile,browse:{...browse,skills:[long]}});
 const geometry=await card().locator('[data-inline-field-row]').nth(1).evaluate(row=>{const bounds=row.closest('[data-inline-field-card]').getBoundingClientRect();return [...row.querySelectorAll('div,span')].filter(el=>el.children.length===0&&el.textContent.length>50).map(el=>{const range=document.createRange();range.selectNodeContents(el);const rect=range.getBoundingClientRect();return {characters:el.textContent.length,textRight:rect.right,cardRight:bounds.right,clipped:rect.right>bounds.right}})});
 writeFileSync(out+'/overflow-geometry.json',JSON.stringify(geometry,null,2));await p.screenshot({path:out+'/app-long-mobile.png'});
 if(geometry.some(x=>x.clipped))record('Maximum-length unbroken unknown name/summary remain readable','FAIL','Text extends beyond overflow-hidden card and is clipped; see geometry and screenshot');else record('Maximum-length unknown name/summary remain readable');
}finally{writeFileSync(out+'/app-results.json',JSON.stringify({candidate:testedCandidate,scope:'Actual authenticated Next/Convex Profile Tech stack. Local fixtures use authorized rescan + existing claim/finish mutations with shared router credentials removed.',checks},null,2));await b.close()}
