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
  sanitizeNulls,
} from "@claritylabs/cl-sdk";
import { generateText, tool, stepCountIs } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import {
  isImageMimeType,
  canEmbedInPdf,
  embedImageInPdf,
  classifyMediaIntent,
} from "./imageUtils";
import {
  buildProofOfInsuranceEmail,
  buildCoverageDetailEmail,
  buildCoiEmail,
} from "./email";
import { generateCoiPdf, buildCoiInput } from "./coiGenerator";

// ── Helpers ──

/** Maps SDK policyTypes array to a user-friendly category string. */
function detectCategoryFromPolicyTypes(policyTypes: string[]): string {
  if (!policyTypes || policyTypes.length === 0) return "other";
  const t = policyTypes[0]; // primary type drives the category
  if (t === "personal_auto") return "auto";
  if (t === "renters_ho4") return "renters";
  if (["homeowners_ho3", "homeowners_ho5", "condo_ho6", "dwelling_fire", "mobile_home"].includes(t)) return "homeowners";
  if (t === "flood_nfip" || t === "flood_private") return "flood";
  if (t === "earthquake") return "earthquake";
  if (t === "personal_umbrella") return "umbrella";
  if (t === "pet") return "pet";
  if (t === "travel") return "travel";
  if (t === "watercraft" || t === "recreational_vehicle") return "recreational";
  if (t === "farm_ranch") return "farm";
  if (t.startsWith("commercial_") || t.startsWith("bop") || t.startsWith("workers_comp") || t.startsWith("professional_liability")) return "commercial";
  return "other";
}

/** Fallback keyword-based detection when policyTypes is empty. */
function detectCategoryKeyword(extracted: any): string {
  const text = JSON.stringify(extracted).toLowerCase();
  const autoKeywords = [
    "auto", "automobile", "vehicle", "car", "collision", "comprehensive",
    "bodily injury", "uninsured motorist", "underinsured", "motor", "driver",
    "vin", "garage",
  ];
  const tenantKeywords = [
    "tenant", "renter", "renters", "personal property",
    "habitational", "apartment", "lease", "landlord", "contents",
  ];
  const homeKeywords = [
    "homeowners", "homeowner", "ho-3", "ho-5", "ho3", "ho5", "dwelling",
    "condo", "ho-6", "ho6",
  ];
  const autoScore = autoKeywords.filter((k) => text.includes(k)).length;
  const tenantScore = tenantKeywords.filter((k) => text.includes(k)).length;
  const homeScore = homeKeywords.filter((k) => text.includes(k)).length;
  if (homeScore > autoScore && homeScore > tenantScore && homeScore >= 2) return "homeowners";
  if (autoScore > tenantScore && autoScore > homeScore && autoScore >= 2) return "auto";
  if (tenantScore > autoScore && tenantScore > homeScore && tenantScore >= 2) return "renters";
  return "other";
}

function detectCategory(applied: any): string {
  const policyTypes = applied.policyTypes;
  if (policyTypes && policyTypes.length > 0) return detectCategoryFromPolicyTypes(policyTypes);
  return detectCategoryKeyword(applied);
}

const CATEGORY_LABELS: Record<string, string> = {
  auto: "Auto",
  renters: "Renters",
  homeowners: "Homeowners",
  flood: "Flood",
  earthquake: "Earthquake",
  umbrella: "Umbrella",
  pet: "Pet",
  travel: "Travel",
  recreational: "Recreational",
  farm: "Farm/Ranch",
  commercial: "Commercial",
  other: "Insurance",
};

function friendlyCategoryLabel(category: string, policyTypes?: string[]): string {
  const base = CATEGORY_LABELS[category] || category;
  if (!policyTypes || policyTypes.length === 0) return base;
  const t = policyTypes[0];
  if (t === "homeowners_ho3") return "Homeowners (HO-3)";
  if (t === "homeowners_ho5") return "Homeowners (HO-5)";
  if (t === "condo_ho6") return "Condo (HO-6)";
  if (t === "dwelling_fire") return "Dwelling Fire";
  if (t === "mobile_home") return "Mobile Home";
  if (t === "flood_nfip") return "Flood (NFIP)";
  if (t === "flood_private") return "Flood (Private)";
  return base;
}

