/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import dayjs from "dayjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { assertGoogleWorkspaceScanSourceLease } from "./lib/googleWorkspaceScanState";
import type { GoogleWorkspaceScanSettingsInput, GoogleWorkspaceScanStatus } from "./lib/googleWorkspaceScan";

const modules = import.meta.glob("./**/*.ts");
const settings = makeFunctionReference<"mutation", GoogleWorkspaceScanSettingsInput, null>("operatorGoogleWorkspaceScan:updateSettings");
const status = makeFunctionReference<"query", Record<string, never>, GoogleWorkspaceScanStatus>("operatorGoogleWorkspaceScan:getStatus");
const dispatch = makeFunctionReference<"mutation", Record<string, never>, null>("operatorGoogleWorkspaceScan:dispatchInternal");
async function fixture() {
  vi.stubEnv("GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON", JSON.stringify({type:"service_account",client_email:"reader@example.iam.gserviceaccount.com",client_id:"123",private_key:"-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----"}));
  const t = convexTest(schema, modules);
  const userId = await t.run(async ctx => {
    const id = await ctx.db.insert("users", {accountKind:"operator",email:"operator@example.com"});
    await ctx.db.insert("operatorProfiles", {userId:id,email:"operator@example.com",role:"operator",status:"active",createdAt:1,updatedAt:1});
    return id;
  });
  const operator = t.withIdentity({subject:`${userId}|session`});
  await operator.mutation(api.operatorGoogleWorkspace.updateSettings, {enabled:true,mailboxMode:"directory",mailboxes:[],directoryAdminEmail:"admin@example.com"});
  return {t,operator,userId};
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
describe("Workspace scan standing authorization", () => {
  it("defaults off, requires Directory, and leaves live-search revisions untouched on cadence edits", async () => {
    const {operator} = await fixture();
    expect((await operator.query(status, {})).config.enabled).toBe(false);
    const connector = await operator.query(api.operatorGoogleWorkspace.getStatus, {});
    await operator.mutation(settings, {enabled:true,intervalMinutes:60});
    const first = await operator.query(status, {});
    await operator.mutation(settings, {enabled:true,intervalMinutes:15});
    const second = await operator.query(status, {});
    expect(second.config.authorizationRevision).toBe(first.config.authorizationRevision);
    expect(second.latestRun?.id).toBe(first.latestRun?.id);
    expect((await operator.query(api.operatorGoogleWorkspace.getStatus, {})).config?.updatedAt).toBe(connector.config?.updatedAt);
    await operator.mutation(settings, {enabled:false,intervalMinutes:15});
    await operator.mutation(api.operatorGoogleWorkspace.updateSettings, {enabled:true,mailboxMode:"manual",mailboxes:["mail@example.com"]});
    await expect(operator.mutation(settings,{enabled:true,intervalMinutes:60})).rejects.toThrow("Directory");
  });
  it("preserves the initial window across pause and re-enable and rejects tenant settings access", async () => {
    const {operator,t} = await fixture();
    await operator.mutation(settings, {enabled:true,intervalMinutes:60});
    const first = await operator.query(status, {});
    await operator.mutation(settings, {enabled:false,intervalMinutes:60});
    await operator.mutation(settings, {enabled:true,intervalMinutes:60});
    const next = await operator.query(status, {});
    expect(next.latestRun?.coverage.windowStartAt).toBe(first.latestRun?.coverage.windowStartAt);
    expect(next.config.authorizationRevision).toBeGreaterThan(first.config.authorizationRevision);
    const tenantId = await t.run(ctx => ctx.db.insert("users", {accountKind:"customer",email:"tenant@example.com"}));
    await expect(t.withIdentity({subject:`${tenantId}|session`}).query(status,{})).rejects.toThrow("Spot operators");
  });
  it("atomically fences paused, changed-credential, and disabled-sponsor source writes", async () => {
    const {operator,t,userId} = await fixture();
    await operator.mutation(settings, {enabled:true,intervalMinutes:60});
    const sourceId = await t.run(async ctx => {
      const config = (await ctx.db.query("operatorGoogleWorkspaceScanConfig").first())!;
      const mailboxId = await ctx.db.insert("operatorGoogleWorkspaceScanMailboxes",{mailbox:"mail@example.com",runId:config.currentRunId!,authorizationRevision:config.authorizationRevision,phase:"history",status:"completed",windowStartAt:config.windowStartAt,collectedMessages:1,nextAttemptAt:0,attempts:0});
      return ctx.db.insert("operatorGoogleWorkspaceScanSources", {mailbox:"mail@example.com",messageId:"m1",threadId:"t1",mailboxId,runId:config.currentRunId!,authorizationRevision:config.authorizationRevision,status:"running",leaseToken:"lease",leaseUntil:dayjs().add(1,"minute").valueOf(),nextAttemptAt:0,attempts:0});
    });
    const guardedWrite = () => t.run(async ctx => {
      await assertGoogleWorkspaceScanSourceLease(ctx,{sourceId,leaseToken:"lease"});
      await ctx.db.patch(sourceId,{error:"guard passed"});
    });
    await guardedWrite();
    vi.stubEnv("GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON", "");
    await expect(guardedWrite()).rejects.toThrow("credentials changed");
    await t.mutation(dispatch,{});
    expect((await operator.query(status,{})).config.enabled).toBe(false);
    await expect(guardedWrite()).rejects.toThrow("paused");
    await t.run(async ctx => {
      const profile = await ctx.db.query("operatorProfiles").withIndex("user",q=>q.eq("userId",userId)).unique();
      await ctx.db.patch(profile!._id,{status:"disabled"});
    });
    await expect(operator.query(status,{})).rejects.toThrow("Spot operators");
  });
});
