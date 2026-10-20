// Preserved workflow replay; run from repository root. Runtime/private output stays in .context.
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {anyApi} from 'convex/server';
import assert from 'node:assert/strict';
import {operator,org} from './fixtures.mjs';
import {guard,data,mutate} from './fast-local.mjs';
const original=JSON.parse(readFileSync('.context/qa/skill-outcomes-sol/fixture-original-private.json','utf8'));
await guard();await operator.mutation(anyApi.operator.updateClientSettings,{clientOrgId:org._id,website:original.website??''});
let settled=false;
for(let i=0;i<90;i++){
 const organization=(await data('organizations')).find(o=>o._id===org._id);
 const profiles=await data('websiteTechProfiles');
 if(!['pending','running'].includes(organization.companyResearch?.status)&&!profiles.some(p=>['pending','running'].includes(p.status))){settled=true;break;}
 await new Promise(r=>setTimeout(r,500));
}
assert(settled,'Wait for local research to settle before restoring shared credentials');
const jobs=await data('routerJobs');let cancelled=0;
for(const job of jobs.filter(j=>!['succeeded','failed','cancelled'].includes(j.status))){assert(!job.routerJobId,'No shared router job may exist in this local-only run');await mutate('routerJobs:cancel',{id:job._id});cancelled++}
assert.equal((await data('organizations')).find(o=>o._id===org._id).website,original.website);
writeFileSync('.context/qa/skill-outcomes-sol/cleanup-results.json',JSON.stringify({fixtureWebsiteRestored:true,researchSettled:true,localPreparedJobsCancelled:cancelled,sharedRouterJobIdsCreated:0},null,2));
unlinkSync('.context/qa/skill-outcomes-sol/fixture-original-private.json');console.log('RESTORED original synthetic fixture website; research settled; '+cancelled+' local prepared jobs cancelled; zero shared router job IDs');
