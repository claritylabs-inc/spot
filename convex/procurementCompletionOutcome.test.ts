/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { createProcurementRequestByOperator } from "./procurementRequests";
import { normalizeCompletionOutcome } from "./lib/procurementCompletionOutcome";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");

test("external placement closes only the exact request without policy or access grants", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const operatorUserId = await ctx.db.insert("users", {email:"operator@example.test",accountKind:"operator"});
    await ctx.db.insert("operatorProfiles", {userId:operatorUserId,email:"operator@example.test",role:"operator",status:"active",createdAt:dayjs().valueOf(),updatedAt:dayjs().valueOf()});
    const clientUserId = await ctx.db.insert("users", {email:"client@example.test",accountKind:"customer"});
    const clientOrgId = await ctx.db.insert("organizations", {name:"Cove",type:"client",operatorStatus:"live"});
    await ctx.db.insert("orgMemberships",{orgId:clientOrgId,userId:clientUserId,role:"admin"});
    const request = await createProcurementRequestByOperator(ctx,{operatorUserId,clientOrgId,title:"Auto",narrative:"Auto coverage",clientVisible:true,source:"workspace_scan"});
    const other = await createProcurementRequestByOperator(ctx,{operatorUserId,clientOrgId,title:"Cyber",narrative:"Cyber coverage",clientVisible:true,source:"workspace_scan"});
    return {operatorUserId,clientOrgId,clientUserId,requestId:request.requestId,otherId:other.requestId};
  });
  await t.withIdentity({subject:`${ids.operatorUserId}|session`}).mutation(api.procurementRequests.update,{requestId:ids.requestId,completionOutcome:{kind:"placed_elsewhere",provider:"GEICO",purchaseDate:"2026-09-12"}});
  await t.run(async ctx => {
    expect(await ctx.db.get(ids.requestId)).toMatchObject({status:"completed",completionOutcome:{kind:"placed_elsewhere",provider:"GEICO"}});
    expect((await ctx.db.get(ids.requestId))?.resultingPolicyId).toBeUndefined();
    expect((await ctx.db.get(ids.otherId))?.status).toBe("draft");
    expect((await ctx.db.get(ids.clientOrgId))?.operatorStatus).toBe("live");
    expect(await ctx.db.query("policies").collect()).toHaveLength(0);
    expect(await ctx.db.system.query("_scheduled_functions").collect()).toHaveLength(0);
  });
  await t.withIdentity({subject:`${ids.operatorUserId}|session`}).mutation(api.procurementRequests.update,{requestId:ids.requestId,status:"marketing"});
  expect(await t.run(ctx=>ctx.db.get(ids.requestId))).not.toHaveProperty("completionOutcome");
});

test("reported purchase dates reject impossible and ambiguous calendar values", () => {
  for (const purchaseDate of ["09/12/2026","2026-02-30","yesterday"])
    expect(()=>normalizeCompletionOutcome({kind:"placed_elsewhere",purchaseDate})).toThrow();
});
