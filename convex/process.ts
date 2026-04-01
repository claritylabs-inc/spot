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

// Channel-aware send: tries Linq first, falls back to OpenPhone
async function sendAndLog(
  ctx: any,
  userId: any,
  phone: string,
  body: string,
  linqChatId?: string
) {
  let usedChannel = "openphone";

  if (linqChatId) {
    try {
      await ctx.runAction(internal.sendLinq.sendLinqMessage, {
        chatId: linqChatId,
        body,
      });
      usedChannel = "linq";
    } catch (err) {
      console.error("Linq send failed, falling back to OpenPhone:", err);
      await ctx.runAction(internal.send.sendSms, { to: phone, body });
    }
  } else {
    await ctx.runAction(internal.send.sendSms, { to: phone, body });
  }

  await ctx.runMutation(internal.messages.log, {
    userId,
    direction: "outbound" as const,
    body,
    hasAttachment: false,
    channel: usedChannel,
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendBurst(
  ctx: any,
  userId: any,
  phone: string,
  messages: string[],
  linqChatId?: string
) {
  for (let i = 0; i < messages.length; i++) {
    if (i > 0) await sleep(800 + Math.random() * 700); // 0.8–1.5s pause
    await sendAndLog(ctx, userId, phone, messages[i], linqChatId);
  }
}

function getUploadLink(uploadToken: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://secure.claritylabs.inc";
  return `${baseUrl}/upload/${uploadToken}`;
}

// ── Journey ──

export const sendWelcome = internalAction({
  args: {
    userId: v.id("users"),
    phone: v.string(),
    uploadToken: v.string(),
    linqChatId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Start typing indicator for Linq users
    if (args.linqChatId) {
      try {
        await ctx.runAction(internal.sendLinq.startTyping, {
          chatId: args.linqChatId,
        });
      } catch (_) {
        // typing indicator is best-effort
      }
    }

    await sendBurst(ctx, args.userId, args.phone, [
      "Hey! This is Spot 👋",
      "I can go through your insurance policy and tell you exactly what you're covered for",
      "Is it auto, renters, or something else?",
    ], args.linqChatId);
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
    linqChatId: v.optional(v.string()),
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
        linqChatId: args.linqChatId,
      });
      return;
    }

    const category = parseCategoryInput(args.input);

    if (!category) {
      await sendAndLog(
        ctx,
        args.userId,
        args.phone,
        `Haha no worries, is it auto, renters, or something else?`,
        args.linqChatId
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

    if (args.linqChatId) {
      // Linq (iMessage) — ask for attachment directly, no upload link yet
      if (category === "other") {
        await sendBurst(ctx, args.userId, args.phone, [
          "Works for me",
          "Just send me the PDF right here and I'll take a look",
        ], args.linqChatId);
      } else {
        await sendBurst(ctx, args.userId, args.phone, [
          `${label}, got it`,
          "Just send me the PDF right here and I'll go through it",
        ], args.linqChatId);
      }
    } else {
      // OpenPhone (SMS) — send upload link since MMS is unreliable for PDFs
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
    }
  },
});

function isRetryIntent(input: string): boolean {
  const clean = input.toLowerCase().trim();
  const retryPhrases = [
    "try again", "retry", "again", "resend", "re-send",
    "one more time", "let me try", "didn't work", "not working",
  ];
  return retryPhrases.some((p) => clean.includes(p));
}

export const nudgeForPolicy = internalAction({
  args: {
    userId: v.id("users"),
    phone: v.string(),
    input: v.string(),
    uploadToken: v.string(),
    linqChatId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const category = parseCategoryInput(args.input);
    if (category) {
      await ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "awaiting_policy",
        preferredCategory: category,
      });
      if (args.linqChatId) {
        await sendAndLog(
          ctx,
          args.userId,
          args.phone,
          "No problem — just send me that PDF right here",
          args.linqChatId
        );
      } else {
        const link = getUploadLink(args.uploadToken);
        await sendAndLog(
          ctx,
          args.userId,
          args.phone,
          `No problem. Drop that one here\n\n${link}`,
        );
      }
      return;
    }

    if (args.linqChatId) {
      // Linq user — check if they're asking to retry
      if (isRetryIntent(args.input)) {
        await sendAndLog(
          ctx,
          args.userId,
          args.phone,
          "No worries, go ahead and send it again — just drop the PDF right here",
          args.linqChatId
        );
      } else {
        // First nudge: ask for iMessage attachment, mention web upload as backup
        const link = getUploadLink(args.uploadToken);
        await sendBurst(ctx, args.userId, args.phone, [
          "I'll need to see the policy first — just send me the PDF right here",
          `Or if that's not working, you can upload it here instead:\n${link}`,
        ], args.linqChatId);
      }
    } else {
      const link = getUploadLink(args.uploadToken);
      await sendAndLog(
        ctx,
        args.userId,
        args.phone,
        `I'll need to see the policy first — you can drop it here\n\n${link}`,
      );
    }
  },
});

