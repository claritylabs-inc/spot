// @vitest-environment node
/// <reference types="vite/client" />

import { generateKeyPairSync } from "node:crypto";
import { Resolver } from "node:dns/promises";
import { dkimSign } from "mailauth";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const dnsKey = publicKey
  .export({ type: "spki", format: "der" })
  .toString("base64");

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const forwarded = [
  "> Begin forwarded message:",
  ">",
  "> From: Dan <dan@example.com>",
  "> Subject: Insurance documents",
  "> Date: September 14, 2026 at 12:38 PM EDT",
  "> To: terry@claritylabs.inc",
  ">",
  "> Keep these documents private.",
].join("\n");
const quoted = `On Mon, Sep 14, 2026, Spot <operator@agent.spot.insure> wrote:\n> Approval required.\n>\n${forwarded}`;

test.each([
  ["", ""],
  ["Focus on the next 30 days.", "Focus on the next 30 days."],
  [
    `Yes approve it\n\nTerry Wang\nterry@claritylabs.inc\n\n${quoted}`,
    "Yes approve it",
  ],
  [`Add this context.\n\n${forwarded}`, "Add this context."],
  [forwarded, ""],
])(
  "queues the authenticated subject as part of the operator request with body %j",
  async (body, currentText) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.stubEnv("AUTH_RESEND_KEY", "test");
    vi.spyOn(Resolver.prototype, "resolveTxt").mockResolvedValue([
      [`v=DKIM1; k=rsa; p=${dnsKey}`],
    ]);
    const subject = "Summarize Cove's renewals";
    const raw = [
      "From: Terry <terry@claritylabs.inc>",
      "To: operator@agent.spot.insure",
      `Subject: ${subject}`,
      "Message-ID: <subject-request@claritylabs.inc>",
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      body,
      "",
    ].join("\r\n");
    const signing = {
      signingDomain: "claritylabs.inc",
      selector: "operator-test",
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
    };
    const { signatures } = await dkimSign(raw, {
      ...signing,
      signatureData: [signing],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "https://api.resend.com/emails/receiving/received-1") {
          return Response.json({
            subject: "Untrusted provider metadata",
            raw: { download_url: "https://mail.example.test/raw" },
          });
        }
        if (url === "https://mail.example.test/raw") {
          return new Response(signatures + raw);
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("operatorEmailIdentityBackfill", {
        key: "legacy",
        completedAt: 1,
      });
      const userId = await ctx.db.insert("users", {
        email: "terry@claritylabs.inc",
        accountKind: "operator",
        emailVerificationTime: 1,
      });
      await ctx.db.insert("operatorProfiles", {
        userId,
        email: "terry@claritylabs.inc",
        role: "operator",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
    });

    await t.action(internal.actions.handleInboundOperatorEmail.processInbound, {
      emailId: "received-1",
    });

    await t.run(async (ctx) => {
      const receipt = await ctx.db.query("operatorEmailReceipts").unique();
      const run = await ctx.db.get(receipt!.runId);
      const message = await ctx.db.get(run!.userMessageId);
      expect(message!.content).toContain(subject);
      expect(message!.emailContent?.currentText).toContain(currentText);
      if (body.includes("Yes approve it")) {
        expect(message!.content).not.toContain("Keep these documents private.");
        expect(message!.emailContent?.quotedText).toContain(
          "Keep these documents private.",
        );
        expect(message!.emailContent?.forwarded).toBeUndefined();
      }
      if (body.startsWith("Add this context.") || body === forwarded) {
        expect(message!.emailContent?.quotedText).toBeUndefined();
        expect(message!.content).toContain("FORWARDED EMAIL CONTEXT");
        expect(message!.emailContent?.forwarded?.email).toMatchObject({
          from: { address: "dan@example.com", name: "Dan" },
          subject: "Insurance documents",
          body: "Keep these documents private.",
        });
      }
      expect(message!.content).not.toContain("Untrusted provider metadata");
      expect(run!.objective).toBe(message!.content);
      expect(run!.status).toBe("queued");
    });
  },
);
