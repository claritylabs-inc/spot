/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import migrationsTest from "@convex-dev/migrations/test";
import dayjs from "dayjs";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { resolveActiveOperatorEmail } from "./lib/operatorIdentity";

const modules = import.meta.glob("./**/*.ts");
const fixture = async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) =>
    ctx.db.insert("operatorEmailIdentityBackfill", {
      key: "legacy",
      completedAt: 1,
    }),
  );
  return t;
};
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function requestCode(t: Fixture, email: string) {
  await t.mutation(internal.auth.store, {
    args: {
      type: "createVerificationCode",
      provider: "resend-otp",
      email,
      code: "123456",
      expirationTime: dayjs().add(15, "minute").valueOf(),
      allowExtraProviders: false,
    },
  });
}

async function verifyCode(t: Fixture, email: string, code = "123456") {
  return t.mutation(internal.auth.store, {
    args: {
      type: "verifyCodeAndSignIn",
      provider: "resend-otp",
      params: { email, code },
      generateTokens: false,
      allowExtraProviders: false,
    },
  });
}

async function seedOperator(t: Fixture, email = "terry@claritylabs.inc") {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email,
      accountKind: "operator",
    });
    const profileId = await ctx.db.insert("operatorProfiles", {
      userId,
      email,
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    return { userId, profileId };
  });
}
afterEach(() => vi.unstubAllEnvs());

test("all three verified mailboxes reuse the operator, primary address and role without granting access at code request", async () => {
  const t = await fixture();
  const { userId, profileId } = await seedOperator(t);
  vi.stubEnv("OPERATOR_OWNER_EMAILS", "terry@spot.insure");
  for (const email of [
    "terry@spot.insure",
    "terry@toolsforenlightenment.org",
    "terry@claritylabs.inc",
  ]) {
    await requestCode(t, email);
    expect(await verifyCode(t, email, "654321")).toBeNull();
    expect(await verifyCode(t, email)).toMatchObject({ userId });
    const current = await t
      .withIdentity({ subject: `${userId}|session` })
      .query(api.operator.current, {});
    expect(current.user.email).toBe("terry@claritylabs.inc");
    expect(current.user.loginEmails).toHaveLength(3);
    expect(
      await t
        .withIdentity({ subject: `${userId}|session` })
        .mutation(api.operator.bootstrapViewer, {}),
    ).toEqual({ ok: true, role: "operator" });
  }
  await t.run(async (ctx) => {
    expect(await ctx.db.query("users").collect()).toHaveLength(1);
    expect(await ctx.db.query("authAccounts").collect()).toHaveLength(3);
    expect(await ctx.db.get(profileId)).toMatchObject({
      role: "operator",
      status: "active",
    });
    expect(await ctx.db.query("operatorAuditEvents").collect()).toHaveLength(0);
  });
});

test("first domain login automatically provisions an operator only after mailbox verification on any login page", async () => {
  const t = await fixture();
  vi.stubEnv("OPERATOR_BOOTSTRAP_EMAILS", "");
  await requestCode(t, "new.employee@spot.insure");
  const user = await t.run((ctx) => ctx.db.query("users").first());
  const authed = t.withIdentity({ subject: `${user!._id}|session` });
  await expect(
    authed.mutation(api.operator.bootstrapViewer, {}),
  ).rejects.toThrow();
  expect(
    await t.run((ctx) => ctx.db.query("authSessions").collect()),
  ).toHaveLength(0);
  await verifyCode(t, "new.employee@spot.insure");
  expect(await t.run((ctx) => ctx.db.get(user!._id))).toMatchObject({
    accountKind: "operator",
    onboardingComplete: true,
  });
  expect(await authed.query(api.operator.current, {})).toMatchObject({
    profile: { role: "operator", status: "active" },
  });
  expect(await authed.mutation(api.operator.bootstrapViewer, {})).toEqual({
    ok: true,
    role: "operator",
  });

  for (const email of [
    "new.employee@evilspot.insure",
    "new.employee@sub.spot.insure",
    "new.employee@external.test",
  ]) {
    await requestCode(t, email);
    const result = await verifyCode(t, email);
    if (!result || typeof result !== "object" || !("userId" in result)) {
      throw new Error("Expected a verified auth session");
    }
    expect(result.userId).not.toBe(user!._id);
    await expect(
      t
        .withIdentity({ subject: `${result.userId}|session` })
        .mutation(api.operator.bootstrapViewer, {}),
    ).rejects.toThrow();
  }
});

test("a code must be verified for its exact mailbox even when both addresses identify the same operator", async () => {
  const t = await fixture();
  await seedOperator(t);
  await requestCode(t, "terry@spot.insure");
  await expect(verifyCode(t, "terry@claritylabs.inc")).rejects.toThrow();
  expect(
    await t.run((ctx) => ctx.db.query("authSessions").collect()),
  ).toHaveLength(0);
});

