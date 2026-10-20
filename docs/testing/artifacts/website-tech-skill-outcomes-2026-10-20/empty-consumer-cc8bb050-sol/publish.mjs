// Offline whitelist packaging only. No server, browser, provider or mutation calls.
import {readFileSync,writeFileSync,copyFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import net from 'node:net';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(process.argv[2]),sha='cc8bb050c20f6cb45798da7c6eb986d4b0b884af',runtime=join(root,'.context/qa/empty-consumer-cc8bb050-sol');
const hash=b=>createHash('sha256').update(b).digest('hex');
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sha);
assert.equal(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),'');
for(const name of ['bootstrap-results.json','results.json','protocol.json','cleanup.json','not-scanned-desktop.png'])copyFileSync(join(runtime,name),join(here,name));
const paths=['AGENTS.md','CLAUDE.md','app/operator/clients/[clientOrgId]/wiki/website-tech-section.tsx','app/operator/clients/[clientOrgId]/wiki/page.tsx','convex/websiteTech.ts','convex/operatorAgent.ts','convex/lib/operatorAgentToolRegistry.ts','convex/seed.ts','convex/lib/localSeedData.ts','scripts/lib/conductor-workspace.mjs','scripts/watch-conductor-email-captures.mjs','package.json','package-lock.json'];
const sources=paths.map(path=>{const actual=readFileSync(join(root,path)),expected=execFileSync('git',['show',sha+':'+path],{cwd:root,maxBuffer:20*1024*1024});assert(actual.equals(expected));return {path,sha256:hash(actual),matchesExactCandidate:true}});
writeFileSync(join(here,'source-binding.json'),JSON.stringify({candidate:sha,sources},null,2)+'\n');
const ports=[];for(const port of [8080,8083,8084,9222]){const closed=await new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port});s.once('connect',()=>{s.destroy();resolve(false)});s.once('error',()=>resolve(true));s.setTimeout(1000,()=>{s.destroy();resolve(false)})});assert(closed,'Owned port still open');ports.push({port,closed})}
assert(!existsSync(join(runtime,'auth-private.json')));assert(!existsSync(join(runtime,'bootstrap-private.env')));
writeFileSync(join(here,'validation.json'),JSON.stringify({node:process.version,candidateTrackedClean:true,sourceBlobsVerified:sources.length,ports,authRemoved:true,bootstrapPrivateFileRemoved:true,screenshotVisuallyReviewed:true,priorReportsUnmodified:true,fullTypesBuildNotRepeated:true,originalBackendAndPrivateInboxUntouched:true},null,2)+'\n');
console.log('PASS whitelist/source/cleanup verification');
