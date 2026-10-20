import {execFileSync as verifyCandidate} from 'node:child_process';
if(verifyCandidate('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!=="cc8bb050c20f6cb45798da7c6eb986d4b0b884af")throw Error('Exact candidate guard failed');
// Preserved workflow replay; run from repository root. Runtime/private output stays in .context.
import {chromium} from 'playwright';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {consumeLocalEmailCaptures}=await import(process.env.QA_CHECKOUT+'/scripts/watch-conductor-email-captures.mjs');
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:false,args:['--no-sandbox','--remote-debugging-port=9222'],env:{...process.env,DISPLAY:':99'}});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();
await page.goto('http://localhost:8080/operator/login');
const offset=readFileSync('.context/logs/convex.log','utf8').length;
const email='terry@claritylabs.inc';
await page.locator('input[type=email]').fill(email);
await page.getByRole('button',{name:'Continue',exact:true}).click();
let otp;
for(let i=0;i<60&&!otp;i++){const c=consumeLocalEmailCaptures(readFileSync('.context/logs/convex.log','utf8').slice(offset)).captures.find(c=>c.to.includes(email)&&c.codes.length);otp=c?.codes[0];if(!otp)await page.waitForTimeout(500)}
assert(otp,'fresh local capture');
await page.locator('#operator-verification-code').fill(otp);
await page.getByRole('button',{name:'Verify and continue'}).click();
await page.waitForURL(url=>url.pathname==='/operator'||url.pathname==='/operator/clients',{timeout:60000});
writeFileSync('.context/qa/final-consumer-cc8bb050-sol/auth-private.json',JSON.stringify(await context.storageState()),{mode:0o600});
console.log('PASS headed cloud Chrome normal operator sign-in with fresh local OTP');
await page.screenshot({path:'.context/qa/final-consumer-cc8bb050-sol/operator-entry.png'});
await browser.close();