function buildPolicySummary(applied: any, category?: string): string {
  const parts: string[] = [];
  if (category) {
    const label = friendlyCategoryLabel(category, applied.policyTypes);
    parts.push(label);
  }
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

function parseCategoryInput(input: string): string | null {
  const clean = input.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  if (!clean) return null;

  if (clean === "1") return "auto";
  if (clean === "2") return "homeowners";
  if (clean === "3") return "renters";
  if (clean === "4") return "other";

  const autoWords = ["auto", "car", "vehicle", "driving"];
  const homeWords = ["homeowner", "homeowners", "home", "house", "condo", "dwelling"];
  const tenantWords = ["renter", "tenant", "rental", "apartment", "renters"];
  const otherWords = ["other", "something else", "neither", "different"];

  if (autoWords.some((w) => clean.includes(w))) return "auto";
  if (homeWords.some((w) => clean.includes(w))) return "homeowners";
  if (tenantWords.some((w) => clean.includes(w))) return "renters";
  if (otherWords.some((w) => clean.includes(w))) return "other";

  return null;
}

// Channel-aware send: tries Linq first, then iMessage bridge, falls back to OpenPhone
async function sendAndLog(
  ctx: any,
  userId: any,
  phone: string,
  body: string,
  linqChatId?: string,
  imessageSender?: string
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
  } else if (imessageSender) {
    try {
      await ctx.runAction(internal.sendBridge.sendBridgeMessage, {
        to: imessageSender,
        body,
      });
      usedChannel = "imessage_bridge";
    } catch (err) {
      console.error("iMessage bridge failed, falling back to OpenPhone:", err);
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
  linqChatId?: string,
  imessageSender?: string
) {
  for (let i = 0; i < messages.length; i++) {
    if (i > 0) await sleep(800 + Math.random() * 700); // 0.8–1.5s pause
    await sendAndLog(ctx, userId, phone, messages[i], linqChatId, imessageSender);
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
    imessageSender: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.linqChatId) {
      try {
        await ctx.runAction(internal.sendLinq.startTyping, {
          chatId: args.linqChatId,
        });
      } catch (_) {}
    }

    await sendBurst(ctx, args.userId, args.phone, [
      "Hey! This is Spot 👋",
      "I can go through your insurance policy and tell you exactly what you're covered for — plus send proof of insurance, set reminders, and more",
      "Is it auto, homeowners, renters, or something else?",
    ], args.linqChatId, args.imessageSender);
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
    imessageSender: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.hasAttachment && args.mediaUrl) {
      await ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "active",
      });
      await ctx.runAction(internal.process.processMedia, {
        userId: args.userId,
        mediaUrl: args.mediaUrl,
        mediaType: args.mediaType || "application/pdf",
        phone: args.phone,
        userText: args.input,
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
        `Haha no worries, is it auto, homeowners, renters, or something else?`,
        args.linqChatId,
        args.imessageSender
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
      homeowners: "homeowners",
      renters: "renter's",
      other: "",
    };
    const label = labels[category] || category;
    const isImessageChannel = !!(args.linqChatId || args.imessageSender);

    if (isImessageChannel) {
      if (category === "other") {
        await sendBurst(ctx, args.userId, args.phone, [
          "Works for me",
          "Just send me the PDF or a photo of the doc right here and I'll take a look",
        ], args.linqChatId, args.imessageSender);
      } else {
        await sendBurst(ctx, args.userId, args.phone, [
          `${label}, got it`,
          "Just send me the PDF or a photo right here and I'll go through it",
        ], args.linqChatId, args.imessageSender);
      }
    } else {
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
    imessageSender: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const category = parseCategoryInput(args.input);
    if (category) {
      await ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "awaiting_policy",
        preferredCategory: category,
      });
      if (args.linqChatId || args.imessageSender) {
        await sendAndLog(
          ctx,
          args.userId,
          args.phone,
          "No problem — just send me that PDF or photo right here",
          args.linqChatId,
          args.imessageSender
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

    if (args.linqChatId || args.imessageSender) {
      if (isRetryIntent(args.input)) {
        await sendAndLog(
          ctx,
          args.userId,
          args.phone,
          "No worries, go ahead and send it again — just drop the PDF or photo right here",
          args.linqChatId,
          args.imessageSender
        );
      } else {
        const link = getUploadLink(args.uploadToken);
        await sendBurst(ctx, args.userId, args.phone, [
          "I'll need to see the policy first — just send me the PDF or a photo right here",
          `Or if that's not working, you can upload it here instead:\n${link}`,
        ], args.linqChatId, args.imessageSender);
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

// ── Media Router ──
// Routes incoming media (images or PDFs) to the correct processing pipeline

export const processMedia = internalAction({
  args: {
    userId: v.id("users"),
    mediaUrl: v.string(),
    mediaType: v.string(),
    phone: v.string(),
    userText: v.optional(v.string()),
    linqChatId: v.optional(v.string()),
    imessageSender: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // PDF → go straight to existing extraction pipeline
    if (!isImageMimeType(args.mediaType)) {
      await ctx.runAction(internal.process.processPolicy, {
        userId: args.userId,
        mediaUrl: args.mediaUrl,
        mediaType: args.mediaType,
        phone: args.phone,
        linqChatId: args.linqChatId,
      });
      return;
    }

    // Image path — download, classify intent, then route
    try {
      const downloadResponse = await fetch(args.mediaUrl);
      const buffer = await downloadResponse.arrayBuffer();
      const imageBase64 = Buffer.from(buffer).toString("base64");

      // Store image in Convex for potential vision Q&A later
      const blob = new Blob([new Uint8Array(buffer)], { type: args.mediaType });
      const storageId = await ctx.storage.store(blob);

      // Save as user's last image for contextual questions
      await ctx.runMutation(internal.users.updateLastImageId, {
        userId: args.userId,
        lastImageId: storageId,
      });

      // Classify: is this a document photo or a contextual question?
      const apiKey = process.env.ANTHROPIC_API_KEY || "";
      const intent = await classifyMediaIntent(imageBase64, args.userText || "", apiKey, args.mediaType);

      if (intent === "document" && canEmbedInPdf(args.mediaType)) {
        // JPEG/PNG document photo → embed in PDF → extraction pipeline
        await sendAndLog(ctx, args.userId, args.phone, "Got your photo — converting and reading through it now", args.linqChatId, args.imessageSender);

        const pdfBase64 = await embedImageInPdf(buffer, args.mediaType);

        const pdfBlob = new Blob([Buffer.from(pdfBase64, "base64")], { type: "application/pdf" });
        const pdfStorageId = await ctx.storage.store(pdfBlob);

        await processExtractionPipeline(ctx, {
          userId: args.userId,
          pdfBase64,
          pdfStorageId,
          phone: args.phone,
          linqChatId: args.linqChatId,
        });
      } else if (intent === "document" && !canEmbedInPdf(args.mediaType)) {
        // HEIC/WebP document photo — can't embed, suggest resend as PDF or screenshot
        await sendAndLog(
          ctx,
          args.userId,
          args.phone,
          "I can see that's an insurance document, but I need a clearer format to extract the details — can you send it as a PDF or take a screenshot?",
          args.linqChatId,
          args.imessageSender
        );
      } else {
        // Contextual image question — route to handleQuestion with image context
        const user = await ctx.runQuery(internal.users.get, { userId: args.userId });
        await ctx.runAction(internal.process.handleQuestion, {
          userId: args.userId,
          question: args.userText || "What can you tell me about this image?",
          phone: args.phone,
          uploadToken: user?.uploadToken || "",
          linqChatId: args.linqChatId,
          imageStorageId: storageId,
        });
      }
    } catch (error: any) {
      console.error("Image processing failed:", error);
      await sendAndLog(
        ctx,
        args.userId,
        args.phone,
        "Hmm I had trouble with that image — try sending it again, or send the PDF if you have it",
        args.linqChatId,
        args.imessageSender
      );
    }
  },
});

// ── Internal extraction pipeline (shared by processPolicy and processMedia) ──

async function processExtractionPipeline(
  ctx: any,
  args: {
    userId: any;
    pdfBase64: string;
    pdfStorageId: any;
    phone: string;
    linqChatId?: string;
    imessageSender?: string;
  }
) {
  const [classifyResult, policyExtractResult] = await Promise.all([
    classifyDocumentType(args.pdfBase64),
    extractFromPdf(args.pdfBase64, { concurrency: 3 }).catch(() => null),
  ]);

  const { documentType } = classifyResult;

  const startTypingIfLinq = args.linqChatId
    ? ctx.runAction(internal.sendLinq.startTyping, { chatId: args.linqChatId }).catch(() => {})
    : Promise.resolve();

  let extracted: any;
  let applied: any;
  let finalPolicyId: any;

  if (documentType === "quote") {
    const [{ policyId }, , , quoteResult] = await Promise.all([
      ctx.runMutation(internal.policies.create, {
        userId: args.userId, category: "other", documentType, pdfStorageId: args.pdfStorageId,
      }).then((id: any) => ({ policyId: id })),
      sendAndLog(ctx, args.userId, args.phone, "Looks like a quote — pulling out the details", args.linqChatId, args.imessageSender),
      startTypingIfLinq,
      extractQuoteFromPdf(args.pdfBase64, { concurrency: 3 }),
    ]);
    extracted = quoteResult.extracted;
    applied = sanitizeNulls(applyExtractedQuote(extracted));
    finalPolicyId = policyId;
  } else {
    const [policyId] = await Promise.all([
      ctx.runMutation(internal.policies.create, {
        userId: args.userId, category: "other", documentType, pdfStorageId: args.pdfStorageId,
      }),
      sendAndLog(ctx, args.userId, args.phone, "Found your policy — pulling out coverages and limits", args.linqChatId, args.imessageSender),
      startTypingIfLinq,
    ]);

    if (policyExtractResult) {
      extracted = policyExtractResult.extracted;
      applied = sanitizeNulls(applyExtracted(extracted));
    } else {
      const result = await extractFromPdf(args.pdfBase64, { concurrency: 3 });
      extracted = result.extracted;
      applied = sanitizeNulls(applyExtracted(extracted));
    }
    finalPolicyId = policyId;
  }

  const detectedCategory = detectCategory(applied);

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
      summary: applied.summary || undefined,
      coverages: applied.coverages || undefined,
      rawExtracted: applied,
      category: detectedCategory,
      policyTypes: applied.policyTypes || undefined,
      status: "ready",
    }),
    ctx.runMutation(internal.users.updateState, {
      userId: args.userId,
      state: "active",
    }),
    stopTypingIfLinq,
  ]);

  const summary = buildPolicySummary(applied, detectedCategory);
  const isQuote = documentType === "quote";

  await sendBurst(ctx, args.userId, args.phone, [
    `Ok here's what ${isQuote ? "that quote" : "you're covered for"}`,
    summary,
    "That's the main stuff — ask me anything about it, or I can send proof of insurance / set a reminder for you",
  ], args.linqChatId, args.imessageSender);
}

// ── Policy Processing (PDF path — unchanged but now delegates to shared pipeline) ──

export const processPolicy = internalAction({
  args: {
    userId: v.id("users"),
    mediaUrl: v.string(),
    mediaType: v.string(),
    phone: v.string(),
    linqChatId: v.optional(v.string()),
    imessageSender: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      // Step 1: Ack + download in parallel
      const [, downloadResponse] = await Promise.all([
        sendAndLog(ctx, args.userId, args.phone, "Got it — reading through your document now", args.linqChatId, args.imessageSender),
        fetch(args.mediaUrl),
      ]);

      const buffer = await downloadResponse.arrayBuffer();
      const pdfBase64 = Buffer.from(buffer).toString("base64");

      // Store in Convex
      const blob = new Blob([buffer], { type: args.mediaType });
      const storageId = await ctx.storage.store(blob);

      await processExtractionPipeline(ctx, {
        userId: args.userId,
        pdfBase64,
        pdfStorageId: storageId,
        phone: args.phone,
        linqChatId: args.linqChatId,
        imessageSender: args.imessageSender,
      });
    } catch (error: any) {
      console.error("Policy processing failed:", error);

      if (args.linqChatId) {
        try {
          await ctx.runAction(internal.sendLinq.stopTyping, {
            chatId: args.linqChatId,
          });
        } catch (_) {}
      }

      if (args.linqChatId) {
        const user = await ctx.runQuery(internal.users.get, { userId: args.userId });
        const link = user?.uploadToken ? getUploadLink(user.uploadToken) : null;
        await sendBurst(ctx, args.userId, args.phone, [
          "Hmm I couldn't read that one — try sending it again as a PDF or photo",
          ...(link ? [`Or you can upload it here instead:\n${link}`] : []),
        ], args.linqChatId, args.imessageSender);
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

// ── Email Confirmation / Undo State Handlers ──

export const handleEmailConfirmation = internalAction({
  args: {
    userId: v.id("users"),
    phone: v.string(),
    input: v.string(),
    linqChatId: v.optional(v.string()),
    imessageSender: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const clean = args.input.toLowerCase().trim();
    const pending = await ctx.runQuery(internal.email.getPendingForUser, {
      userId: args.userId,
    });

    if (!pending) {
      // No pending email — go back to active state
      await ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "active",
      });
      await sendAndLog(ctx, args.userId, args.phone, "No pending email to confirm. What else can I help with?", args.linqChatId, args.imessageSender);
      return;
    }

    // Check for /autosend command
    if (clean === "/autosend on" || clean === "autosend on") {
      await ctx.runMutation(internal.users.setAutoSendEmails, {
        userId: args.userId,
        autoSendEmails: true,
      });
      await sendAndLog(ctx, args.userId, args.phone, "Auto-send is now on — I'll send emails without asking first", args.linqChatId, args.imessageSender);
      // Still confirm this one
    }
    if (clean === "/autosend off" || clean === "autosend off") {
      await ctx.runMutation(internal.users.setAutoSendEmails, {
        userId: args.userId,
        autoSendEmails: false,
      });
      await sendAndLog(ctx, args.userId, args.phone, "Auto-send is off — I'll ask before sending emails", args.linqChatId, args.imessageSender);
      return;
    }

    // Confirm: send, yes, go, /send
    const confirmWords = ["send", "yes", "yeah", "yep", "go", "ok", "sure", "do it", "confirm", "/send", "/yes"];
    const cancelWords = ["cancel", "no", "nah", "nope", "don't", "stop", "/cancel", "/no"];
    const undoWords = ["undo", "/undo"];

    if (pending.status === "scheduled" && undoWords.some(w => clean === w || clean.startsWith(w))) {
      // Undo a scheduled email
      await ctx.runMutation(internal.email.cancelPendingEmail, {
        pendingEmailId: pending._id,
      });
      await ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "active",
      });
      await sendAndLog(ctx, args.userId, args.phone, "Got it — email cancelled before it sent", args.linqChatId, args.imessageSender);
      return;
    }

    if (cancelWords.some(w => clean === w || clean.startsWith(w))) {
      await ctx.runMutation(internal.email.cancelPendingEmail, {
        pendingEmailId: pending._id,
      });
      await ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "active",
      });
      await sendAndLog(ctx, args.userId, args.phone, "No worries, cancelled", args.linqChatId, args.imessageSender);
      return;
    }

    if (confirmWords.some(w => clean === w || clean.startsWith(w))) {
      // Schedule with 20s undo window
      await ctx.runMutation(internal.email.scheduleEmailSend, {
        pendingEmailId: pending._id,
      });
      await ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "active",
      });
      await sendAndLog(
        ctx,
        args.userId,
        args.phone,
        `Sending to ${pending.recipientEmail} now. Reply "undo" in the next 20s to cancel`,
        args.linqChatId,
        args.imessageSender
      );
      return;
    }

    // Unrecognized — re-prompt
    await sendAndLog(
      ctx,
      args.userId,
      args.phone,
      `Reply "send" to confirm, "cancel" to stop, or "undo" after sending to recall`,
      args.linqChatId,
      args.imessageSender
    );
  },
});

