/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { buildPreviewDocument } from "./actions/renderEmailPreview";
import { buildPendingEmailResendPayload } from "./lib/emailDelivery";
import { pendingEmailCanonicalPatch } from "./lib/emailPayloadFields";
import { pendingEmailDraftFingerprint } from "./lib/actionConfirmationFingerprint";

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

test.each(["canonical", "legacy"] as const)(
  "previews the same recipients and body that are delivered for %s draft content",
  async (contentSource) => {
    const t = convexTest(schema, modules);
    vi.stubEnv("EMAIL_DELIVERY_MODE", "live");
    vi.stubEnv("AUTH_RESEND_KEY", "test");
    const fetchMock = vi.fn(async () => Response.json({ id: "sent-preview" }));
    vi.stubGlobal("fetch", fetchMock);
    const canonical = contentSource === "canonical";
    const id = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Cove",
        type: "client",
      });
      return ctx.db.insert("pendingEmails", {
        orgId,
        status: "draft",
        recipientEmail: "current@example.com",
        subject: "Current subject",
        emailBody: "Current body",
        emailPayload: JSON.stringify({
          from: "Spot <cove@agent.spot.insure>",
          to: "stale@example.com",
          subject: "Stale subject",
          text: "Legacy body",
          html: "<p>Legacy body</p>",
          cc: ["legacy-copy@example.com"],
          bcc: ["legacy-blind@example.com"],
        }),
        ...(canonical
          ? {
              renderedText: "Current body",
              renderedHtml: "<p>Current body</p>",
              ccAddresses: [],
              bccAddresses: [],
            }
          : {}),
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
      text: canonical ? "Current body" : "Legacy body",
      html: canonical ? "<p>Current body</p>" : "<p>Legacy body</p>",
    });
    expect(preview).toContain(delivered.to);
    expect(preview).toContain(delivered.subject);
    expect(preview).toContain(delivered.html);
    expect(preview).not.toContain("stale@example.com");
    expect(preview).not.toContain("Stale subject");
    if (canonical) {
      expect(delivered.cc).toBeUndefined();
      expect(delivered.bcc).toBeUndefined();
      expect(preview).not.toContain("Legacy body");
      expect(preview).not.toContain("legacy-copy@example.com");
      expect(preview).not.toContain("legacy-blind@example.com");
    } else {
      expect(delivered.cc).toEqual(["legacy-copy@example.com"]);
      expect(delivered.bcc).toEqual(["legacy-blind@example.com"]);
      expect(preview).toContain("legacy-copy@example.com");
      expect(preview).toContain("legacy-blind@example.com");
    }
  },
);

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
      emailPayload: JSON.stringify({ cc: ["old-copy@example.com"], bcc: ["old-blind@example.com"] }),
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
  expect(draft.emailPayload).toBeUndefined();
  expect(buildPendingEmailResendPayload(draft, { outboundMessageId: "new-message" })).toEqual({
    from: "Spot <cove@agent.spot.insure>",
    to: "recipient@example.com",
    subject: "New subject",
    text: "New body",
    html: undefined,
    headers: { "Message-ID": "new-message" },
  });
});

test.each([
  {},
  { "In-Reply-To": "legacy-parent" },
  { "In-Reply-To": "legacy-parent", References: "legacy-root legacy-parent" },
])("canonical migration preserves the approved envelope, attachments, and fingerprint: %j", async (headers) => {
  const t = convexTest(schema, modules);
  const id = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", { name: "Cove", type: "client" });
    const fileId = await ctx.storage.store(new Blob(["attachment"]));
    return ctx.db.insert("pendingEmails", {
      orgId,
      status: "draft",
      recipientEmail: "recipient@example.com",
      ccAddresses: [],
      bccAddresses: ["blind@example.com"],
      subject: "Approved subject",
      emailBody: "Approved body",
      emailPayload: JSON.stringify({
        from: "Spot <cove@agent.spot.insure>",
        reply_to: "cove+thread@agent.spot.insure",
        to: "stale@example.com",
        cc: ["stale-copy@example.com"],
        bcc: ["blind@example.com"],
        text: "Approved body\nApproved signature",
        html: "<p>Approved body</p><p>Approved signature</p>",
        headers,
      }),
      attachments: [{ fileId, filename: "approved.txt", contentType: "text/plain", size: 10 }],
      scheduledSendTime: 0,
    });
  });
  const before = await t.run((ctx) => ctx.db.get(id));
  if (!before) throw new Error("Draft missing");
  const patch = pendingEmailCanonicalPatch(before);
  if (!patch) throw new Error("Migration missing");
  await t.run((ctx) => ctx.db.patch(id, patch));
  const after = await t.run((ctx) => ctx.db.get(id));
  if (!after) throw new Error("Draft missing");
  const options = { outboundMessageId: "approved-message" };
  expect(buildPendingEmailResendPayload(after, options)).toEqual(buildPendingEmailResendPayload(before, options));
  expect(buildPreviewDocument(after)).toEqual(buildPreviewDocument(before));
  expect(await pendingEmailDraftFingerprint(after)).toBe(await pendingEmailDraftFingerprint(before));
  expect(after.attachments).toEqual(before.attachments);
  expect(pendingEmailCanonicalPatch(after)).toBeNull();
});
