/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { resolveChannelPreference } from "./notificationPreferences";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function fixture() {
  const t = convexTest(schema, modules);
  const tokenHash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode("synthetic-invitation-token"),
      ),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const ids = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", {
      name: "Owner",
      accountKind: "customer",
    });
    const member = await ctx.db.insert("users", {
      name: "Member",
      accountKind: "customer",
    });
    const outsider = await ctx.db.insert("users", {
      name: "Other owner",
      accountKind: "customer",
    });
    const org = await ctx.db.insert("organizations", {
      name: "Client",
      type: "client",
    });
    const otherOrg = await ctx.db.insert("organizations", {
      name: "Other client",
      type: "client",
    });
    await ctx.db.insert("orgMemberships", {
      orgId: org,
      userId: owner,
      role: "admin",
    });
    await ctx.db.insert("orgMemberships", {
      orgId: org,
      userId: member,
      role: "member",
    });
    await ctx.db.insert("orgMemberships", {
      orgId: otherOrg,
      userId: outsider,
      role: "admin",
    });
    const relationship = await ctx.db.insert("connectedOrgRelationships", {
      clientOrgId: org,
      vendorOrgId: otherOrg,
      status: "pending",
      requestedByUserId: owner,
      createdAt: dayjs().valueOf(),
      updatedAt: dayjs().valueOf(),
    });
    const invitation = await ctx.db.insert("connectedOrgInvitations", {
      clientOrgId: org,
      vendorOrgId: otherOrg,
      relationshipId: relationship,
      vendorEmail: "vendor@example.invalid",
      requestedByUserId: owner,
      inviteTokenHash: tokenHash,
      status: "pending",
      otpCode: "123456",
      expiresAt: dayjs().add(1, "day").valueOf(),
      createdAt: dayjs().valueOf(),
      updatedAt: dayjs().valueOf(),
    });
    return { owner, member, outsider, org, otherOrg, relationship, invitation };
  });
  return {
    t,
    ...ids,
    client: t.withIdentity({ subject: `${ids.owner}|session` }),
    memberClient: t.withIdentity({ subject: `${ids.member}|session` }),
    otherClient: t.withIdentity({ subject: `${ids.outsider}|session` }),
  };
}

test("only the requesting tenant admin can cancel an invitation, invalidating pending access and OTP", async () => {
  const f = await fixture();
  const args = { invitationId: f.invitation };
  await expect(
    f.memberClient.mutation(api.connectedOrgs.revokeInvitation, args),
  ).rejects.toThrow();
  await expect(
    f.otherClient.mutation(api.connectedOrgs.revokeInvitation, args),
  ).rejects.toThrow();
  await f.client.mutation(api.connectedOrgs.revokeInvitation, args);
  await expect(
    f.otherClient.mutation(api.connectedOrgs.acceptInvitation, {
      token: "synthetic-invitation-token",
    }),
  ).rejects.toThrow("no longer pending");
  await f.client.mutation(api.connectedOrgs.revokeInvitation, args);
  await f.t.run(async (ctx) => {
    const invitation = await ctx.db.get(f.invitation);
    expect(invitation?.status).toBe("revoked");
    expect(invitation?.otpCode).toBeUndefined();
    expect((await ctx.db.get(f.relationship))?.status).toBe("revoked");
  });
});

test("revoking a relationship also invalidates its pending invitation", async () => {
  const f = await fixture();
  await f.client.mutation(api.connectedOrgs.revoke, {
    relationshipId: f.relationship,
  });
  await expect(
    f.otherClient.mutation(api.connectedOrgs.acceptInvitation, {
      token: "synthetic-invitation-token",
    }),
  ).rejects.toThrow("no longer pending");
  expect(
    await f.t.run(async (ctx) => (await ctx.db.get(f.invitation))?.status),
  ).toBe("revoked");
});

test("notification reset restores inheritance without changing another user's or tenant's preferences", async () => {
  const f = await fixture();
  const args = {
    orgId: f.org,
    type: "mailbox_attention",
    email: true,
    imessage: false,
  };
  await f.client.mutation(api.notificationPreferences.setAllEmail, {
    orgId: f.org,
    enabled: false,
  });
  await f.client.mutation(api.notificationPreferences.setChannels, args);
  await f.memberClient.mutation(api.notificationPreferences.setChannels, args);
  await expect(
    f.otherClient.mutation(api.notificationPreferences.resetChannels, {
      orgId: f.org,
      type: args.type,
    }),
  ).rejects.toThrow();
  await f.client.mutation(api.notificationPreferences.resetChannels, {
    orgId: f.org,
    type: args.type,
  });
  const preferences = await f.t.run(async (ctx) =>
    ctx.db.query("notificationPreferences").collect(),
  );
  expect(
    preferences.filter((p) => p.userId === f.owner && p.type === args.type),
  ).toHaveLength(0);
  expect(
    preferences.filter((p) => p.userId === f.member && p.type === args.type),
  ).toHaveLength(2);
  expect(
    await f.t.run((ctx) =>
      resolveChannelPreference(ctx, {
        orgId: f.org,
        userId: f.owner,
        type: args.type,
        channel: "email",
        severity: "warning",
      }),
    ),
  ).toBe(false);
  await f.client.mutation(api.notificationPreferences.resetChannels, {
    orgId: f.org,
    type: "__all__",
    channel: "email",
  });
  expect(
    await f.client.query(api.notificationPreferences.getForUser, {
      orgId: f.org,
    }),
  ).toHaveLength(0);
});
