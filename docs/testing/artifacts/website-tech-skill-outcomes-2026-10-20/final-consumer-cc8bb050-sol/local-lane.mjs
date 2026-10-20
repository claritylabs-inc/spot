// Local-only process/bootstrap controller. Never selects a hosted deployment.
import {readFileSync,writeFileSync,unlinkSync,openSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn,spawnSync,execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(process.argv[2]),mode=process.argv[3],candidate='cc8bb050c20f6cb45798da7c6eb986d4b0b884af';
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),candidate);
const config=JSON.parse(readFileSync(join(root,'.convex/local/default/config.json')));assert.deepEqual(config.ports,{cloud:8083,site:8084});
const text=readFileSync(join(root,'.env.local'),'utf8');assert(/^CONVEX_DEPLOYMENT=(anonymous|local):/m.test(text));assert(text.includes('NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:8083'));assert(text.includes('NEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:8084'));
const env=Object.fromEntries(['PATH','HOME','USER','LOGNAME','SHELL','LANG','LC_ALL','TMPDIR','DISPLAY'].filter(name=>process.env[name]).map(name=>[name,process.env[name]]));env.CONVEX_AGENT_MODE='anonymous';
const cli=(...args)=>{const result=spawnSync(join(root,'node_modules/.bin/convex'),[...args,'--url','http://127.0.0.1:8083','--admin-key',config.adminKey],{cwd:root,env,encoding:'utf8'});assert.equal(result.status,0,'Explicit native-local CLI failed; private diagnostics withheld');return result.stdout.trim();};
const local=()=>assert.equal(cli('env','get','SPOT_ENV'),'local');
if(mode==='bootstrap'){
  // First env write bootstraps a newly empty, explicit loopback backend. Every subsequent write checks SPOT_ENV.
  assert.equal((await fetch('http://127.0.0.1:8083/version')).ok,true);
  const all=cli('env','list');assert(!all.trim(),'Bootstrap requires fresh empty local environment');
  cli('env','set','SPOT_ENV','local');local();
  const {generateLocalAuthKeys}=await import(pathToFileURL(join(root,'scripts/lib/conductor-workspace.mjs')));
  const entries={...generateLocalAuthKeys(),EMAIL_DELIVERY_MODE:'capture',OPERATOR_BOOTSTRAP_EMAILS:'terry@claritylabs.inc',OPERATOR_OWNER_EMAILS:'terry@claritylabs.inc',APP_SITE_URL:'http://localhost:8080',AUTH_LINK_SITE_URL:'http://localhost:8080',CLIENT_PORTAL_URL:'http://localhost:8080',SITE_URL:'http://localhost:8080',IMESSAGE_ENABLED:'false',OPERATOR_IMESSAGE_ENABLED:'false',SLACK_ENABLED:'false',OPERATOR_SLACK_ENABLED:'false',SLACK_MODE:'mock',ALLOW_DEV_CLEAR:'true'};
  const file=join(root,'.context/qa/final-consumer-cc8bb050-sol/bootstrap-private.env');writeFileSync(file,Object.entries(entries).map(([key,value])=>key+'='+value).join('\n')+'\n',{mode:0o600});
  try{local();cli('env','set','--from-file',file,'--force');}finally{unlinkSync(file);}
  local();const {ConvexHttpClient}=await import(pathToFileURL(join(root,'node_modules/convex/dist/esm/browser/index.js')));const client=new ConvexHttpClient('http://127.0.0.1:8083',{logger:false});client.setAdminAuth(config.adminKey);
  for(const name of ['CL_ROUTER_URL','CL_ROUTER_SECRET'])assert.equal(await client.query('_system/cli/queryEnvironmentVariables:get',{name}),null);
  local();cli('run','seed:seed','{}');
  writeFileSync(join(root,'.context/qa/final-consumer-cc8bb050-sol/bootstrap-results.json'),JSON.stringify({candidate,freshNativeLocal:true,ports:config.ports,ambientCredentialsExcluded:true,spotEnv:'local',emailDelivery:'capture',normalSeed:true,routerUrlPresent:false,routerSecretPresent:false,bootstrapPrivateFileRemoved:true},null,2));console.log('PASS fresh native-local bootstrap/seed; router URL and secret both absent');
}else{
  assert(['convex','web'].includes(mode));if(mode==='web')local();
  const executable=join(root,'node_modules/.bin',mode==='convex'?'convex':'next'),args=mode==='convex'?['dev','--local-cloud-port','8083','--local-site-port','8084','--typecheck','disable','--codegen','disable']:['dev','-p','8080'];
  const log=openSync(join(root,'.context/logs/'+mode+'.log'),'a',0o600),child=spawn(executable,args,{cwd:root,env,stdio:['ignore',log,log]});
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>child.kill(signal));
  child.on('exit',code=>process.exit(code??1));
}
