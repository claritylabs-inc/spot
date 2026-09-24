/// <reference types="vite/client" />
import dayjs from "dayjs";
import { convexTest } from "convex-test";
import { expect, test, describe, vi } from "vitest";
import schema from "../schema";
import { send } from "./sendNotificationEmail";

const modules = import.meta.glob("../**/*.ts");

const sendFn = send as any;

describe("sendNotificationEmail", () => {
  test("sets emailStatus=suppressed_by_preference when all recipients have email disabled", async () => {
    const t = convexTest(schema, modules);

    const orgId = await t.run(async (ctx) =>
      ctx.db.insert("organizations", { name: "Broker Co", type: "broker" }),
    );
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { name: "Bob", email: "bob@broker.co" }),
    );
    await t.run(async (ctx) =>
      ctx.db.insert("orgMemberships", { orgId, userId, role: "member" }),
    );
    await t.run(async (ctx) =>
      ctx.db.insert("notificationPreferences", {
        userId,
        orgId,
        type: "__all__",
        channel: "email",
        enabled: false,
        updatedAt: dayjs().valueOf(),
      }),
    );

    const notifId = await t.run(async (ctx) =>
      ctx.db.insert("notifications", {
        orgId,
        type: "client_invitation_accepted",
        title: "Client joined",
        body: "Acme Co accepted the invitation.",
        severity: "info",
        status: "unread",
        emailStatus: "scheduled",
        createdAt: dayjs().valueOf(),
      }),
    );

    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    await t.action(sendFn, { notificationId: notifId });

    const notif = await t.run(async (ctx) => ctx.db.get(notifId));
    expect(notif?.emailStatus).toBe("suppressed_by_preference");
    expect(mockFetch).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("sets emailStatus=failed after Resend error, retries exhausted", async () => {
    const t = convexTest(schema, modules);

    const orgId = await t.run(async (ctx) =>
      ctx.db.insert("organizations", { name: "Broker Co", type: "broker" }),
    );
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { name: "Bob", email: "bob@broker.co" }),
    );
    await t.run(async (ctx) =>
      ctx.db.insert("orgMemberships", { orgId, userId, role: "member" }),
    );

    const notifId = await t.run(async (ctx) =>
      ctx.db.insert("notifications", {
        orgId,
        type: "incomplete_extraction",
        title: "Policy extraction needs review",
        body: "The extraction needs attention.",
        severity: "warning",
        status: "unread",
        emailStatus: "scheduled",
        createdAt: dayjs().valueOf(),
      }),
    );

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      text: async () => "Rate limit exceeded",
    });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("AUTH_RESEND_KEY", "test-resend-key");

    await t.action(sendFn, { notificationId: notifId });

    expect(mockFetch).toHaveBeenCalledTimes(3); // 3 retries
    const notif = await t.run(async (ctx) => ctx.db.get(notifId));
    expect(notif?.emailStatus).toBe("failed");

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("omits Reply-To when a thread email uses an untrusted domain", async () => {
    const t = convexTest(schema, modules);
    const { notificationId } = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Acme",
        type: "client",
      });
      const userId = await ctx.db.insert("users", {
        name: "Alice",
        email: "alice@acme.co",
      });
      await ctx.db.insert("orgMemberships", {
        orgId,
        userId,
        role: "admin",
      });
      const threadId = await ctx.db.insert("threads", {
        orgId,
        title: "Mailbox review",
        createdBy: userId,
        lastMessageAt: dayjs().valueOf(),
        threadEmail: "agent+mailbox@attacker.example",
        originChannel: "chat",
      });
      const notificationId = await ctx.db.insert("notifications", {
        orgId,
        userId,
        type: "mailbox_attention",
        title: "Mailbox item needs attention",
        body: "Spot found an item to review.",
        severity: "warning",
        status: "unread",
        emailStatus: "scheduled",
        actionType: "view_thread",
        actionPayload: { threadId },
        createdAt: dayjs().valueOf(),
      });
      return { notificationId };
    });
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: "resend-msg-untrusted" }),
    });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("AUTH_RESEND_KEY", "test-resend-key");

    await t.action(sendFn, { notificationId });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody).not.toHaveProperty("reply_to");

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

});
