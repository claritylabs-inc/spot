import {execFileSync as verifyCandidate} from 'node:child_process';
if(verifyCandidate('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!=="cc8bb050c20f6cb45798da7c6eb986d4b0b884af")throw Error('Exact candidate guard failed');
// Set the existing synthetic fixture through the authorized writer; never change product code.
import {existsSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {anyApi} from 'convex/server';
import {operator,org} from './fixtures.mjs';
import {guard} from './fast-local.mjs';
const file='.context/qa/final-consumer-cc8bb050-sol/fixture-original-private.json';
assert(!existsSync(file),'Finish or restore the preceding fixture run first');
assert.equal(org.name,'Cove');
assert.equal(org.type,'client');
await guard();
writeFileSync(file,JSON.stringify({orgId:org._id,website:org.website}),{mode:0o600});
await operator.mutation(anyApi.operator.updateClientSettings,{clientOrgId:org._id,website:'https://skill-qa.example'});
console.log('Synthetic fixture prepared through authorized local writer; original saved privately');
