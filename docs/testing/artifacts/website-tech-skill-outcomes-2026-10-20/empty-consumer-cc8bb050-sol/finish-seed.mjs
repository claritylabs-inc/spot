// Recovery after initial bootstrap seed failure. Refuses populated data.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {guard,data,mutate} from './fast-local.mjs';
await guard();assert.equal((await data('organizations')).length,0,'Do not seed populated database');
await mutate('seed:seed',{});
await guard();const orgs=await data('organizations');assert(orgs.some(o=>o.name==='Cove'&&o.website==='https://cove.dev'));
assert.equal((await data('websiteTechProfiles')).length,0);
writeFileSync('.context/qa/empty-consumer-cc8bb050-sol/bootstrap-results.json',JSON.stringify({candidate:'cc8bb050c20f6cb45798da7c6eb986d4b0b884af',freshNativeLocal:true,ports:{cloud:8083,site:8084},ambientCredentialsExcluded:true,spotEnv:'local',emailDelivery:'capture',normalSeed:true,routerUrlPresent:false,routerSecretPresent:false,bootstrapPrivateFileRemoved:true,initialSeedCommandFailed:true,organizationsBeforeRecoverySeed:0,profilesAfterSeed:0},null,2));
console.log('PASS guarded ordinary local seed; zero tech profiles');
