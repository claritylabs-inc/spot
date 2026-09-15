/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { buildPreviewDocument } from "./actions/renderEmailPreview";
import { buildPendingEmailResendPayload } from "./lib/emailDelivery";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test.each([
  { fromHeader: "Spot <cove@spot.insure>" },
  { replyTo: "cove+renewal@spot.insure" },
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
      fromHeader: "Spot <cove@agent.spot.insure>",
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
  const orgId = await t.run((ctx) => ctx.db.insert("organizations", {
    name: "Cove",
    type: "client",
  }));
  const id = await t.mutation(internal.pendingEmails.create, {
    orgId,
    status: "draft",
    recipientEmail: "terry@spot.insure",
    subject: "Renewal evidence",
    emailBody: "Please review this evidence.",
    fromHeader: "Spot <cove@agent.spot.insure>",
    replyTo: "cove+renewal@agent.spot.insure",
    scheduledSendTime: 0,
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

test.each([
  { cc: [], bcc: [], references: "" },
  { cc: ["copy@example.com"], bcc: ["blind@example.com"], references: "root parent" },
])("previews the exact delivered body and recipients: %j", async ({ cc, bcc, references }) => {
  const t = convexTest(schema, modules);
  vi.stubEnv("EMAIL_DELIVERY_MODE", "live");
  vi.stubEnv("AUTH_RESEND_KEY", "test");
  const fetchMock = vi.fn(async () => Response.json({ id: "sent-preview" }));
  vi.stubGlobal("fetch", fetchMock);
  const id = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", { name: "Cove", type: "client" });
    return ctx.db.insert("pendingEmails", {
      orgId,
      status: "draft",
      recipientEmail: "current@example.com",
      subject: "Current subject",
      emailBody: "Current body",
      fromHeader: "Spot <cove@agent.spot.insure>",
      renderedText: "Current body\nApproved signature",
      renderedHtml: "<p>Current body</p><p>Approved signature</p>",
      ccAddresses: cc,
      bccAddresses: bcc,
      inReplyTo: "parent",
      references,
      scheduledSendTime: 0,
    });
  });
  const draft = await t.run((ctx) => ctx.db.get(id));
  if (!draft) throw new Error("Draft missing");
  const preview = buildPreviewDocument(draft);

  await t.action(internal.actions.sendPendingEmail.sendDraftInternal, {
    id,
    authorization: { kind: "mcp_explicit_action" },
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  const delivered = JSON.parse(options.body as string);
  expect(delivered).toMatchObject({
    to: "current@example.com",
    subject: "Current subject",
    text: "Current body\nApproved signature",
    html: "<p>Current body</p><p>Approved signature</p>",
    headers: { "In-Reply-To": "parent" },
  });
  expect(delivered.headers.References).toBe(references || undefined);
  expect(delivered.cc).toEqual(cc.length ? cc : undefined);
  expect(delivered.bcc).toEqual(bcc.length ? bcc : undefined);
  for (const value of [delivered.to, delivered.subject, delivered.html, ...cc, ...bcc]) {
    expect(preview).toContain(value);
  }
});

test("replacing a draft clears removed recipients, attachments, and reply headers", async () => {
  const t = convexTest(schema, modules);
  const id = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", { name: "Cove", type: "client" });
    const fileId = await ctx.storage.store(new Blob(["attachment"]));
    return ctx.db.insert("pendingEmails", {
      orgId,
      status: "draft",
      recipientEmail: "recipient@example.com",
      ccAddresses: ["old-copy@example.com"],
      bccAddresses: ["old-blind@example.com"],
      subject: "Old subject",
      emailBody: "Old body",
      fromHeader: "Spot <cove@agent.spot.insure>",
      replyTo: "cove+old@agent.spot.insure",
      inReplyTo: "old-parent",
      references: "old-parent",
      renderedText: "Old rendering",
      renderedHtml: "<p>Old rendering</p>",
      attachments: [{ fileId, filename: "old.txt", contentType: "text/plain", size: 10 }],
      scheduledSendTime: 0,
    });
  });
  await t.mutation(internal.pendingEmails.updateDraftInternal, {
    id,
    recipientEmail: "recipient@example.com",
    fromHeader: "Spot <cove@agent.spot.insure>",
    subject: "New subject",
    emailBody: "New body",
  });
  const draft = await t.run((ctx) => ctx.db.get(id));
  if (!draft) throw new Error("Draft missing");
  expect(draft.attachments).toBeUndefined();
  expect(buildPendingEmailResendPayload(draft, { outboundMessageId: "new-message" })).toEqual({
    from: "Spot <cove@agent.spot.insure>",
    to: "recipient@example.com",
    subject: "New subject",
    text: "New body",
    html: undefined,
    headers: { "Message-ID": "new-message" },
  });
});