test("disabled operators and existing customer identities cannot gain access through another domain", async () => {
  for (const kind of [
    "disabled",
    "customer",
    "membership",
    "ambiguous",
  ] as const) {
    const t = await fixture();
    const { userId, profileId } = await seedOperator(t);
    await t.run(async (ctx) => {
      if (kind === "disabled")
        await ctx.db.patch(profileId, { status: "disabled" });
      if (kind === "customer")
        await ctx.db.patch(userId, { accountKind: "customer" });
      if (kind === "membership") {
        const orgId = await ctx.db.insert("organizations", {
          name: "Customer",
          type: "client",
        });
        await ctx.db.insert("orgMemberships", {
          orgId,
          userId,
          role: "member",
        });
      }
      if (kind === "ambiguous")
        await ctx.db.insert("users", {
          email: "terry@toolsforenlightenment.org",
        });
    });
    await expect(requestCode(t, "terry@spot.insure")).rejects.toThrow();
    expect(
      await t.run((ctx) =>
        resolveActiveOperatorEmail(ctx, "terry@spot.insure"),
      ),
    ).toBeNull();
    expect(
      await t.run((ctx) => ctx.db.query("authSessions").collect()),
    ).toHaveLength(0);
  }
});

test("authenticated mail aliases resolve to one existing operator, while unknown, spoofed-domain and agent addresses do not", async () => {
  const t = await fixture();
  const { userId } = await seedOperator(t);
  await t.run(async (ctx) => {
    expect(
      await resolveActiveOperatorEmail(ctx, " Terry@Spot.Insure "),
    ).toMatchObject({ userId });
    for (const email of [
      "unknown@spot.insure",
      "terry@sub.spot.insure",
      "terry@claritylabs.inc.evil.test",
      "operator@spot.insure",
    ]) {
      expect(await resolveActiveOperatorEmail(ctx, email)).toBeNull();
    }
  });
  await expect(requestCode(t, "operator@spot.insure")).rejects.toThrow();
});

test("legacy mixed-case identities stay closed until the complete backfill and cannot be bypassed through another domain", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema, modules);
    migrationsTest.register(t);
    const ids = await t.run(async (ctx) => {
      const customerId = await ctx.db.insert("users", {
        email: "Alex@ClarityLabs.inc",
        accountKind: "customer",
      });
      await ctx.db.insert("authAccounts", {
        provider: "resend-otp",
        providerAccountId: "Alex@ClarityLabs.inc",
        userId: customerId,
      });
      const operatorId = await ctx.db.insert("users", {
        email: "Sam@ClarityLabs.inc",
        accountKind: "operator",
      });
      const profileId = await ctx.db.insert("operatorProfiles", {
        userId: operatorId,
        email: "Sam@ClarityLabs.inc",
        role: "owner",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const conflictId = await ctx.db.insert("users", {
        email: "another@external.test",
        accountKind: "customer",
      });
      await ctx.db.insert("authAccounts", {
        provider: "resend-otp",
        providerAccountId: "Morgan@Spot.Insure",
        userId: conflictId,
      });
      await ctx.db.insert("operatorProfiles", {
        userId: conflictId,
        email: "Robin@ClarityLabs.inc",
        role: "operator",
        status: "disabled",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("users", { email: "Casey@Spot.Insure" });
      await ctx.db.insert("users", { email: "casey@claritylabs.inc" });
      return { customerId, operatorId, profileId };
    });
    await expect(requestCode(t, "alex@spot.insure")).rejects.toThrow(
      "still in progress",
    );
    await expect(
      t.mutation(internal.migrations.finishOperatorEmailIdentityBackfill, {}),
    ).rejects.toThrow("Complete all");
    await t.mutation(internal.migrations.runOperatorEmailIdentityBackfill, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.mutation(
      internal.migrations.finishOperatorEmailIdentityBackfill,
      {},
    );
    expect(
      await t.query(
        internal.migrations.operatorEmailIdentityBackfillStatus,
        {},
      ),
    ).toMatchObject({ ready: true });
    await expect(requestCode(t, "alex@spot.insure")).rejects.toThrow(
      "not authorized",
    );
    await expect(requestCode(t, "morgan@claritylabs.inc")).rejects.toThrow(
      "not authorized",
    );
    await expect(requestCode(t, "robin@spot.insure")).rejects.toThrow(
      "not authorized",
    );
    await expect(requestCode(t, "casey@toolsforenlightenment.org")).rejects.toThrow(
      "identities conflict",
    );
    await requestCode(t, "sam@spot.insure");
    expect(await verifyCode(t, "sam@spot.insure")).toMatchObject({
      userId: ids.operatorId,
    });
    await t.run(async (ctx) => {
      expect(await ctx.db.get(ids.operatorId)).toMatchObject({
        email: "Sam@ClarityLabs.inc",
      });
      expect(await ctx.db.get(ids.profileId)).toMatchObject({
        email: "Sam@ClarityLabs.inc",
        role: "owner",
      });
      expect(await ctx.db.query("users").collect()).toHaveLength(5);
      expect(
        await ctx.db.query("operatorEmailIdentities").collect(),
      ).toHaveLength(5);
    });
    await t.run((ctx) => ctx.db.patch(ids.profileId, { status: "disabled" }));
    await expect(
      requestCode(t, "sam@toolsforenlightenment.org"),
    ).rejects.toThrow("not authorized");
  } finally {
    vi.useRealTimers();
  }
});
