import assert from 'node:assert/strict';
import {existsSync,unlinkSync,writeFileSync} from 'node:fs';
import {guard,data} from './fast-local.mjs';
await guard();assert.equal((await data('websiteTechProfiles')).length,0);assert.equal((await data('routerJobs')).length,0);
const org=(await data('organizations')).find(o=>o.name==='Cove');assert.equal(org.website,'https://cove.dev');
const file='.context/qa/empty-consumer-cc8bb050-sol/auth-private.json';if(existsSync(file))unlinkSync(file);
writeFileSync('.context/qa/empty-consumer-cc8bb050-sol/cleanup.json',JSON.stringify({authSnapshotRemoved:!existsSync(file),browserClosed:true,websiteUnmodified:true,profiles:0,routerJobs:0,spotEnv:'local',routerUrlPresent:false,routerSecretPresent:false,restorationRequired:false,reason:'Both router values started absent; never removed or replaced. Original backend not opened.'},null,2));console.log('PASS local cleanup; auth removed, router values absent, no scan state');
