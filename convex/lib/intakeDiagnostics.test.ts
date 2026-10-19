/// <reference types="vite/client" />
// Failure modes: customer/disabled-operator access, leaked capabilities, deleted
// drafts, and a diagnostic read mutating or attaching the applicant's company.
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "../schema";
import { readUnlinkedIntakeByOperator } from "./intakeDiagnostics";
const modules = import.meta.glob("../**/*.ts");

test("unlinked intake diagnosis requires an active operator and never returns capabilities or writes", async () => {
  const t = convexTest(schema, modules);
  const f = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "applicant@example.com",
      accountKind: "customer",
    });
    const operatorId = await ctx.db.insert("users", {
      email: "operator@spot.insure",
      accountKind: "operator",
    });
    const profileId = await ctx.db.insert("operatorProfiles", {
      userId: operatorId,
      email: "operator@spot.insure",
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    const requestId = await ctx.db.insert("procurementRequests", {
      title: "Intake fixture",
      status: "draft",
      inboxToken: "private-inbox-capability",
      verificationClaimHash: "private-verification-capability",
      ownerUserId: userId,
      createdByUserId: userId,
      updatedByUserId: userId,
      createdAt: 1,
      updatedAt: 2,
      intakeStep: 7,
      intakeRevision: 3,
      intakeAnswers: { name: "Applicant", coverage: "Cyber" },
    });
    return { userId, operatorId, profileId, requestId };
  });
  const read = (operatorUserId = f.operatorId) =>
    t.run((ctx) =>
      readUnlinkedIntakeByOperator(ctx, {
        operatorUserId,
        requestId: f.requestId,
      }),
    );
  await expect(read(f.userId)).rejects.toThrow();
  const before = await t.run((ctx) => ctx.db.get(f.requestId));
  const result = await read();
  expect(result).toMatchObject({
    intakeStep: 7,
    intakeRevision: 3,
    diagnosticStatus: "draft",
    intakeAnswers: { coverage: "Cyber" },
  });
  expect(JSON.stringify(result)).not.toContain("private-");
  expect(await t.run((ctx) => ctx.db.get(f.requestId))).toEqual(before);
  await t.run((ctx) => ctx.db.patch(f.profileId, { status: "disabled" }));
  await expect(read()).rejects.toThrow();
  await t.run(async (ctx) => {
    await ctx.db.patch(f.profileId, { status: "active" });
    await ctx.db.patch(f.requestId, { deletedAt: 3 });
  });
  await expect(read()).rejects.toThrow("not found");
});
