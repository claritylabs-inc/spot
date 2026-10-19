/// <reference types="vite/client" />
// Defined before implementation: repeated autosaves must not duplicate posts;
// queued summary edits must read latest values; wrong-target backfills must fail.
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { queueIntakeSlack } from "./intakeSlack";
const modules = import.meta.glob("./**/*.ts");
afterEach(()=>vi.unstubAllEnvs());
test("summary edits are deduplicated and use latest saved values under the delivery lease", async () => {
  vi.stubEnv("SLACK_CLARITY_TEAM_ID","T_FIXTURE");
  vi.stubEnv("INTAKE_SLACK_CHANNEL_ID","C_FIXTURE");
  const t=convexTest(schema,modules);
  const requestId=await t.run(async ctx=>{
    const userId=await ctx.db.insert("users",{email:"fixture@example.com"});
    return ctx.db.insert("procurementRequests",{title:"Fixture",status:"draft",inboxToken:"private-inbox",createdByUserId:userId,updatedByUserId:userId,createdAt:1,updatedAt:1,intakeRevision:0,intakeAnswers:{name:"Applicant",phone:"+12025550123"}});
  });
  await t.run(ctx=>queueIntakeSlack(ctx,requestId,"started","Started"));
  const started=await t.mutation(internal.intakeSlack.claim,{requestId});
  expect(started!.event.eventKey).toBe("started");
  await t.mutation(internal.intakeSlack.finish,{eventId:started!.event._id,lease:started!.lease,messageTs:"1.1"});
  await t.run(async ctx=>{
    await ctx.db.patch(requestId,{intakeRevision:1,intakeAnswers:{name:"Applicant",phone:"+12025550199"}});
    await queueIntakeSlack(ctx,requestId,"summary:1","Saved");
    await queueIntakeSlack(ctx,requestId,"summary:1","Saved");
  });
  const events=await t.run(ctx=>ctx.db.query("intakeSlackEvents").take(10));
  expect(events.map(e=>e.eventKey)).toEqual(["started","summary:0","summary:1"]);
  const summary=await t.mutation(internal.intakeSlack.claim,{requestId});
  expect(summary!.event.content).toContain("50199");
  expect(summary!.event.content).not.toContain("50123");
  expect(await t.mutation(internal.intakeSlack.claim,{requestId})).toBeNull();
  await expect(t.mutation(internal.intakeSlack.refresh,{requestId,expectedRevision:0,expectedThreadTs:"1.1"})).rejects.toThrow();
  await expect(t.mutation(internal.intakeSlack.refresh,{requestId,expectedRevision:1,expectedThreadTs:"wrong"})).rejects.toThrow();
});
