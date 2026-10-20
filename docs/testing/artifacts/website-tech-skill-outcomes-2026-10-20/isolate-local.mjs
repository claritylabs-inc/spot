// Preserved workflow replay; run from repository root. Runtime/private output stays in .context.
import {writeFileSync,readFileSync,existsSync,unlinkSync} from 'node:fs';
import assert from 'node:assert/strict';
import {cli,mutateEnv,assertLocal} from './local-backend.mjs';
const file='.context/qa/skill-outcomes-sol/router-restoration-private.env';
assertLocal();
if(process.argv.includes('--restore')){
 assert(existsSync(file));const expected=Object.fromEntries(readFileSync(file,'utf8').trim().split('\n').map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)]}));mutateEnv('set','--from-file',file,'--force');
 for(const name of ['CL_ROUTER_URL','CL_ROUTER_SECRET'])assert(cli('env','get',name)===expected[name],'Private restoration mismatch; values omitted');
 unlinkSync(file);console.log('RESTORED native-local CL_ROUTER_URL and CL_ROUTER_SECRET: both present (values omitted)');
}else{
 assert(!existsSync(file),'Do not overwrite saved restoration values');
 const contents=['CL_ROUTER_URL','CL_ROUTER_SECRET'].map(name=>{const value=cli('env','get',name);assert(value&&!/[\r\n]/.test(value));return `${name}=${value}`}).join('\n')+'\n';
 writeFileSync(file,contents,{mode:0o600});
 for(const name of ['CL_ROUTER_URL','CL_ROUTER_SECRET'])mutateEnv('remove',name);
 console.log('ISOLATED verified native-local 8083/8084 only; shared router URL/secret removed, restoration file mode 0600');
}
