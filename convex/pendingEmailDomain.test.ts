/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test.each([
  { fromHeader: "Spot <cove@spot.insure>" },
  { replyTo: "cove+renewal@spot.insure" },
  { emailPayload: JSON.stringify({ from: "Spot <cove@spot.insure>" }) },
])("blocks a retired draft address before delivery without altering the approved snapshot: %j", async (stale) => {
  const t = convexTest(schema, modules);
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const id = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Cove",
      type: "client",
    });
    return ctx.db.insert("pendingEmails", {
      orgId,
      status: "draft",
      recipientEmail: "terry@spot.insure",
      subject: "Renewal evidence",
      emailBody: "Please review this evidence.",
      emailPayload: JSON.stringify({ from: "Spot <cove@agent.spot.insure>" }),
      scheduledSendTime: 0,
      ...stale,
    });
  });
  const before = await t.run((ctx) => ctx.db.get(id));

  await expect(t.action(internal.actions.sendPendingEmail.sendDraftInternal, {
    id,
    authorization: { kind: "mcp_explicit_action" },
  })).rejects.toThrow(/Regenerate the draft.*review it before sending/);

  expect(fetchMock).not.toHaveBeenCalled();
  expect(await t.run((ctx) => ctx.db.get(id))).toEqual(before);
  expect(await t.run((ctx) => ctx.db.query("emailDeliveryAttempts").collect()))
    .toHaveLength(0);
});

test("sends a regenerated draft from the current agent domain while preserving human root-domain recipients", async () => {
  const t = convexTest(schema, modules);
  vi.stubEnv("EMAIL_DELIVERY_MODE", "live");
  vi.stubEnv("AUTH_RESEND_KEY", "test");
  const fetchMock = vi.fn(async () => Response.json({ id: "sent-1" }));
  vi.stubGlobal("fetch", fetchMock);
  const id = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Cove",
      type: "client",
    });
    return ctx.db.insert("pendingEmails", {
      orgId,
      status: "draft",
      recipientEmail: "terry@spot.insure",
      subject: "Renewal evidence",
      emailBody: "Please review this evidence.",
      emailPayload: JSON.stringify({
        from: "Spot <cove@agent.spot.insure>",
        reply_to: "cove+renewal@agent.spot.insure",
      }),
      scheduledSendTime: 0,
    });
  });

  await t.action(internal.actions.sendPendingEmail.sendDraftInternal, {
    id,
    authorization: { kind: "mcp_explicit_action" },
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(options.body as string)).toMatchObject({
    from: "Spot <cove@agent.spot.insure>",
    reply_to: "cove+renewal@agent.spot.insure",
    to: "terry@spot.insure",
  });
  expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ status: "sent" });
});
