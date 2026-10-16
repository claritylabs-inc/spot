// Native-local browser workflow: node scripts/password-login-e2e.mjs
// Requires conductor:dev on 8080/8083 and the Cove fixture. Never targets production.
// Repeatable artifacts: .context/qa/password-login/results.json and PNGs.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
const app='http://localhost:8080';
const out='.context/qa/password-login';mkdirSync(out,{recursive:true});
const email='adyan@cove.dev';
const password=randomBytes(32).toString('base64url');
const replacement=randomBytes(32).toString('base64url');
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1280,height:900}});
const p=await context.newPage();const results=[];
const pass=s=>{results.push(s);console.log('PASS',s)};
async function login(page,secret){
 await page.goto(app+'/login');
 await page.getByRole('button',{name:'Use a password instead'}).click();
 await page.getByLabel('Work email',{exact:true}).fill(email);
 await page.getByLabel('Password',{exact:true}).fill(secret);
 await page.getByRole('button',{name:'Continue',exact:true}).click();
}
try{
 await p.goto(app+'/login');
 assert.equal(await p.locator('input[type=password]').count(),0);
 await p.getByRole('button',{name:'Use a password instead'}).click();
 await p.getByRole('button',{name:'Use an email code instead'}).click();
 assert.equal(await p.locator('input[type=password]').count(),0);
 pass('Email code remains default; switching modes does not send credentials');
 const offset=readFileSync('.context/logs/web.log','utf8').length;
 await p.getByLabel('Work email',{exact:true}).fill(email);
 await p.getByRole('button',{name:'Continue',exact:true}).click();
 let code;
 for(let i=0;i<40&&!code;i++){code=[...readFileSync('.context/logs/web.log','utf8').slice(offset).matchAll(/codeCandidates:\s*(\d{6})/g)].at(-1)?.[1];if(!code)await p.waitForTimeout(1000)}
 assert(code,'Fresh OTP from local email capture');
 await p.locator('input[autocomplete=one-time-code]').first().fill(code);
 await p.getByRole('button',{name:'Confirm and continue'}).click();
 await p.waitForURL(url=>!url.pathname.startsWith('/login'));
 pass('Existing email-code sign-in succeeds');
 await p.goto(app+'/profile');
 const start=p.getByRole('button',{name:/^(Set|Change) password$/});await start.waitFor();
 await p.screenshot({path:out+'/01-settings.png'});
 await start.click();await p.getByLabel('New password',{exact:true}).fill(password);
 await p.getByRole('button',{name:'Save password',exact:true}).click();
 await p.getByRole('status').filter({hasText:'Password saved'}).waitFor();
 pass('Verified signed-in user opts into password from profile settings');
 const second=await browser.newContext();const q=await second.newPage();
 await login(q,'incorrect-password-value');await q.getByRole('alert').waitFor();
 assert.equal(new URL(q.url()).pathname,'/login');pass('Wrong password cannot sign in');
 await q.getByLabel('Password',{exact:true}).fill(password);await q.getByRole('button',{name:'Continue',exact:true}).click();
 await q.waitForURL(url=>!url.pathname.startsWith('/login'));pass('New password signs into the same existing account');
 await p.getByRole('button',{name:'Change password',exact:true}).click();
 await p.getByLabel('New password',{exact:true}).fill(replacement);
 await p.getByRole('button',{name:'Save password',exact:true}).click();
 await p.getByRole('status').filter({hasText:'Password saved'}).waitFor();
 await q.goto(app+'/profile');await q.waitForURL(url=>url.pathname.startsWith('/login'));
 pass('Password change revokes the other browser session');
 await login(q,password);await q.getByRole('alert').waitFor();pass('Old password rejected after change');
 await q.getByLabel('Password',{exact:true}).fill(replacement);await q.getByRole('button',{name:'Continue',exact:true}).click();
 await q.waitForURL(url=>!url.pathname.startsWith('/login'));pass('Replacement password succeeds');
 await p.screenshot({path:out+'/02-password-saved.png'});
 const signedOut=await browser.newContext({viewport:{width:390,height:844}});const r=await signedOut.newPage();await r.goto(app+'/login');await r.getByRole('button',{name:'Use a password instead'}).click();await r.screenshot({path:out+'/03-mobile-login.png'});
 await r.goto(app+'/login/review');assert.equal(await r.getByText('Reviewer sign-in',{exact:true}).count(),0);pass('Dedicated reviewer login removed');
 await second.close();await signedOut.close();
}finally{writeFileSync(out+'/results.json',JSON.stringify({results},null,2));await browser.close()}
