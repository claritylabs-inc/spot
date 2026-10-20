// Set the existing synthetic fixture through the authorized writer; never change product code.
import {existsSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {anyApi} from 'convex/server';
import {operator,org} from './fixtures.mjs';
import {guard} from './fast-local.mjs';
const file='.context/qa/skill-outcomes-sol/fixture-original-private.json';
assert(!existsSync(file),'Finish or restore the preceding fixture run first');
assert.equal(org.name,'Cove');
assert.equal(org.type,'client');
await guard();
writeFileSync(file,JSON.stringify({orgId:org._id,website:org.website}),{mode:0o600});
await operator.mutation(anyApi.operator.updateClientSettings,{clientOrgId:org._id,website:'https://skill-qa.example'});
console.log('Synthetic fixture prepared through authorized local writer; original saved privately');
