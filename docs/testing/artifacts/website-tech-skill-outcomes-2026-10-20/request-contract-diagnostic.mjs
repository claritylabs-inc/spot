// Preserved workflow replay; run from repository root. Runtime/private output stays in .context.
import {execFileSync} from 'node:child_process';
const testedCandidate=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
import {readFileSync,writeFileSync} from 'node:fs';
import {createServer} from 'vite';
import Ajv2020 from 'ajv/dist/2020.js';
const openapi=JSON.parse(readFileSync('contracts/cl-router/openapi.v1.json','utf8'));
const rewrite=x=>Array.isArray(x)?x.map(rewrite):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,k==='$ref'&&typeof v==='string'?v.replace('#/components/schemas/','#/$defs/'):rewrite(v)])):x;
const validate=new Ajv2020({strict:false,allErrors:true,validateFormats:false}).compile({$defs:rewrite(openapi.components.schemas),$ref:'#/$defs/BrowseRequest'});
const server=await createServer({server:{middlewareMode:true},appType:'custom',configFile:false});
try{const {clRouterBrowse}=await server.ssrLoadModule('/convex/lib/clRouterClient.ts');let request;await clRouterBrowse({input:{url:'https://skill-qa.example',goal:'Synthetic consumer request',allowedDomains:['skill-qa.example'],maxSteps:30},executionBudgetMs:360000},{executeJob:async(operation,body)=>{request=body;return {provider:'browserbase',model:'fixture',finished:false,steps:0,text:'',pages:[],networkHosts:[]}}});const valid=validate(request);const result={candidate:testedCandidate,scope:'Actual imported consumer serializer, synthetic executeJob; checked-in schema. No router network call.',valid,requestKeys:Object.keys(request),errors:validate.errors};writeFileSync('.context/qa/skill-outcomes-sol/request-contract-diagnostic.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));}finally{await server.close()}