// ── Email Collection State Handler ──

export const handleEmailCollection = internalAction({
  args: {
    userId: v.id("users"),
    phone: v.string(),
    input: v.string(),
    linqChatId: v.optional(v.string()),
    imessageSender: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Simple email validation
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    const match = args.input.match(emailRegex);

    if (!match) {
      await sendAndLog(
        ctx,
        args.userId,
        args.phone,
        "That doesn't look like an email address — can you try again?",
        args.linqChatId,
        args.imessageSender
      );
      return;
    }

    const email = match[0].toLowerCase();
    await ctx.runMutation(internal.users.updateEmail, {
      userId: args.userId,
      email,
    });
    await ctx.runMutation(internal.users.updateState, {
      userId: args.userId,
      state: "active",
    });
    await sendAndLog(
      ctx,
      args.userId,
      args.phone,
      `Got it — ${email}. Now what were you trying to do? I can send proof of insurance, coverage details, or a COI summary to someone`,
      args.linqChatId,
      args.imessageSender
    );
  },
});

// ── Conversational Q&A (Agentic — with tool_use) ──

export const handleQuestion = internalAction({
  args: {
    userId: v.id("users"),
    question: v.string(),
    phone: v.string(),
    uploadToken: v.string(),
    linqChatId: v.optional(v.string()),
    imessageSender: v.optional(v.string()),
    imageStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    try {
      // Check for undo command (quick path — user might reply "undo" after email sent)
      const clean = args.question.toLowerCase().trim();
      if (clean === "undo" || clean === "/undo") {
        const pending = await ctx.runQuery(internal.email.getPendingForUser, {
          userId: args.userId,
        });
        if (pending && pending.status === "scheduled") {
          await ctx.runMutation(internal.email.cancelPendingEmail, {
            pendingEmailId: pending._id,
          });
          await sendAndLog(ctx, args.userId, args.phone, "Got it — email cancelled before it sent", args.linqChatId, args.imessageSender);
          return;
        }
      }

      const [policies, user] = await Promise.all([
        ctx.runQuery(internal.policies.getByUser, { userId: args.userId }),
        ctx.runQuery(internal.users.get, { userId: args.userId }),
      ]);

      const readyPolicies = policies.filter((p: any) => p.status === "ready");

      if (readyPolicies.length === 0) {
        const link = getUploadLink(args.uploadToken);
        await sendAndLog(
          ctx,
          args.userId,
          args.phone,
          `I don't have a policy from you yet, drop one here and I'll check it out\n\n${link}`,
          args.linqChatId,
          args.imessageSender
        );
        return;
      }

      // Start typing
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
- If someone asks about something outside their policy, keep it light: "That's a bit outside my lane — I'm best at breaking down what's in your policy."
- Be direct. If the answer is in their policy, just say it. If it's not, say that.
- Use plain language. If their policy says "comprehensive" explain what that actually means in normal words.

Actions you can take:
- Send emails (proof of insurance, coverage details, COI summaries) to anyone on the user's behalf
- Set expiration reminders so the user gets a heads up before their policy lapses
- Send the user their upload link if they want to add another policy
- If the user doesn't have an email on file and they want to send an email, use the request_email tool first

When sending emails, ALWAYS ask for confirmation before sending unless the user explicitly says to just send it. Keep the confirmation message brief — just say who it's going to and what it contains.
`;

      // Build document context
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

      const isImChannel = !!(args.linqChatId || args.imessageSender);
      const maxOutputTokens = isImChannel ? 800 : 400;

      // Build user message content — include image if present
      const userContent: any[] = [];

      // Check for image context (sent with this message or user's last image)
      const imageId = args.imageStorageId || user?.lastImageId;
      if (imageId) {
        try {
          const imageBlob = await ctx.storage.get(imageId);
          if (imageBlob) {
            const imageBuffer = await imageBlob.arrayBuffer();
            const imageBase64 = Buffer.from(imageBuffer).toString("base64");
            userContent.push({
              type: "image",
              image: imageBase64,
              mimeType: "image/jpeg",
            });
          }
        } catch (_) {
          // Image not available — skip
        }
        // Clear lastImageId after using it (so it doesn't leak into unrelated questions)
        if (!args.imageStorageId && user?.lastImageId) {
          // Only clear if we're using the stored last image (not a freshly sent one)
          // Don't clear here — let it persist for follow-up questions about the same image
        }
      }

      userContent.push({ type: "text", text: args.question });

      // Define tools
      const anthropic = createAnthropic();

      // Track tool side effects
      let pendingEmailCreated = false;
      let pendingEmailId: any = null;

      const result = await generateText({
        model: anthropic("claude-sonnet-4-6"),
        system: `${complianceGuardrails}\n\n${sdkPrompt}\n\nHere are the user's insurance documents:\n${documentContext}\n\nUser's email on file: ${user?.email || "none"}\nUser's name: ${user?.name || "Unknown"}`,
        messages: [{ role: "user", content: userContent }],
        maxOutputTokens,
        tools: {
          send_email: tool({
            description: "Send an email with policy information to someone (landlord, lender, agent, etc). The user will be CC'd on the email. Always confirm with the user before sending unless they explicitly ask you to just send it.",
            inputSchema: z.object({
              recipientEmail: z.string().email().describe("Recipient's email address"),
              recipientName: z.string().optional().describe("Recipient's name"),
              purpose: z.enum(["proof_of_insurance", "coverage_details", "coi", "general_info"]).describe("Type of email to send"),
              coverageNames: z.array(z.string()).optional().describe("Specific coverage names to include (for coverage_details)"),
              customMessage: z.string().optional().describe("Optional custom message to include"),
              policyId: z.string().optional().describe("Specific policy ID if user has multiple"),
            }),
            execute: async (input) => {
              if (!user?.email) {
                return { success: false, reason: "no_email", message: "User doesn't have an email on file. Use request_email to ask for it first." };
              }

              // Pick the policy
              const targetPolicy = input.policyId
                ? readyPolicies.find((p: any) => p._id === input.policyId)
                : readyPolicies[0];
              if (!targetPolicy) return { success: false, reason: "no_policy", message: "No policy found" };

              // Build email based on purpose
              let emailContent: { subject: string; html: string };
              const userName = user.name || targetPolicy.insuredName || "Policyholder";

              switch (input.purpose) {
                case "proof_of_insurance":
                  emailContent = buildProofOfInsuranceEmail(targetPolicy, userName);
                  break;
                case "coi":
                  emailContent = buildCoiEmail(
                    targetPolicy,
                    input.recipientName || "Recipient",
                    input.customMessage || "General purpose",
                    userName
                  );
                  break;
                case "coverage_details":
                  emailContent = buildCoverageDetailEmail(
                    targetPolicy,
                    input.coverageNames || [],
                    input.customMessage
                  );
                  break;
                default:
                  emailContent = buildProofOfInsuranceEmail(targetPolicy, userName);
              }

              // Create pending email
              const peId = await ctx.runMutation(internal.email.createPendingEmail, {
                userId: args.userId,
                recipientEmail: input.recipientEmail,
                recipientName: input.recipientName,
                subject: emailContent.subject,
                htmlBody: emailContent.html,
                ccEmail: user.email,
                purpose: input.purpose,
              });

              pendingEmailCreated = true;
              pendingEmailId = peId;

              // If autoSend is on, schedule immediately (no confirmation, no undo)
              if (user.autoSendEmails) {
                await ctx.runMutation(internal.email.scheduleEmailSend, {
                  pendingEmailId: peId,
                });
                return {
                  success: true,
                  autoSent: true,
                  message: `Email scheduled to ${input.recipientEmail} (auto-send is on). It will be delivered shortly.`,
                };
              }

              return {
                success: true,
                awaitingConfirmation: true,
                recipientEmail: input.recipientEmail,
                subject: emailContent.subject,
                message: `Email drafted to ${input.recipientEmail}. Ask the user to confirm.`,
              };
            },
          }),

          generate_coi: tool({
            description: "Generate and send a Certificate of Insurance (ACORD-style PDF) via email. The PDF is attached to the email alongside an HTML summary.",
            inputSchema: z.object({
              recipientEmail: z.string().email(),
              recipientName: z.string(),
              purpose: z.string().describe("e.g. 'apartment lease', 'mortgage application'"),
              policyId: z.string().optional(),
            }),
            execute: async (input) => {
              if (!user?.email) {
                return { success: false, reason: "no_email", message: "User doesn't have an email on file. Use request_email first." };
              }
              const targetPolicy = input.policyId
                ? readyPolicies.find((p: any) => p._id === input.policyId)
                : readyPolicies[0];
              if (!targetPolicy) return { success: false, reason: "no_policy", message: "No policy found" };

              const userName = user.name || targetPolicy.insuredName || "Policyholder";
              const emailContent = buildCoiEmail(targetPolicy, input.recipientName, input.purpose, userName);

              // Generate ACORD-style COI PDF
              const coiInput = buildCoiInput(targetPolicy, input.recipientName, input.purpose, userName, user.email);
              const pdfBytes = await generateCoiPdf(coiInput);
              const pdfBlob = new Blob([Buffer.from(pdfBytes)], { type: "application/pdf" });
              const coiPdfStorageId = await ctx.storage.store(pdfBlob);

              const peId = await ctx.runMutation(internal.email.createPendingEmail, {
                userId: args.userId,
                recipientEmail: input.recipientEmail,
                recipientName: input.recipientName,
                subject: emailContent.subject,
                htmlBody: emailContent.html,
                ccEmail: user.email,
                purpose: "coi",
                coiPdfStorageId,
              });

              pendingEmailCreated = true;
              pendingEmailId = peId;

              if (user.autoSendEmails) {
                await ctx.runMutation(internal.email.scheduleEmailSend, { pendingEmailId: peId });
                return { success: true, autoSent: true, message: `COI summary sent to ${input.recipientEmail}.` };
              }

              return {
                success: true,
                awaitingConfirmation: true,
                recipientEmail: input.recipientEmail,
                message: `COI email drafted for ${input.recipientName} at ${input.recipientEmail}. Ask user to confirm.`,
              };
            },
          }),

          set_reminder: tool({
            description: "Set a reminder to text the user before their policy expires. Default is 30 days before expiration.",
            inputSchema: z.object({
              policyId: z.string().optional().describe("Policy ID. If omitted, uses the first policy."),
              daysBefore: z.number().optional().describe("Days before expiration to send reminder. Default 30."),
            }),
            execute: async (input) => {
              const targetPolicy = input.policyId
                ? readyPolicies.find((p: any) => p._id === input.policyId)
                : readyPolicies[0];
              if (!targetPolicy) return { success: false, message: "No policy found" };
              if (!targetPolicy.expirationDate) return { success: false, message: "This policy has no expiration date on file" };

              try {
                await ctx.runMutation(internal.reminders.createReminder, {
                  userId: args.userId,
                  policyId: targetPolicy._id,
                  daysBefore: input.daysBefore || 30,
                });
                return {
                  success: true,
                  message: `Reminder set for ${input.daysBefore || 30} days before ${targetPolicy.expirationDate}`,
                };
              } catch (err: any) {
                return { success: false, message: err.message };
              }
            },
          }),

          request_email: tool({
            description: "Ask the user for their email address. Use this when the user wants to send an email but doesn't have one on file.",
            inputSchema: z.object({
              reason: z.string().describe("Why the email is needed — shown to the user"),
            }),
            execute: async (_input) => {
              await ctx.runMutation(internal.users.updateState, {
                userId: args.userId,
                state: "awaiting_email",
              });
              return { success: true, message: "Ask the user for their email address now." };
            },
          }),

          send_upload_link: tool({
            description: "Send the user their upload link so they can add another policy",
            inputSchema: z.object({}),
            execute: async () => {
              const link = getUploadLink(args.uploadToken);
              return { success: true, link, message: `Upload link: ${link}` };
            },
          }),
        },
        stopWhen: stepCountIs(5),
      });

      // Stop typing before sending reply
      if (args.linqChatId) {
        try {
          await ctx.runAction(internal.sendLinq.stopTyping, {
            chatId: args.linqChatId,
          });
        } catch (_) {}
      }

      // Get the final text response
      const replyText = result.text;

      // If a pending email was created and needs confirmation, set user state
      if (pendingEmailCreated && !user?.autoSendEmails) {
        await ctx.runMutation(internal.users.updateState, {
          userId: args.userId,
          state: "awaiting_email_confirm",
        });
      }

      // Send the reply
      if (replyText) {
        const reply = isImChannel ? replyText : replyText.slice(0, 1550);
        await sendAndLog(ctx, args.userId, args.phone, reply, args.linqChatId, args.imessageSender);
      }

    } catch (error: any) {
      console.error("Question handling failed:", error);

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
        args.linqChatId,
        args.imessageSender
      );
    }
  },
});
