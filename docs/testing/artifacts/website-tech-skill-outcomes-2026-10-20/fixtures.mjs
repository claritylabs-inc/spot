// Preserved workflow replay; run from repository root. Runtime/private output stays in .context.
import {ConvexHttpClient} from 'convex/browser';
import {anyApi} from 'convex/server';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {guard,data,mutate,admin} from './fast-local.mjs';
export const operator=new ConvexHttpClient('http://127.0.0.1:8083',{logger:false});
operator.setAuth(JSON.parse(readFileSync('.context/qa/skill-outcomes-sol/auth-private.json','utf8')).origins.flatMap(o=>o.localStorage).find(x=>x.name.startsWith('__convexAuthJWT_')).value);
export const org=(await data('organizations')).find(o=>o.name==='Cove');
export const operatorUser=(await data('users')).find(u=>u.email==='terry@claritylabs.inc');
export const names=[['account.signup','Account signup'],['account.sign_in','Sign in'],['account.verify_email','Email verification'],['account.enter_otp','Verification code'],['account.cleanup','Account cleanup'],['inbox.wait_for_email','Verification email'],['challenge.captcha','CAPTCHA'],['site.find_pages','Site pages'],['page.dismiss_overlays','Page overlays'],['checkout.observe_payment','Payment page'],['custom.new_workflow','Custom new workflow'],['constructor','Constructor'],['toString','ToString']];
export const skills=names.map(([name],i)=>({name,version:'qa-v1',status:['succeeded','blocked','failed','skipped'][i%4],summary:`Observed synthetic ${name} procedure. Outcome is not vendor evidence.`,steps:i%3}));
export const browse={finished:false,steps:0,signupSubmitted:false,adoptedDomains:[],redirects:[],actions:[],skills};
export async function stage({browse:summary=browse,legacy=false,error,signals=[]}={}){
 for(let attempt=0;attempt<5;attempt++){
  await guard();await operator.mutation(anyApi.websiteTech.rescanForOperator,{orgId:org._id});
  let row=(await data('websiteTechProfiles')).find(p=>p.domain==='skill-qa.example');
  if(row.status==='pending')await mutate('websiteTech:claim',{domain:row.domain,runId:row.runId});
  if(!['pending','running'].includes(row.status))continue;
  await mutate('websiteTech:finish',{domain:row.domain,runId:row.runId,signals,disclosures:[],inferences:[],...(!legacy?{browse:summary}:{}),...(error?{error}:{})});
  const result=await operator.query(anyApi.websiteTech.getForOperator,{orgId:org._id});
  if(legacy?!result.profile.browse:JSON.stringify(result.profile.browse)===JSON.stringify(summary))return result.profile;
  // Stored object key order may differ, so compare structurally before retrying.
  if(!legacy&&result.profile.browse){try{assert.deepEqual(result.profile.browse,summary);return result.profile}catch{}}
 }
 throw new Error('Fixture finish lost scheduler race after 5 attempts');
}
export async function invoke(toolName,input,key){await guard();return admin.function('operatorAgent:invokeRegisteredToolInternal',undefined,{operatorUserId:operatorUser._id,channel:'mcp',toolName,input,idempotencyKey:key,conversationKey:'skill-qa-consumer'});}
