"use node";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import {
  classifyDocumentType,
  extractFromPdf,
  extractQuoteFromPdf,
  applyExtracted,
  applyExtractedQuote,
  buildAgentSystemPrompt,
  buildDocumentContext,
} from "@claritylabs/cl-sdk";
import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";

// ── Helpers ──

function detectCategory(extracted: any): "auto" | "tenant" | "other" {
  const text = JSON.stringify(extracted).toLowerCase();
  const autoKeywords = [
    "auto", "automobile", "vehicle", "car", "collision", "comprehensive",
    "bodily injury", "uninsured motorist", "underinsured", "motor", "driver",
    "vin", "garage",
  ];
  const tenantKeywords = [
    "tenant", "renter", "renters", "dwelling", "personal property",
    "habitational", "apartment", "lease", "landlord", "contents",
  ];
  const autoScore = autoKeywords.filter((k) => text.includes(k)).length;
  const tenantScore = tenantKeywords.filter((k) => text.includes(k)).length;
  if (autoScore > tenantScore && autoScore >= 2) return "auto";
  if (tenantScore > autoScore && tenantScore >= 2) return "tenant";
  return "other";
}

function buildPolicySummary(applied: any): string {
  const parts: string[] = [];
  if (applied.carrier) parts.push(`${applied.carrier}`);
  if (applied.policyNumber) parts.push(`Policy #${applied.policyNumber}`);
  if (applied.effectiveDate && applied.expirationDate) {
    parts.push(`${applied.effectiveDate} → ${applied.expirationDate}`);
  }
  if (applied.premium) parts.push(`Premium: ${applied.premium}`);

  let summary = parts.join(" · ");

  if (applied.coverages && applied.coverages.length > 0) {
    const topCoverages = applied.coverages
      .slice(0, 4)
      .map((c: any) => {
        let line = `· ${c.name}`;
        if (c.limit) line += ` — ${c.limit}`;
        return line;
      })
      .join("\n");
    summary += `\n\n${topCoverages}`;
  }
  return summary;
}

function parseCategoryInput(input: string): "auto" | "tenant" | "other" | null {
  const clean = input.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  if (!clean) return null;

  if (clean === "1") return "auto";
  if (clean === "2") return "tenant";
  if (clean === "3") return "other";

  const autoWords = ["auto", "car", "vehicle", "driving"];
  const tenantWords = ["renter", "tenant", "rental", "apartment", "renters"];
  const otherWords = ["other", "something else", "neither", "different"];

  if (autoWords.some((w) => clean.includes(w))) return "auto";
  if (tenantWords.some((w) => clean.includes(w))) return "tenant";
  if (otherWords.some((w) => clean.includes(w))) return "other";

  return null;
}

async function sendAndLog(ctx: any, userId: any, phone: string, body: string) {
  await ctx.runAction(internal.send.sendSms, { to: phone, body });
  await ctx.runMutation(internal.messages.log, {
    userId,
    direction: "outbound",
    body,
    hasAttachment: false,
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendBurst(ctx: any, userId: any, phone: string, messages: string[]) {
  for (let i = 0; i < messages.length; i++) {
    if (i > 0) await sleep(800 + Math.random() * 700); // 0.8–1.5s pause
    await sendAndLog(ctx, userId, phone, messages[i]);
  }
}

function getUploadLink(uploadToken: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://secure.claritylabs.inc";
  return `${baseUrl}/upload/${uploadToken}`;
}

// ── Journey ──

export const sendWelcome = internalAction({
  args: { userId: v.id("users"), phone: v.string(), uploadToken: v.string() },
  handler: async (ctx, args) => {
    await sendBurst(ctx, args.userId, args.phone, [
      "Hey! This is Spot 👋",
      "I can go through your insurance policy and tell you exactly what you're covered for",
      "Is it auto, renters, or something else?",
    ]);
  },
});

export const handleCategorySelection = internalAction({
  args: {
    userId: v.id("users"),
    phone: v.string(),
    input: v.string(),
    uploadToken: v.string(),
    hasAttachment: v.boolean(),
    mediaUrl: v.optional(v.string()),
    mediaType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.hasAttachment && args.mediaUrl) {
      await ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "active",
      });
      await ctx.runAction(internal.process.processPolicy, {
        userId: args.userId,
        mediaUrl: args.mediaUrl,
        mediaType: args.mediaType || "application/pdf",
        phone: args.phone,
      });
      return;
    }

    const category = parseCategoryInput(args.input);

    if (!category) {
      await sendAndLog(
        ctx,
        args.userId,
        args.phone,
        `Haha no worries, is it auto, renters, or something else?`
      );
      return;
    }

    await ctx.runMutation(internal.users.updateState, {
      userId: args.userId,
      state: "awaiting_policy",
      preferredCategory: category,
    });

    const labels: Record<string, string> = {
      auto: "auto",
      tenant: "renter's",
      other: "",
    };
    const label = labels[category];
    const link = getUploadLink(args.uploadToken);

    if (category === "other") {
      await sendBurst(ctx, args.userId, args.phone, [
        "Works for me",
        `Drop your policy here and I'll take a look`,
        link,
      ]);
    } else {
      await sendBurst(ctx, args.userId, args.phone, [
        `${label}, got it`,
        "Drop your policy here and I'll go through it",
        link,
      ]);
    }
  },
});

