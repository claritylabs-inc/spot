// Offline receipt/hash review; no provider, browser, or candidate execution.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('.',import.meta.url)),bytes=name=>readFileSync(join(root,name)),json=name=>JSON.parse(bytes(name)),hash=value=>createHash('sha256').update(value).digest('hex');
for(const item of json('manifest.json').files){assert.equal(hash(bytes(item.file)),item.sha256);assert.equal(bytes(item.file).length,item.bytes);}
const plan=json('predeclaration.json'),results=json('results.json'),requests=json('logical-wire-requests-sanitized.json').requests,trace=json('protocol-model-trace.json'),old=json('../comparison-af229cc-sol/logical-wire-requests-sanitized.json').requests;
assert.equal(hash(bytes('evaluate-frozen.mjs')),plan.controllerSha256);
assert.equal(requests.length,8);assert.equal(results.httpAttempts,8);assert.equal(results.sourceClosureInvocations,0);assert.equal(results.nativeCalls,0);
assert.deepEqual(requests.map(item=>item.id),plan.caseOrder);
for(const item of requests){
  const previous=old.find(request=>request.id===item.id),record=results.results.find(result=>result.id===item.id),planned=plan.cases.find(plan=>plan.id===item.id);
  assert.deepEqual(item.logical,previous.logical);assert.deepEqual(item.canonicalWire,{...previous.canonicalWire,model:'jev-1.14.0'});
  assert.equal(record.logicalRequestSha256,planned.originalLogicalSha256);assert.equal(record.httpAttempts,1);assert.equal(record.httpStatus,200);assert.equal(record.response.model,'jev-1.14.0');assert.equal(record.wireOnlyModelChanged,true);
  assert.deepEqual(item.response,record.response);assert.equal(Object.keys(item.response.answers).length,6);
  for(const id of plan.questionIds){const answer=item.response.answers[id];assert.equal(answer.type,'noul');assert(Number.isFinite(answer.noul)&&answer.noul>=0&&answer.noul<=1);}
  const approve=plan.questionIds.every(id=>item.response.answers[id].noul>=.9);
  assert.equal(record.computedApproval,approve);assert.equal(record.criterionPass,approve===planned.expectedApproval);
  for(const image of item.images){assert.equal(hash(bytes(image.file)),image.sha256);assert(bytes(image.file).equals(bytes('../comparison-af229cc-sol/'+image.file)));}
  const before=trace.find(event=>event.kind==='logical_request_before_inference'&&event.id===item.id),send=trace.find(event=>event.kind==='http_send'&&event.id===item.id);assert(before.seq<send.seq);
}
assert.equal(trace.filter(event=>event.kind==='http_send').length,8);assert.equal(trace.filter(event=>event.kind==='http_response').length,8);
assert.equal(results.screenVerdict,results.results.every(item=>item.criterionPass)?'PASS_FROZEN_REGRESSION_DIAGNOSTIC_ONLY':'FAIL_SCREEN');
console.log(JSON.stringify({manifest:'PASS',frozenLogicalAndImages:'PASS',wireModelOnlyChange:'PASS',requestCountsAndAnswerConjunction:'PASS',httpAttempts:8,screenVerdict:results.screenVerdict,nativeCalls:0}));
