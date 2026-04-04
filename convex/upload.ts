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
  sanitizeNulls,
} from "@claritylabs/cl-sdk";

/** Maps SDK policyTypes array to a user-friendly category string. */
function detectCategoryFromPolicyTypes(policyTypes: string[]): string {
  if (!policyTypes || policyTypes.length === 0) return "other";
  const t = policyTypes[0];
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

function detectCategoryKeyword(extracted: any): string {
  const text = JSON.stringify(extracted).toLowerCase();
  const autoKeywords = [
    "auto", "automobile", "vehicle", "car", "collision", "comprehensive",
    "bodily injury", "uninsured motorist", "underinsured", "motor", "driver", "vin",
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

function buildPolicySummary(applied: any): string {
  const parts: string[] = [];
  if (applied.carrier) parts.push(`Carrier: ${applied.carrier}`);
  if (applied.policyNumber) parts.push(`Policy #: ${applied.policyNumber}`);
  if (applied.effectiveDate && applied.expirationDate) {
    parts.push(`Coverage: ${applied.effectiveDate} to ${applied.expirationDate}`);
  }
  if (applied.premium) parts.push(`Premium: ${applied.premium}`);
  if (applied.coverages && applied.coverages.length > 0) {
    const topCoverages = applied.coverages
      .slice(0, 4)
      .map((c: any) => {
        let line = c.name;
        if (c.limit) line += ` (${c.limit})`;
        return line;
      })
      .join("\n  - ");
    parts.push(`Key coverages:\n  - ${topCoverages}`);
  }
  return parts.join("\n");
}

// Channel-aware send helper for upload notifications
async function sendNotification(
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
      console.error("Linq send failed in upload, falling back to OpenPhone:", err);
      await ctx.runAction(internal.send.sendSms, { to: phone, body });
    }
  } else if (imessageSender) {
    try {
      await ctx.runAction(internal.sendBridge.sendBridgeMessage, {
        to: imessageSender,
        body,
      });
      usedChannel = "imessage-bridge";
    } catch (err) {
      console.error("Bridge send failed in upload, falling back to OpenPhone:", err);
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

export const processUploadedPolicy = internalAction({
  args: {
    userId: v.id("users"),
    storageId: v.id("_storage"),
    phone: v.string(),
  },
  handler: async (ctx, args) => {
    // Look up user to check for linqChatId or imessageSender
    const user = await ctx.runQuery(internal.users.getByPhone, {
      phone: args.phone,
    });
    const linqChatId = user?.linqChatId;
    const imessageSender = user?.imessageSender;

    try {
      // Get the PDF from storage
      const blob = await ctx.storage.get(args.storageId);
      if (!blob) throw new Error("File not found in storage");

      const buffer = await blob.arrayBuffer();
      const pdfBase64 = Buffer.from(buffer).toString("base64");

      // Ack + classification + optimistic extraction — all in parallel
      const [, classifyResult, policyExtractResult] = await Promise.all([
        sendNotification(ctx, args.userId, args.phone, "Got your upload — reading through it now", linqChatId, imessageSender),
        classifyDocumentType(pdfBase64),
        extractFromPdf(pdfBase64, { concurrency: 3 }).catch(() => null),
      ]);

      const { documentType } = classifyResult;

      let extracted: any;
      let applied: any;

      if (documentType === "quote") {
        // Quote: create record + quote extraction in parallel
        const [policyId, quoteResult] = await Promise.all([
          ctx.runMutation(internal.policies.create, {
            userId: args.userId, category: "other", documentType, pdfStorageId: args.storageId,
          }),
          extractQuoteFromPdf(pdfBase64, { concurrency: 3 }),
        ]);
        extracted = quoteResult.extracted;
        applied = sanitizeNulls(applyExtractedQuote(extracted));
        var finalPolicyId = policyId;
      } else {
        // Policy: extraction already done in parallel
        const policyId = await ctx.runMutation(internal.policies.create, {
          userId: args.userId, category: "other", documentType, pdfStorageId: args.storageId,
        });
        if (policyExtractResult) {
          extracted = policyExtractResult.extracted;
          applied = sanitizeNulls(applyExtracted(extracted));
        } else {
          const result = await extractFromPdf(pdfBase64, { concurrency: 3 });
          extracted = result.extracted;
          applied = sanitizeNulls(applyExtracted(extracted));
        }
        var finalPolicyId = policyId;
      }

      const detectedCategory = detectCategory(applied);

      // For auto/home policies, ask about existing insurance slip
      const isSlipEligible = documentType !== "quote" &&
        (detectedCategory === "auto" || detectedCategory === "homeowners");

      // Finalize: update policy + user state in parallel
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
          state: isSlipEligible ? "awaiting_insurance_slip" : "active",
        }),
      ]);

      // Text them the summary
      const summary = buildPolicySummary(applied);
      const docLabel = documentType === "quote" ? "quote" : "policy";

      if (isSlipEligible) {
        const msg = `Got your ${detectedCategory} ${docLabel}! Here's the breakdown:\n\n${summary}\n\nDo you have an existing insurance slip for this? If so, send it over and I'll save it. Otherwise just say no and I can generate one for you anytime.`;
        await sendNotification(ctx, args.userId, args.phone, msg, linqChatId, imessageSender);
      } else {
        const msg = `Got your ${detectedCategory} ${docLabel}! Here's the breakdown:\n\n${summary}\n\nAsk me anything about your coverage.`;
        await sendNotification(ctx, args.userId, args.phone, msg, linqChatId, imessageSender);
      }
    } catch (error: any) {
      console.error("Upload processing failed:", error);
      await sendNotification(
        ctx,
        args.userId,
        args.phone,
        "I had trouble reading that document. Try uploading again — make sure it's a PDF.",
        linqChatId,
        imessageSender
      );
    }
  },
});