// ── Policy Processing ──

export const processPolicy = internalAction({
  args: {
    userId: v.id("users"),
    mediaUrl: v.string(),
    mediaType: v.string(),
    phone: v.string(),
    linqChatId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      // Step 1: Ack + download in parallel (independent)
      const [, downloadResponse] = await Promise.all([
        sendAndLog(ctx, args.userId, args.phone, "Got it — reading through your document now", args.linqChatId),
        fetch(args.mediaUrl),
      ]);

      const buffer = await downloadResponse.arrayBuffer();
      const pdfBase64 = Buffer.from(buffer).toString("base64");

      // Step 2: Storage + classification + optimistic policy extraction — all in parallel
      const blob = new Blob([buffer], { type: args.mediaType });
      const [storageId, classifyResult, policyExtractResult] = await Promise.all([
        ctx.storage.store(blob),
        classifyDocumentType(pdfBase64),
        extractFromPdf(pdfBase64).catch(() => null),
      ]);

      const { documentType } = classifyResult;

      // Step 3: Create record + progress message + typing — all in parallel
      const startTypingIfLinq = args.linqChatId
        ? ctx.runAction(internal.sendLinq.startTyping, { chatId: args.linqChatId }).catch(() => {})
        : Promise.resolve();

      let extracted: any;
      let applied: any;

      if (documentType === "quote") {
        // Quote: create record + progress + typing + quote extraction — all in parallel
        const [{ policyId }, , , quoteResult] = await Promise.all([
          ctx.runMutation(internal.policies.create, {
            userId: args.userId, category: "other", documentType, pdfStorageId: storageId,
          }).then((id) => ({ policyId: id })),
          sendAndLog(ctx, args.userId, args.phone, "Looks like a quote — pulling out the details", args.linqChatId),
          startTypingIfLinq,
          extractQuoteFromPdf(pdfBase64),
        ]);
        extracted = quoteResult.extracted;
        applied = applyExtractedQuote(extracted);
        var finalPolicyId = policyId;
      } else {
        // Policy: create record + progress + typing in parallel (extraction already done)
        const [policyId] = await Promise.all([
          ctx.runMutation(internal.policies.create, {
            userId: args.userId, category: "other", documentType, pdfStorageId: storageId,
          }),
          sendAndLog(ctx, args.userId, args.phone, "Found your policy — pulling out coverages and limits", args.linqChatId),
          startTypingIfLinq,
        ]);

        if (policyExtractResult) {
          extracted = policyExtractResult.extracted;
          applied = applyExtracted(extracted);
        } else {
          const result = await extractFromPdf(pdfBase64);
          extracted = result.extracted;
          applied = applyExtracted(extracted);
        }
        var finalPolicyId = policyId;
      }

      const detectedCategory = detectCategory(applied);

      // Step 4: Finalize — update policy + user state + stop typing in parallel
      const stopTypingIfLinq = args.linqChatId
        ? ctx.runAction(internal.sendLinq.stopTyping, { chatId: args.linqChatId }).catch(() => {})
        : Promise.resolve();

      await Promise.all([
        ctx.runMutation(internal.policies.updateExtracted, {
          policyId: finalPolicyId,
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
        }),
        ctx.runMutation(internal.users.updateState, {
          userId: args.userId,
          state: "active",
        }),
        stopTypingIfLinq,
      ]);

      // Step 5: Send summary
      const summary = buildPolicySummary(applied);
      const isQuote = documentType === "quote";

      await sendBurst(ctx, args.userId, args.phone, [
        `Ok here's what ${isQuote ? "that quote" : "you're covered for"}`,
        summary,
        "That's the main stuff — ask me anything about it",
      ], args.linqChatId);
    } catch (error: any) {
      console.error("Policy processing failed:", error);

      // Stop typing on error
      if (args.linqChatId) {
        try {
          await ctx.runAction(internal.sendLinq.stopTyping, {
            chatId: args.linqChatId,
          });
        } catch (_) {}
      }

      if (args.linqChatId) {
        // Linq user — suggest retry, offer web upload as backup
        const user = await ctx.runQuery(internal.users.get, { userId: args.userId });
        const link = user?.uploadToken ? getUploadLink(user.uploadToken) : null;
        await sendBurst(ctx, args.userId, args.phone, [
          "Hmm I couldn't read that one — try sending it again as a PDF",
          ...(link ? [`Or you can upload it here instead:\n${link}`] : []),
        ], args.linqChatId);
      } else {
        await sendAndLog(
          ctx,
          args.userId,
          args.phone,
          "Hmm I couldn't read that one, can you try again? PDF works best",
        );
      }
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
    linqChatId: v.optional(v.string()),
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
          `I don't have a policy from you yet, drop one here and I'll check it out\n\n${link}`,
          args.linqChatId
        );
        return;
      }

      // Start typing indicator for Linq users
      if (args.linqChatId) {
        try {
          await ctx.runAction(internal.sendLinq.startTyping, {
            chatId: args.linqChatId,
          });
        } catch (_) {}
      }

      const sdkPrompt = buildAgentSystemPrompt({
        platform: "sms",
        intent: "direct",
        companyName: "Spot",
        agentName: "Spot",
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

      // Shape stored data into PolicyDocument / QuoteDocument for buildDocumentContext
      const policyDocs: any[] = [];
      const quoteDocs: any[] = [];
      for (const p of readyPolicies) {
        const raw = p.rawExtracted as any;
        if (!raw) continue;
        const base = {
          id: p._id,
          carrier: raw.carrier || p.carrier || "Unknown",
          insuredName: raw.insuredName || p.insuredName || "Unknown",
          premium: raw.premium || p.premium,
          summary: raw.summary || p.summary,
          policyTypes: raw.policyTypes,
          coverages: raw.coverages || p.coverages || [],
          sections: raw.document?.sections || raw.sections || [],
        };
        if (p.documentType === "quote") {
          quoteDocs.push({
            ...base,
            type: "quote" as const,
            quoteNumber: raw.quoteNumber || p.policyNumber || "",
            proposedEffectiveDate: raw.proposedEffectiveDate || p.effectiveDate,
            proposedExpirationDate: raw.proposedExpirationDate || p.expirationDate,
            quoteExpirationDate: raw.quoteExpirationDate,
            subjectivities: raw.subjectivities,
            underwritingConditions: raw.underwritingConditions,
            premiumBreakdown: raw.premiumBreakdown,
          });
        } else {
          policyDocs.push({
            ...base,
            type: "policy" as const,
            policyNumber: raw.policyNumber || p.policyNumber || "",
            effectiveDate: raw.effectiveDate || p.effectiveDate || "",
            expirationDate: raw.expirationDate || p.expirationDate || "",
          });
        }
      }

      const { context: documentContext } = buildDocumentContext(policyDocs, quoteDocs, args.question);

      // Use higher maxOutputTokens for Linq (iMessage has no char limit)
      const maxOutputTokens = args.linqChatId ? 800 : 400;

      const anthropic = createAnthropic();
      const { text } = await generateText({
        model: anthropic("claude-sonnet-4-6"),
        system: `${complianceGuardrails}\n\n${sdkPrompt}\n\nHere are the user's insurance documents:\n${documentContext}`,
        prompt: args.question,
        maxOutputTokens,
      });

      // Stop typing before sending reply
      if (args.linqChatId) {
        try {
          await ctx.runAction(internal.sendLinq.stopTyping, {
            chatId: args.linqChatId,
          });
        } catch (_) {}
      }

      // Only truncate for OpenPhone (SMS char limit)
      const reply = args.linqChatId ? text : text.slice(0, 1550);
      await sendAndLog(ctx, args.userId, args.phone, reply, args.linqChatId);
    } catch (error: any) {
      console.error("Question handling failed:", error);

      // Stop typing on error
      if (args.linqChatId) {
        try {
          await ctx.runAction(internal.sendLinq.stopTyping, {
            chatId: args.linqChatId,
          });
        } catch (_) {}
      }

      await sendAndLog(
        ctx,
        args.userId,
        args.phone,
        "My bad, something broke. Try asking again?",
        args.linqChatId
      );
    }
  },
});
