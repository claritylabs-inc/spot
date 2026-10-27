/// <reference types="vite/client" />
// Failure modes are recorded before implementation in docs/testing/insurance-intake.md.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import dayjs from "dayjs";
import { detailsFromAnswers } from "../lib/insurance-intake-details";
import { INTAKE_TERMS_VERSION } from "../lib/intake-terms";
import schema from "./schema";
import { api, internal } from "./_generated/api";
const modules = import.meta.glob("./**/*.ts");
// Fake timers keep scheduled functions from running after the test ends.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
async function fixture() {
  const t = convexTest(schema, modules);
  const token = "intake_fixture_token_0000000000000000000000000001";
  await t.mutation(internal.requestIntake.createHandoff, {
    token,
    name: "Draft owner",
    email: "draft@example.com",
    phone: "+12025550123",
  });
  const { userId } = await t.mutation(internal.requestIntake.claimNewSession, {
    token,
  });
  const sessionId = await t.run((ctx) =>
    ctx.db.insert("authSessions", {
      userId,
      expirationTime: dayjs().add(30, "day").valueOf(),
    }),
  );
  const actor = t.withIdentity({ subject: `${userId}|${sessionId}` });
  const requestId = await actor.mutation(api.requestIntake.claimHandoff, {
    token,
  });
  return { t, actor, userId, sessionId, requestId, token };
}
test("restricted owner can save its draft but cannot create a company or finalize; handoff cannot replay", async () => {
  const f = await fixture();
  await f.actor.mutation(api.requestIntake.save, {
    requestId: f.requestId,
    answers: { description: "Partial answer" },
    step: 2,
    expectedRevision: 0,
  });
  expect(
    (await f.actor.query(api.requestIntake.get, { requestId: f.requestId }))
      .answers.description,
  ).toBe("Partial answer");
  await expect(
    f.actor.mutation(api.orgs.createClientOrg, {
      name: "Unauthorized company",
    }),
  ).rejects.toThrow();
  await expect(
    f.actor.mutation(api.requestIntake.submit, { requestId: f.requestId }),
  ).rejects.toThrow();
  await expect(
    f.t.mutation(internal.requestIntake.claimNewSession, { token: f.token }),
  ).rejects.toThrow();
});
test("other owner and stale revision cannot read or overwrite a saved draft", async () => {
  const f = await fixture();
  const other = await f.t.run((ctx) =>
    ctx.db.insert("users", {
      email: "other@example.com",
      accountKind: "customer",
    }),
  );
  const actor = f.t.withIdentity({ subject: `${other}|session` });
  await expect(
    actor.query(api.requestIntake.get, { requestId: f.requestId }),
  ).rejects.toThrow("Request not found");
  await expect(
    actor.mutation(api.requestIntake.save, {
      requestId: f.requestId,
      answers: { name: "Wrong owner" },
      step: 0,
      expectedRevision: 0,
    }),
  ).rejects.toThrow();
  await f.actor.mutation(api.requestIntake.save, {
    requestId: f.requestId,
    answers: { name: "Accepted" },
    step: 0,
    expectedRevision: 0,
  });
  await expect(
    f.actor.mutation(api.requestIntake.save, {
      requestId: f.requestId,
      answers: { name: "Stale" },
      step: 0,
      expectedRevision: 0,
    }),
  ).rejects.toThrow("another tab");
  expect(
    (await f.actor.query(api.requestIntake.get, { requestId: f.requestId }))
      .answers.name,
  ).toBe("Accepted");
});
test("existing email never receives a restricted session and revoked session cannot inherit verified access", async () => {
  const f = await fixture();
  const token = "another_fixture_token_000000000000000000000000001";
  await f.t.mutation(internal.requestIntake.createHandoff, {
    token,
    name: "Imposter",
    email: "draft@example.com",
    phone: "+12025550124",
  });
  await expect(
    f.t.mutation(internal.requestIntake.claimNewSession, { token }),
  ).rejects.toThrow();
  await f.t.run(async (ctx) => {
    await ctx.db.patch(f.userId, {
      intakeRestricted: false,
      emailVerificationTime: dayjs().valueOf(),
    });
    await ctx.db.delete(f.sessionId);
  });
  await expect(
    f.actor.query(api.requestIntake.get, { requestId: f.requestId }),
  ).rejects.toThrow();
  await expect(
    f.actor.mutation(api.orgs.createClientOrg, {
      name: "Revoked session company",
    }),
  ).rejects.toThrow();
});
test("submitted answers cannot attach an unauthorized company or duplicate promotion", async () => {
  const f = await fixture();
  const { orgId, sessionId } = await f.t.run(async (ctx) => {
    await ctx.db.patch(f.userId, {
      intakeRestricted: false,
      emailVerificationTime: dayjs().valueOf(),
    });
    const sessionId = await ctx.db.insert("authSessions", {
      userId: f.userId,
      expirationTime: dayjs().add(30, "day").valueOf(),
    });
    return {
      orgId: await ctx.db.insert("organizations", {
        name: "Other tenant",
        type: "client",
      }),
      sessionId,
    };
  });
  const actor = f.t.withIdentity({ subject: `${f.userId}|${sessionId}` });
  await f.t.run((ctx) =>
    ctx.db.patch(f.requestId, { intakeVerifiedAccess: true }),
  );
  const answers = {
    name: "Owner",
    email: "draft@example.com",
    phone: "+12025550123",
    trigger: "New business",
    requirements: "None",
    effectiveDate: "2026-11-01",
    coverage: "Not sure—advise me",
    coverageScope: "Main entity",
    legalName: "Synthetic company",
    description: "Consulting",
    locations: "Toronto",
    currentInsurance: "No",
    companyConfirmed: "yes",
  };
  await actor.mutation(api.requestIntake.save, {
    requestId: f.requestId,
    answers,
    details: {
      ...detailsFromAnswers(answers),
      termsAcceptedVersion: INTAKE_TERMS_VERSION,
    },
    step: 4,
    expectedRevision: 0,
  });
  const draft = await f.t.run((ctx) => ctx.db.get(f.requestId));
  expect(draft?.clientOrgId).toBeDefined();
  expect(draft?.clientOrgId).not.toBe(orgId);
  const otherCompany = await f.t.run((ctx) => ctx.db.get(orgId));
  const submitted = await actor.mutation(api.requestIntake.submit, {
    requestId: f.requestId,
    orgId,
    expectedRevision: 1,
    confirmedAccurateAndAuthorized: true,
  });
  expect(submitted.orgId).toBe(draft?.clientOrgId);
  expect(await f.t.run((ctx) => ctx.db.get(orgId))).toEqual(otherCompany);
  expect(
    await actor.mutation(api.requestIntake.submit, { requestId: f.requestId, expectedRevision: 1, confirmedAccurateAndAuthorized: true }),
  ).toEqual(submitted);
  const rows = await f.t.run((ctx) =>
    ctx.db
      .query("orgMemberships")
      .withIndex("user", (q) => q.eq("userId", f.userId))
      .collect(),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].orgId).toBe(submitted.orgId);
  const original = await f.t.run((ctx) => ctx.db.get(f.requestId));
  await actor.mutation(api.requestIntake.save, {
    requestId: f.requestId,
    answers: { description: "Changed" },
    step: 4,
    expectedRevision: 1,
  });
  const amended = await f.t.run((ctx) => ctx.db.get(f.requestId));
  expect(amended?.intakeSnapshot).toEqual(original?.intakeSnapshot);
  expect(amended?.intakeAnswers?.description).toBe("Changed");
  expect(amended?.intakeSubmittedApplication).toBeDefined();
  await expect(
    actor.mutation(api.requestIntake.save, {
      requestId: f.requestId,
      answers: { description: "Stale" },
      step: 4,
      expectedRevision: 1,
    }),
  ).rejects.toThrow("another tab");
});
test("mailbox recovery from a different session requires the original browser proof", async () => {
  const f = await fixture();
  const proof = "device_proof_000000000000000000000000000000001";
  await f.actor.mutation(api.requestIntake.prepareVerification, {
    requestId: f.requestId,
    token: proof,
  });
  await f.t.mutation(internal.auth.store, {
    args: {
      type: "createVerificationCode",
      provider: "resend-otp",
      email: "draft@example.com",
      code: "123456",
      expirationTime: dayjs().add(15, "minute").valueOf(),
      allowExtraProviders: false,
    },
  });
  const result = await f.t.mutation(internal.auth.store, {
    args: {
      type: "verifyCodeAndSignIn",
      provider: "resend-otp",
      params: { email: "draft@example.com", code: "123456" },
      generateTokens: false,
      allowExtraProviders: false,
    },
  });
  if (
    !result ||
    typeof result !== "object" ||
    !("userId" in result) ||
    !("sessionId" in result)
  )
    throw new Error("Expected a verified session");
  expect(result.userId).toBe(f.userId);
  const restored = f.t.withIdentity({
    subject: `${result!.userId}|${result!.sessionId}`,
  });
  await expect(
    restored.query(api.requestIntake.get, { requestId: f.requestId }),
  ).rejects.toThrow("Confirm application ownership");
  await expect(
    restored.mutation(api.requestIntake.confirmVerifiedOwnership, {
      requestId: f.requestId,
      token: "wrong_device_proof_000000000000000000000000001",
    }),
  ).rejects.toThrow("confirmation expired");
  await f.t.run((ctx) =>
    ctx.db.patch(f.requestId, {
      verificationClaimExpiresAt: dayjs().subtract(1, "minute").valueOf(),
    }),
  );
  await expect(
    restored.mutation(api.requestIntake.confirmVerifiedOwnership, {
      requestId: f.requestId,
      token: proof,
    }),
  ).rejects.toThrow("confirmation expired");
  await f.t.run((ctx) =>
    ctx.db.patch(f.requestId, {
      verificationClaimExpiresAt: dayjs().add(1, "day").valueOf(),
    }),
  );
  await restored.mutation(api.requestIntake.confirmVerifiedOwnership, {
    requestId: f.requestId,
    token: proof,
  });
  expect(
    (await restored.query(api.requestIntake.get, { requestId: f.requestId }))
      .verified,
  ).toBe(true);
});
