import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const {executeDecision}=await import(pathToFileURL(process.env.QA_ROUTER_CHECKOUT+'/packages/server/dist/providers/decisions.js'));
const root=process.env.QA_PRIVATE_OUTPUT?.replace(/\/?$/, '/');
if(!root)throw Error('QA_PRIVATE_OUTPUT required');
const entries=JSON.parse(readFileSync(root+'trace.json','utf8'));
const prior=entries.find(e=>e.kind==='real_jev' && e.questionIds.includes('hover_only'));
if(!prior)throw Error('No actual comparison captured');
const refs=prior.images.map(()=>crypto.randomUUID());
const assets=Object.fromEntries(prior.images.map((image,i)=>[refs[i],{format:'png',dataBase64:readFileSync(root+image.file).toString('base64')}]));
const request={tenantId:'spot-authorized-live-qa',state:{before:refs[0],after:refs[1],target:prior.target},assets,questions:prior.questions};
const diagnostic={candidate:'96d1db5a32882bab6c807ac8d1f3fb27a8d39b4d',priorTraceSeq:prior.seq,operation:'one read-only candidate executeDecision retry of captured comparison',imageBytesUnchanged:prior.images.every((image,i)=>createHash('sha256').update(Buffer.from(assets[refs[i]].dataBase64,'base64')).digest('hex')===image.sha256),questionsUnchanged:JSON.stringify(request.questions)===JSON.stringify(prior.questions),images:prior.images,questions:prior.questions};
const clean=(value)=>String(value).replace(/Bearer\s+\S+/gi,'[redacted]').replace(/[A-Za-z0-9_+\/-]{80,}={0,2}/g,'[long data omitted]').replace(/https?:\/\/[^\s"<>]+/g,'[url omitted]').slice(0,500);
const errorFields=(body)=>{
 const pick=(x)=>{if(typeof x==='string')return clean(x);if(Array.isArray(x))return x.slice(0,8).map(pick);if(x && typeof x==='object')return Object.fromEntries(Object.entries(x).filter(([k])=>['error_type','type','code','message','msg','loc','detail','error'].includes(k)).map(([k,v])=>[k,pick(v)]));return typeof x==='number'?x:null;};
 return pick(body);
};
try{
 const answer=await executeDecision(request,{timeoutMs:20_000,fetch:async(url,init)=>{
  const r=await fetch(url,init);diagnostic.httpStatus=r.status;
  if(!r.ok){const body=await r.clone().json().catch(()=>null);diagnostic.providerValidation=errorFields(body);}
  return r;
 }});diagnostic.model=answer.model;diagnostic.answers=answer.answers;
}catch(error){diagnostic.failure={code:error.code,message:error.message,decisionDiagnostics:error.decisionDiagnostics};}
writeFileSync(root+'hover-diagnostic.json',JSON.stringify(diagnostic,null,2),{mode:0o600});
console.log(JSON.stringify(diagnostic));
