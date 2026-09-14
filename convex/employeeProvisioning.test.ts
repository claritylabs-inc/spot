/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { EMPLOYEE_DIRECTORY_LIMIT } from "./lib/employeeProvisioning";

const modules = import.meta.glob("./**/*.ts");
const token = "synthetic-test-only-employee-provisioning-token";
const identity = {
  personId: "synthetic-employee",
  email: "employee@example.test",
  role: "operator",
  deployment: "some",
  appUrl: "https://spot.example.test",
};
const approval = { requestId: "a".repeat(64), approvalDigest: "b".repeat(64) };
const fixture = () => convexTest(schema, modules);
type Fixture = ReturnType<typeof fixture>;

async function call(
  t: Fixture,
  write = false,
  overrides = {},
  authorization = `Bearer ${token}`,
) {
  return t.fetch(
    `/api/provisioning/v1/operators/${write ? "provision" : "observe"}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authorization,
      },
      body: JSON.stringify({
        ...identity,
        ...(write ? approval : {}),
        ...overrides,
      }),
    },
  );
}
async function state(t: Fixture) {
  return t.run(async (ctx) => ({
    users: await ctx.db.query("users").collect(),
    profiles: await ctx.db.query("operatorProfiles").collect(),
    accounts: await ctx.db.query("authAccounts").collect(),
    audits: await ctx.db.query("operatorAuditEvents").collect(),
    requests: await ctx.db.query("employeeProvisioningRequests").collect(),
    codes: await ctx.db.query("authVerificationCodes").collect(),
    sessions: await ctx.db.query("authSessions").collect(),
  }));
}
async function seed(t: Fixture, role: "operator" | "owner" = "operator") {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: identity.email,
      accountKind: "operator",
      onboardingComplete: true,
    });
    const profileId = await ctx.db.insert("operatorProfiles", {
      userId,
      email: identity.email,
      role,
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    const accountId = await ctx.db.insert("authAccounts", {
      userId,
      provider: "resend-otp",
      providerAccountId: identity.email,
    });
    return { userId, profileId, accountId };
  });
}

beforeEach(() => {
  vi.stubEnv("EMPLOYEE_PROVISIONING_SECRET", token);
  vi.stubEnv("EMPLOYEE_PROVISIONING_DEPLOYMENT", identity.deployment);
  vi.stubEnv("EMPLOYEE_PROVISIONING_EMAIL_DOMAINS", "example.test");
  vi.stubEnv("SPOT_ENV", "local");
  for (const name of [
    "AUTH_LINK_SITE_URL",
    "AUTH_SITE_URL",
    "AUTH_PORTAL_URL",
    "SITE_URL",
  ])
    vi.stubEnv(name, identity.appUrl);
  vi.stubEnv("OPERATOR_BOOTSTRAP_EMAILS", "");
  vi.stubEnv("OPERATOR_OWNER_EMAILS", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("central employee provisioning HTTP boundary", () => {
  test("observation is read-only and proves exact case-insensitive access", async () => {
    const t = fixture();
    const absent = await (await call(t)).json();
    expect(absent).toMatchObject({
      version: 1,
      personId: identity.personId,
      email: identity.email,
      deployment: identity.deployment,
      appUrl: identity.appUrl,
      status: "absent",
      environment: "local",
      details: { reason: "missing_identity" },
    });
    expect(absent.role).toBeUndefined();
    expect(absent.remoteId).toBeUndefined();
    expect((await state(t)).users).toHaveLength(0);
    const { userId } = await seed(t);
    const before = await state(t);
    expect(
      await (await call(t, false, { email: " Employee@Example.Test " })).json(),
    ).toEqual({
      version: 1,
      ...identity,
      status: "member",
      environment: "local",
      remoteId: userId,
      message:
        "Active operator access is configured; email OTP is required to sign in.",
      details: { reason: "active_operator" },
    });
    expect(await state(t)).toEqual(before);
  });

  test("rejects missing and invalid credentials, malformed requests and mismatched targets without writes", async () => {
    const t = fixture();
    for (const auth of ["", "Bearer wrong", token])
      for (const write of [false, true])
        expect((await call(t, write, {}, auth)).status).toBe(401);
    for (const overrides of [
      { email: "not-an-email" },
      { email: "a..b@example.test" },
      { email: "a@-example.test" },
      { extra: "unexpected" },
      { role: "admin" },
      { personId: "" },
    ])
      expect((await call(t, true, overrides)).status).toBe(400);
    expect((await call(t, true, { approvalDigest: "invalid" })).status).toBe(
      400,
    );
    for (const overrides of [
      { deployment: "other-123" },
      { appUrl: "https://other.example.test" },
    ])
      expect((await call(t, true, overrides)).status).toBe(409);
    expect((await call(t, true, { email: "x".repeat(5000) })).status).toBe(413);
    vi.stubEnv("EMPLOYEE_PROVISIONING_DEPLOYMENT", "wrong-host");
    expect((await call(t, true, { deployment: "wrong-host" })).status).toBe(
      409,
    );
    vi.stubEnv("EMPLOYEE_PROVISIONING_DEPLOYMENT", identity.deployment);
    vi.stubEnv("EMPLOYEE_PROVISIONING_SECRET", "");
    expect((await call(t, true)).status).toBe(503);
    expect((await state(t)).users).toHaveLength(0);
    expect((await state(t)).audits).toHaveLength(0);
  });

  test.each(["owner", "outside-domain"])(
    "blocks %s even for an absent employee",
    async (mode) => {
      const t = fixture();
      const changes =
        mode === "owner"
          ? { role: "owner" }
          : { email: "employee@outside.test" };
      for (const write of [false, true])
        expect(await (await call(t, write, changes)).json()).toMatchObject({
          status: "blocked",
          details: {
            reason:
              mode === "owner"
                ? "unsupported_role"
                : "email_domain_not_allowed",
          },
        });
      expect((await state(t)).users).toHaveLength(0);
    },
  );

  test.each([
    ["wrong role", "role_conflict"],
    ["disabled", "inactive_profile"],
    ["duplicate user", "duplicate_identity"],
    ["duplicate profile", "ambiguous_profile"],
    ["missing profile", "ambiguous_profile"],
    ["mismatched profile", "ambiguous_profile"],
    ["customer", "account_kind_conflict"],
    ["unknown kind", "account_kind_conflict"],
    ["membership", "customer_membership"],
    ["duplicate auth", "auth_identity_conflict"],
    ["service user", "invalid_identity"],
    ["missing auth", "missing_auth_identity"],
    ["orphan", "orphaned_identity"],
  ])("blocks %s without repairing or mutating it", async (scenario, reason) => {
    const t = fixture();
    const { userId, profileId, accountId } = await seed(t);
    await t.run(async (ctx) => {
      switch (scenario) {
        case "wrong role":
          await ctx.db.patch(profileId, { role: "owner" });
          break;
        case "disabled":
          await ctx.db.patch(profileId, { status: "disabled" });
          break;
        case "duplicate user":
          await ctx.db.insert("users", { email: "EMPLOYEE@EXAMPLE.TEST" });
          break;
        case "duplicate profile":
          await ctx.db.insert("operatorProfiles", {
            userId,
            email: identity.email,
            role: "operator",
            status: "active",
            createdAt: 1,
            updatedAt: 1,
          });
          break;
        case "missing profile":
          await ctx.db.delete(profileId);
          break;
        case "mismatched profile":
          await ctx.db.patch(profileId, { email: "different@example.test" });
          break;
        case "customer":
          await ctx.db.patch(userId, { accountKind: "customer" });
          break;
        case "unknown kind":
          await ctx.db.patch(userId, { accountKind: undefined });
          break;
        case "service user":
          await ctx.db.patch(userId, { serviceAccountKind: "slack" });
          break;
        case "membership": {
          const orgId = await ctx.db.insert("organizations", {
            name: "Synthetic Customer",
            type: "client",
          });
          await ctx.db.insert("orgMemberships", {
            orgId,
            userId,
            role: "member",
          });
          break;
        }
        case "duplicate auth":
          await ctx.db.insert("authAccounts", {
            userId,
            provider: "resend-otp",
            providerAccountId: identity.email,
          });
          break;
        case "missing auth":
          await ctx.db.delete(accountId);
          break;
        case "orphan":
          await ctx.db.delete(userId);
          break;
      }
    });
    const before = await state(t);
    for (const write of [false, true])
      expect(await (await call(t, write)).json()).toMatchObject({
        status: "blocked",
        details: { reason },
      });
    expect(await state(t)).toEqual(before);
  });

  test("creates unverified human access exactly once, including concurrent requests, and audits the service actor", async () => {
    const t = fixture();
    const responses = await Promise.all([
      call(t, true),
      call(t, true),
      call(t, true),
    ]);
    const results = await Promise.all(responses.map((r) => r.json()));
    expect(results.every((r) => r.status === "member")).toBe(true);
    expect(new Set(results.map((r) => r.remoteId)).size).toBe(1);
    const records = await state(t);
    for (const rows of [
      records.users,
      records.profiles,
      records.accounts,
      records.audits,
      records.requests,
    ])
      expect(rows).toHaveLength(1);
    expect(records.codes).toHaveLength(0);
    expect(records.sessions).toHaveLength(0);
    expect(records.users[0].emailVerificationTime).toBeUndefined();
    expect(records.accounts[0].emailVerified).toBeUndefined();
    expect(records.accounts[0].secret).toBeUndefined();
    expect(records.audits[0]).toMatchObject({
      serviceActor: "central_employee_provisioning",
      targetUserId: records.users[0]._id,
      metadata: {
        provisioningRequestId: approval.requestId,
        approvalDigest: approval.approvalDigest,
        outcome: "created",
      },
    });
    expect(records.audits[0].operatorUserId).toBeUndefined();
    expect(JSON.stringify(records)).not.toContain(token);
    await call(t, true);
    expect(await state(t)).toEqual(records);
  });

  test("adopts existing matching access and binds request and employee identity without modifying access", async () => {
    const t = fixture();
    await seed(t);
    const before = await state(t);
    expect(await (await call(t, true)).json()).toMatchObject({
      status: "member",
    });
    const after = await state(t);
    expect(after.users).toEqual(before.users);
    expect(after.profiles).toEqual(before.profiles);
    expect(after.accounts).toEqual(before.accounts);
    expect(after.audits[0].metadata.outcome).toBe("adopted");
    for (const overrides of [
      { approvalDigest: "c".repeat(64) },
      { email: "someone@example.test" },
      { role: "owner" },
    ]) {
      expect(await (await call(t, true, overrides)).json()).toMatchObject({
        status: "blocked",
        details: { reason: "request_identity_conflict" },
      });
    }
    for (const overrides of [
      { personId: "someone-else" },
      { email: "someone@example.test" },
    ])
      expect(await (await call(t, false, overrides)).json()).toMatchObject({
        status: "blocked",
        details: { reason: "person_identity_conflict" },
      });
    expect(await state(t)).toEqual(after);
    expect(
      await (await call(t, true, { requestId: "d".repeat(64) })).json(),
    ).toMatchObject({ status: "member" });
    expect((await state(t)).audits).toHaveLength(2);
  });

  test("fresh eligibility wins over a previously successful request or observation", async () => {
    const t = fixture();
    await call(t, true);
    expect(await (await call(t)).json()).toMatchObject({ status: "member" });
    const before = await state(t);
    await t.run((ctx) =>
      ctx.db.patch(before.profiles[0]._id, { status: "disabled" }),
    );
    expect(await (await call(t, true)).json()).toMatchObject({
      status: "blocked",
      details: { reason: "inactive_profile" },
    });
    expect((await state(t)).audits).toEqual(before.audits);
    await t.run(async (ctx) => {
      await ctx.db.delete(before.profiles[0]._id);
      await ctx.db.delete(before.accounts[0]._id);
      await ctx.db.delete(before.users[0]._id);
    });
    for (const write of [false, true])
      expect(await (await call(t, write)).json()).toMatchObject({
        status: "blocked",
        details: { reason: "previous_identity_missing" },
      });
    expect((await state(t)).users).toHaveLength(0);
  });

  test("different concurrent approved actions adopt a single employee identity", async () => {
    const t = fixture();
    const responses = await Promise.all([
      call(t, true),
      call(t, true, { requestId: "c".repeat(64) }),
    ]);
    const results = await Promise.all(
      responses.map((response) => response.json()),
    );
    expect(results.every((entry) => entry.status === "member")).toBe(true);
    const records = await state(t);
    expect(records.users).toHaveLength(1);
    expect(records.profiles).toHaveLength(1);
    expect(records.accounts).toHaveLength(1);
    expect(records.requests).toHaveLength(2);
    expect(
      records.audits.map((audit) => audit.metadata.outcome).sort(),
    ).toEqual(["adopted", "created"]);
  });

  test("fails closed when the case-insensitive directory scan cannot prove absence", async () => {
    const t = fixture();
    await t.run(async (ctx) => {
      for (let i = 0; i <= EMPLOYEE_DIRECTORY_LIMIT; i++)
        await ctx.db.insert("users", { email: `synthetic-${i}@example.test` });
    });
    expect(await (await call(t)).json()).toMatchObject({
      status: "blocked",
      details: { reason: "directory_limit" },
    });
  });
});

describe("operator OTP and legacy bootstrap", () => {
  test("first real Convex Auth OTP verification uses the provisioned user without a bootstrap allowlist", async () => {
    const t = fixture();
    await call(t, true);
    const before = await state(t);
    const email = identity.email;
    // Exercise the installed Auth store, bypassing only outbound email delivery.
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
    expect((await state(t)).users[0].emailVerificationTime).toBeUndefined();
    expect(
      await t.mutation(internal.auth.store, {
        args: {
          type: "verifyCodeAndSignIn",
          provider: "resend-otp",
          params: { email, code: "654321" },
          generateTokens: false,
          allowExtraProviders: false,
        },
      }),
    ).toBeNull();
    expect((await state(t)).sessions).toHaveLength(0);
    expect((await state(t)).users[0].emailVerificationTime).toBeUndefined();
    const signedIn = await t.mutation(internal.auth.store, {
      args: {
        type: "verifyCodeAndSignIn",
        provider: "resend-otp",
        params: { email, code: "123456" },
        generateTokens: false,
        allowExtraProviders: false,
      },
    });
    expect(signedIn).toMatchObject({ userId: before.users[0]._id });
    const after = await state(t);
    expect(after.users).toHaveLength(1);
    expect(after.accounts).toHaveLength(1);
    expect(after.users[0].emailVerificationTime).toBeTypeOf("number");
    const authenticated = t.withIdentity({
      subject: `${after.users[0]._id}|${after.sessions[0]._id}`,
    });
    expect(
      await authenticated.mutation(api.operator.bootstrapViewer, {}),
    ).toEqual({ ok: true, role: "operator" });
    expect((await state(t)).profiles).toEqual(before.profiles);
    expect((await state(t)).audits).toEqual(before.audits);
  });

  test("legacy initial bootstrap works, but login never escalates, downgrades or reactivates existing access", async () => {
    const t = fixture();
    vi.stubEnv("OPERATOR_BOOTSTRAP_EMAILS", identity.email);
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", {
        email: identity.email,
        emailVerificationTime: 1,
      }),
    );
    const authenticated = t.withIdentity({ subject: `${userId}|session` });
    expect(
      await authenticated.mutation(api.operator.bootstrapViewer, {}),
    ).toEqual({ ok: true, role: "operator" });
    vi.stubEnv("OPERATOR_OWNER_EMAILS", identity.email);
    expect(
      await authenticated.mutation(api.operator.bootstrapViewer, {}),
    ).toEqual({ ok: true, role: "operator" });
    const profile = (await state(t)).profiles[0];
    await t.run((ctx) => ctx.db.patch(profile._id, { role: "owner" }));
    vi.stubEnv("OPERATOR_OWNER_EMAILS", "");
    expect(
      await authenticated.mutation(api.operator.bootstrapViewer, {}),
    ).toEqual({ ok: true, role: "owner" });
    await t.run((ctx) => ctx.db.patch(profile._id, { status: "disabled" }));
    await expect(
      authenticated.mutation(api.operator.bootstrapViewer, {}),
    ).rejects.toThrow();
    expect((await state(t)).profiles[0]).toMatchObject({
      role: "owner",
      status: "disabled",
    });
    expect((await state(t)).audits).toHaveLength(1);
  });
});
