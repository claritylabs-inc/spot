// Native-local Chrome sign-in workflow. Run after the OTP cooldown.
// The welcome website body is stubbed; its real layout has separate website E2E.
// Repeatable artifacts: .context/qa/extension-onboarding/{results.json,*.png}.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
execFileSync(process.execPath,['scripts/build-browser-extension.mjs','--local']);
const out='.context/qa/extension-onboarding';mkdirSync(out,{recursive:true});
const c=await chromium.launchPersistentContext(path.resolve(out,'profile'),{executablePath:'/usr/bin/google-chrome',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--no-sandbox','--enable-unsafe-extension-debugging'],viewport:{width:380,height:760}});
const results=[];
try {
 await c.clearCookies();
 const cd=await c.browser().newBrowserCDPSession();
 const {id}=await cd.send('Extensions.loadUnpacked',{path:path.resolve('extensions/spot/dist')});
 const p=await c.newPage();await p.goto(`chrome-extension://${id}/sidepanel.html`);
 const f=p.frameLocator('#app');await f.getByRole('heading',{name:'Your insurance agent, right here.'}).waitFor();
 assert.equal(await p.locator('.bar').isVisible(),false);
 await p.screenshot({path:path.resolve(out,'signed-out.png')});results.push('Signed-out welcome hides capture and reload toolbar');
 await c.route('https://spot.insure/extension/welcome',route=>route.fulfill({body:'<h1>Spot extension welcome</h1>',contentType:'text/html'}));
 const popup=c.waitForEvent('page');await f.getByRole('link',{name:'Sign in to Spot',exact:true}).click();const login=await popup;
 await login.waitForURL('http://localhost:8080/login?from=extension');
 results.push('Sign-in opens normal app tab with bounded extension marker');
 const offset=readFileSync('.context/logs/web.log','utf8').length;
 await login.locator('input[type=email]').fill('adyan@cove.dev');await login.getByRole('button',{name:'Continue',exact:true}).click();
 let otp;
 for(let i=0;i<30&&!otp;i++){otp=[...readFileSync('.context/logs/web.log','utf8').slice(offset).matchAll(/codeCandidates:\s*(\d{6})/g)].at(-1)?.[1];if(!otp)await login.waitForTimeout(1000)}
 assert(otp,'Fresh local OTP required');await login.locator('input[autocomplete=one-time-code]').first().fill(otp);await login.getByRole('button',{name:'Confirm and continue'}).click();
 await login.waitForURL('https://spot.insure/extension/welcome');results.push('Successful OTP redirects to fixed help URL (website body stubbed locally)');
 await p.waitForFunction(()=>!document.querySelector('#capture').disabled,{},{timeout:45000});
 results.push('Sidebar reconnects after external sign-in without Reload');
 await p.screenshot({path:path.resolve(out,'reconnected.png')});
} finally {writeFileSync(path.resolve(out,'results.json'),JSON.stringify(results,null,2));await c.close()}
console.log(results);
