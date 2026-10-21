// Offline durable packaging; never exports private auth, environment values, inbox rows or raw logs.
import {readFileSync,writeFileSync,copyFileSync,readdirSync,mkdirSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(process.argv[2]),out=fileURLToPath(new URL('.',import.meta.url)),runtime=join(root,'.context/qa/final-consumer-cc8bb050-sol');
const hash=value=>createHash('sha256').update(value).digest('hex');
mkdirSync(join(out,'results'),{recursive:true});mkdirSync(join(out,'screenshots'),{recursive:true});
const files=['bootstrap-results.json','boundary-results.json','projected-fixture.json','access-results.json','request-results.json','app-results.json','app-results-initial.json','app-results-second-interrupted.json','app-rescan-transitions.json','app-followup-results.json','app-inner-overflow.json','overflow-geometry.json','stage-diagnostic.json','cleanup-results.json','isolation-cleanup-receipt.json','process-cleanup.json'];
for(const file of files)copyFileSync(join(runtime,file),join(out,'results',file));
const protocol=JSON.parse(readFileSync(join(runtime,'protocol-results.json'))),http={},changes=[];
for(const [key,count] of Object.entries(protocol.http)){
  const normalized=key.replace(/\/ingest\/array\/[^/]+/g,'/ingest/array/[public-project-id]');
  if(normalized!==key)changes.push({path:'/http/'+normalized.replaceAll('~','~0').replaceAll('/','~1'),operation:'normalize public analytics project identifier in HTTP path',originalKeySha256:hash(key),originalUtf16Spans:[...key.matchAll(/\/ingest\/array\/([^/]+)/g)].map(match=>[match.index+'/ingest/array/'.length,match.index+match[0].length]),replacement:'[public-project-id]'});
  http[normalized]=(http[normalized]??0)+count;
}
protocol.http=http;writeFileSync(join(out,'results/protocol-results.json'),JSON.stringify(protocol,null,2)+'\n');
writeFileSync(join(out,'publication-sanitization.json'),JSON.stringify({rawProtocolSha256:hash(readFileSync(join(runtime,'protocol-results.json'))),changes,otherRuntimeResultsCopiedExactly:true,privateAuthEnvLogsAndInboxNeverPublished:true},null,2)+'\n');
for(const file of ['app-known-desktop.png','app-long-mobile.png','app-rescan-terminal.png','app-failed.png','app-legacy.png'])copyFileSync(join(runtime,file),join(out,'screenshots',file));
assert.equal(JSON.parse(readFileSync(join(out,'results/app-results.json'))).checks.length,15);
assert(JSON.parse(readFileSync(join(out,'results/app-results.json'))).checks.every(check=>check.status==='PASS'));
assert.equal(JSON.parse(readFileSync(join(out,'results/boundary-results.json'))).checks.length,8);
assert.equal(JSON.parse(readFileSync(join(out,'results/access-results.json'))).results.length,5);
assert.equal(JSON.parse(readFileSync(join(out,'results/request-results.json'))).checks.length,6);
const entries=[];function visit(dir,prefix=''){for(const name of readdirSync(dir).sort()){if(!prefix&&name==='manifest.json')continue;const file=join(dir,name),relative=prefix+name;if(statSync(file).isDirectory())visit(file,relative+'/');else entries.push({file:relative,sha256:hash(readFileSync(file)),bytes:statSync(file).size});}}visit(out);
writeFileSync(join(out,'manifest.json'),JSON.stringify({files:entries},null,2)+'\n');
console.log(JSON.stringify({appGroups:15,boundaryGroups:8,accessGroups:5,requestGroups:6,manifestFiles:entries.length,screenshots:5}));
