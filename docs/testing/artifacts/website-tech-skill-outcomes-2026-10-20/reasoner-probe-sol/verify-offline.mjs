// Artifact verification only: never imports a provider, reads credentials or sends HTTP.
import assert from 'node:assert/strict';
import {readFileSync,statSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=dirname(fileURLToPath(import.meta.url)),hash=b=>createHash('sha256').update(b).digest('hex'),read=name=>JSON.parse(readFileSync(join(dir,name)));
const declaration=read('predeclaration.json'),ledger=read('publication-ledger.json'),request=read('request-sanitized.json'),result=read('result.json');
assert.equal(hash(readFileSync(join(dir,'controller.mjs'))),declaration.controllerSha256);
assert.equal(result.controllerSha256,declaration.controllerSha256);
for(const change of ledger.changes){const entry=change.replacement,bytes=readFileSync(join(dir,entry.file));assert.equal(hash(bytes),entry.sha256);const path=change.jsonPointer.split('/').slice(1);let parent=request;for(const key of path.slice(0,-1))parent=parent[key];const value='data:image/png;base64,'+bytes.toString('base64');assert.equal(value.length,change.originalUtf16Length);assert.equal(hash(value),change.originalValueSha256);parent[path.at(-1)]=value}
const body=JSON.stringify(request);assert.equal(hash(body),declaration.requestBodySha256);assert.equal(result.requestBodySha256,declaration.requestBodySha256);
assert.equal(request.messages[0].content.filter(p=>p.type==='image').length,4);
assert(!('tools' in request));assert(!('maxRetries' in request));assert(!('store' in request));assert(!('reasoningEffort' in request));
assert.deepEqual(request.schema,declaration.schema);assert.deepEqual(request.route,{provider:'openai',model:'gpt-5.6-sol'});assert.equal(request.maxTokens,8192);assert.equal(request.executionBudgetMs,30000);assert.equal(result.clientPostAttempts,1);assert.equal(result.clientRetries,0);
assert.equal(result.httpStatus,200);assert.equal(result.finishReason,'stop');assert(result.responseContractValid&&result.outputSchemaValid&&result.exactRoute);assert.equal(Object.keys(result.outputs).length,6);assert(Object.values(result.outputs).every(value=>value==='yes'));assert.equal(result.verdict,'PASS');
assert(new Date(declaration.recordedAt)<new Date(result.startedAt));
if(process.argv[2]){const privateDir=process.argv[2];assert.equal(statSync(privateDir).mode&0o777,0o700);const raw=join(privateDir,'request-body.json');assert.equal(statSync(raw).mode&0o777,0o600);assert.equal(readFileSync(raw,'utf8'),body);assert(existsSync(join(privateDir,'post-attempted.lock')))}
console.log('PASS offline hashes, exact request reconstruction, schema/roles, frozen time order and single client receipt. No provider/native proof inferred.');