export const nudgeForPolicy = internalAction({
  args: {
    userId: v.id("users"),
    phone: v.string(),
    input: v.string(),
    uploadToken: v.string(),
  },
  handler: async (ctx, args) => {
    const category = parseCategoryInput(args.input);
    if (category) {
      await ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "awaiting_policy",
        preferredCategory: category,
      });
      const link = getUploadLink(args.uploadToken);
      await sendAndLog(
        ctx,
        args.userId,
        args.phone,
        `No problem. Drop that one here\n\n${link}`
      );
      return;
    }

    const link = getUploadLink(args.uploadToken);
    await sendAndLog(
      ctx,
      args.userId,
      args.phone,
      `I'll need to see the policy first — you can drop it here\n\n${link}`
    );
  },
});

// ── Policy Processing ──

export const processPolicy = internalAction({
  args: {
    userId: v.id("users"),
    mediaUrl: v.string(),
    mediaType: v.string(),
    phone: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      await sendAndLog(
        ctx,
        args.userId,
        args.phone,
        "Got it, one sec"
      );

      const response = await fetch(args.mediaUrl);
      const buffer = await response.arrayBuffer();
      const pdfBase64 = Buffer.from(buffer).toString("base64");

      const blob = new Blob([buffer], { type: args.mediaType });
      const storageId = await ctx.storage.store(blob);

      const { documentType } = await classifyDocumentType(pdfBase64);

      const policyId = await ctx.runMutation(internal.policies.create, {
        userId: args.userId,
        category: "other",
        documentType,
        pdfStorageId: storageId,
      });

      let extracted: any;
      let applied: any;

      if (documentType === "quote") {
        const result = await extractQuoteFromPdf(pdfBase64);
        extracted = result.extracted;
        applied = applyExtractedQuote(extracted);
      } else {
        const result = await extractFromPdf(pdfBase64);
        extracted = result.extracted;
        applied = applyExtracted(extracted);
      }

      const detectedCategory = detectCategory(applied);

      await ctx.runMutation(internal.policies.updateExtracted, {
        policyId,
        carrier: applied.carrier || undefined,
        policyNumber: applied.policyNumber || undefined,
        effectiveDate: applied.effectiveDate || undefined,
        expirationDate: applied.expirationDate || undefined,
        premium: applied.premium || undefined,
        insuredName: applied.insuredName || undefined,
        coverages: applied.coverages || undefined,
        rawExtracted: applied,
        category: detectedCategory,
        status: "ready",
      });

      await ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "active",
      });

      const summary = buildPolicySummary(applied);
      const isQuote = documentType === "quote";

      await sendBurst(ctx, args.userId, args.phone, [
        `Ok so here's what you've got${isQuote ? " in that quote" : ""}`,
        summary,
        "That's the main stuff — you can ask me anything about it",
      ]);
    } catch (error: any) {
      console.error("Policy processing failed:", error);
      await sendAndLog(
        ctx,
        args.userId,
        args.phone,
        "Hmm I couldn't read that one, can you try again? PDF works best"
      );
    }
  },
});

// ── Conversational Q&A ──

export const handleQuestion = internalAction({
  args: {
    userId: v.id("users"),
    question: v.string(),
    phone: v.string(),
    uploadToken: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const policies = await ctx.runQuery(internal.policies.getByUser, {
        userId: args.userId,
      });

      const readyPolicies = policies.filter((p: any) => p.status === "ready");

      if (readyPolicies.length === 0) {
        const link = getUploadLink(args.uploadToken);
        await sendAndLog(
          ctx,
          args.userId,
          args.phone,
          `I don't have a policy from you yet, drop one here and I'll check it out\n\n${link}`
        );
        return;
      }

      const sdkPrompt = buildAgentSystemPrompt({
        platform: "sms",
        intent: "direct",
        companyName: "Spot",
        siteUrl: "https://secure.claritylabs.inc",
        coiHandling: "ignore",
      });

      const complianceGuardrails = `
Your name is Spot. You're a chill, helpful insurance assistant that talks like a real person over text.

Rules:
- Talk naturally. Short sentences. No corporate speak. You're texting, not writing an email.
- You help people understand their own insurance policies — that's it.
- Don't sell, recommend, or solicit any insurance products.
- Don't give financial, investment, or legal advice.
- Don't discuss debt, gambling, drugs, alcohol, tobacco, firearms, or age-restricted content.
- Don't send links or promotional content.
- If someone asks about something outside their policy, keep it light: "That's a bit outside my lane — I'm best at breaking down what's in your policy."
- Be direct. If the answer is in their policy, just say it. If it's not, say that.
- Use plain language. If their policy says "comprehensive" explain what that actually means in normal words.
`;

      const docs = readyPolicies.map((p: any) => p.rawExtracted);
      const { context: documentContext } = buildDocumentContext(docs, [], args.question);

      const anthropic = createAnthropic();
      const { text } = await generateText({
        model: anthropic("claude-sonnet-4-6"),
        system: `${complianceGuardrails}\n\n${sdkPrompt}\n\nHere are the user's insurance documents:\n${documentContext}`,
        prompt: args.question,
        maxTokens: 400,
      });

      const reply = text.slice(0, 1550);
      await sendAndLog(ctx, args.userId, args.phone, reply);
    } catch (error: any) {
      console.error("Question handling failed:", error);
      await sendAndLog(
        ctx,
        args.userId,
        args.phone,
        "My bad, something broke. Try asking again?"
      );
    }
  },
});
