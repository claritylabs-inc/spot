/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { googleWorkspaceCredentialEnvelope } from "./lib/googleWorkspaceCredentials";
import { sourceEffectiveAt, type ScanOperation } from "./lib/googleWorkspaceReconciliation";
const modules=import.meta.glob("./**/*.ts");
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(dayjs("2026-09-14T12:00:00Z").toDate());vi.stubEnv("GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON",JSON.stringify({type:"service_account",client_email:"reader@example.iam.gserviceaccount.com",client_id:"123",private_key:"-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----"}));});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
const body="Cove purchased Auto insurance from GEICO and no longer need this Auto request.";
const identity={kind:"client" as const,name:"Cove",contactEmail:"client@cove.test",address:null};
const operation:ScanOperation={kind:"external_placement",identity,request:{title:"Auto",coverage:"Auto"},completedPurchase:true,noLongerNeeded:true,outcome:{kind:"placed_elsewhere",provider:"GEICO",purchaseDate:"2026-09-13"},effectiveDate:"2026-09-13",excerpt:body,explanation:"Client reported completed external purchase."};
async function fixture(){
 const t=convexTest(schema,modules);const revision=(await googleWorkspaceCredentialEnvelope()).revision!;
 const ids=await t.run(async ctx=>{
  const userId=await ctx.db.insert("users",{accountKind:"operator",email:"operator@example.test"});
  await ctx.db.insert("operatorProfiles",{userId,email:"operator@example.test",role:"operator",status:"active",createdAt:1,updatedAt:1});
  await ctx.db.insert("operatorGoogleWorkspaceConfig",{key:"default",enabled:true,mailboxMode:"directory",mailboxes:[],directoryAdminEmail:"admin@example.test",updatedAt:1,updatedBy:userId});
  const runId=await ctx.db.insert("operatorGoogleWorkspaceScanRuns",{authorizationRevision:1,phase:"reconciliation",startedAt:1,windowStartAt:1,directoryComplete:true,discoveredMailboxes:1,completedMailboxes:1,failedMailboxes:0,collectedMessages:1,pendingSources:1,reconciledSources:0,nextAttemptAt:0,attempts:0});
  await ctx.db.insert("operatorGoogleWorkspaceScanConfig",{key:"default",enabled:true,intervalMinutes:60,authorizationRevision:1,authorizingOperatorId:userId,connectorRevision:1,credentialRevision:revision,windowStartAt:1,nextRunAt:0,currentRunId:runId,updatedAt:1});
  const mailboxId=await ctx.db.insert("operatorGoogleWorkspaceScanMailboxes",{mailbox:"ops@example.test",runId,authorizationRevision:1,phase:"completed",status:"completed",windowStartAt:1,collectedMessages:1,nextAttemptAt:0,attempts:0});
  const evidence={mailbox:"ops@example.test",messageId:"m1",threadId:"t1",internetMessageId:"<m1@cove.test>",internalDate:dayjs("2026-09-13T12:00:00Z").valueOf(),sentAt:"2026-09-13T12:00:00Z",from:"client@cove.test",to:["ops@example.test"],cc:[],subject:"Auto",inReplyTo:null,references:null,contentFingerprint:"abc",attachments:[],bodyPartCount:1,bodyComplete:true};
  const sourceId=await ctx.db.insert("operatorGoogleWorkspaceScanSources",{mailbox:"ops@example.test",messageId:"m1",threadId:"t1",mailboxId,runId,authorizationRevision:1,status:"running",leaseToken:"lease",leaseUntil:dayjs().add(1,"hour").valueOf(),nextAttemptAt:0,attempts:0,evidence});
  await ctx.db.insert("operatorGoogleWorkspaceScanSourceParts",{sourceId,ordinal:0,text:body});
  const orgId=await ctx.db.insert("organizations",{name:"Cove",type:"client",primaryContactEmail:"client@cove.test",operatorStatus:"live"});
  const requestId=await ctx.db.insert("procurementRequests",{clientOrgId:orgId,title:"Auto",narrative:"Original Auto request",status:"marketing",clientVisible:true,inboxToken:"original",createdByUserId:userId,updatedByUserId:userId,createdAt:1,updatedAt:dayjs("2026-09-01").valueOf()});
  return {userId,sourceId,orgId,requestId,evidence};
 });
 const args={sourceId:ids.sourceId,leaseToken:"lease",operationJson:JSON.stringify(operation)};
 return {t,...ids,args};
}
test("atomically completes the exact request, preserves client/narrative/visibility, and deduplicates retry",async()=>{
 const f=await fixture();const prepared=await f.t.query(internal.operatorGoogleWorkspaceReconciliation.prepareInternal,f.args);
 await f.t.mutation(internal.operatorGoogleWorkspaceReconciliation.applyInternal,{...f.args,snapshot:prepared.snapshot});
 await f.t.mutation(internal.operatorGoogleWorkspaceReconciliation.applyInternal,{...f.args,snapshot:prepared.snapshot});
 await f.t.run(async ctx=>{
  expect(await ctx.db.get(f.requestId)).toMatchObject({status:"completed",narrative:"Original Auto request",clientVisible:true,completionOutcome:{kind:"placed_elsewhere",provider:"GEICO"}});
  expect((await ctx.db.get(f.orgId))?.operatorStatus).toBe("live");
  expect(await ctx.db.query("policies").collect()).toHaveLength(0);
  expect(await ctx.db.query("operatorWorkspaceScanChanges").collect()).toHaveLength(1);
 });
});
test("rejects concurrent manual changes and paused standing authorization without writes",async()=>{
 const f=await fixture();const prepared=await f.t.query(internal.operatorGoogleWorkspaceReconciliation.prepareInternal,f.args);
 await f.t.run(ctx=>ctx.db.patch(f.requestId,{narrative:"Auto changed manually"}));
 await expect(f.t.mutation(internal.operatorGoogleWorkspaceReconciliation.applyInternal,{...f.args,snapshot:prepared.snapshot})).rejects.toThrow("changed during analysis");
 await f.t.run(async ctx=>{const config=await ctx.db.query("operatorGoogleWorkspaceScanConfig").first();await ctx.db.patch(config!._id,{enabled:false});});
 await expect(f.t.mutation(internal.operatorGoogleWorkspaceReconciliation.applyInternal,{...f.args,snapshot:prepared.snapshot})).rejects.toThrow("paused");
});
test("newer evidence replaces manual values; old evidence cannot",async()=>{
 const f=await fixture();await f.t.run(ctx=>ctx.db.patch(f.requestId,{updatedAt:dayjs("2026-09-14").valueOf()}));
 const prepared=await f.t.query(internal.operatorGoogleWorkspaceReconciliation.prepareInternal,f.args);
 await expect(f.t.mutation(internal.operatorGoogleWorkspaceReconciliation.applyInternal,{...f.args,snapshot:prepared.snapshot})).rejects.toThrow("newer or same-date");
});
test("tentative purchase, wrong coverage, fabricated excerpt, and forwarded old evidence fail closed",async()=>{
 const f=await fixture();
 for(const op of [{...operation,completedPurchase:false},{...operation,request:{title:"Cyber",coverage:"Cyber"}},{...operation,excerpt:"fabricated"}])expect(()=>sourceEffectiveAt(op,f.evidence,body)).toThrow();
 expect(()=>sourceEffectiveAt(operation,{...f.evidence,internalDate:dayjs().valueOf()},`Forwarded message\n${body}`)).toThrow("own explicit effective date");
});
test("conditional correction refuses later edits and tenant access",async()=>{
 const f=await fixture();const prepared=await f.t.query(internal.operatorGoogleWorkspaceReconciliation.prepareInternal,f.args);
 const result=await f.t.mutation(internal.operatorGoogleWorkspaceReconciliation.applyInternal,{...f.args,snapshot:prepared.snapshot});
 await f.t.run(ctx=>ctx.db.patch(f.requestId,{title:"Later manual edit"}));
 const operator=f.t.withIdentity({subject:`${f.userId}|session`});
 expect(await operator.mutation(api.operatorGoogleWorkspaceScanActivity.correctActivity,{activityId:result.findingId})).toMatchObject({status:"conflict"});
 const tenant=await f.t.run(ctx=>ctx.db.insert("users",{email:"tenant@example.test",accountKind:"customer"}));
 await expect(f.t.withIdentity({subject:`${tenant}|session`}).query(api.operatorGoogleWorkspaceScanActivity.getActivity,{activityId:result.findingId})).rejects.toThrow();
});
