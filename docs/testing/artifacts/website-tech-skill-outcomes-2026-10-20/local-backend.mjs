// Preserved workflow replay; run from repository root. Runtime/private output stays in .context.
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {withoutCloudConvexSelection} from '../../../../scripts/lib/conductor-workspace.mjs';
const config=JSON.parse(readFileSync('.convex/local/default/config.json','utf8'));
assert.deepEqual(config.ports,{cloud:8083,site:8084});
const env=withoutCloudConvexSelection(process.env);
export function cli(...args){const r=spawnSync('./node_modules/.bin/convex',[...args,'--url','http://127.0.0.1:8083','--admin-key',config.adminKey],{encoding:'utf8',env});assert.equal(r.status,0,'Pinned native-local command failed; diagnostics omitted for credential safety');return r.stdout.trim()}
export function assertLocal(){assert.equal(cli('env','get','SPOT_ENV'),'local');}
export function run(fn,args={}){assertLocal();return JSON.parse(cli('run',fn,JSON.stringify(args)));}
export function rows(table){return JSON.parse(cli('data',table,'--format','json'));}
export function mutateEnv(...args){assertLocal();return cli('env',...args)}
