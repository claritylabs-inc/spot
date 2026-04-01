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
} from "@claritylabs/cl-sdk";

function detectCategory(extracted: any): "auto" | "tenant" | "other" {
  const text = JSON.stringify(extracted).toLowerCase();
  const autoKeywords = [
    "auto", "automobile", "vehicle", "car", "collision", "comprehensive",
    "bodily injury", "uninsured motorist", "underinsured", "motor", "driver", "vin",
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

export const processUploadedPolicy = internalAction({
  args: {
    userId: v.id("users"),
    storageId: v.id("_storage"),
    phone: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      // Get the PDF from storage
      const blob = await ctx.storage.get(args.storageId);
      if (!blob) throw new Error("File not found in storage");

      const buffer = await blob.arrayBuffer();
      const pdfBase64 = Buffer.from(buffer).toString("base64");

      // Classify
      const { documentType } = await classifyDocumentType(pdfBase64);

      // Create policy record
      const policyId = await ctx.runMutation(internal.policies.create, {
        userId: args.userId,
        category: "other",
        documentType,
        pdfStorageId: args.storageId,
      });

      // Extract
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

      // Update policy
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

      // Move user to active
      await ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "active",
      });

      // Text them the summary
      const summary = buildPolicySummary(applied);
      const docLabel = documentType === "quote" ? "quote" : "policy";
      const msg = `Got your ${detectedCategory} ${docLabel}! Here's the breakdown:\n\n${summary}\n\nAsk me anything about your coverage.`;

      await ctx.runAction(internal.send.sendSms, {
        to: args.phone,
        body: msg,
      });
      await ctx.runMutation(internal.messages.log, {
        userId: args.userId,
        direction: "outbound",
        body: msg,
        hasAttachment: false,
      });
    } catch (error: any) {
      console.error("Upload processing failed:", error);
      await ctx.runAction(internal.send.sendSms, {
        to: args.phone,
        body: "I had trouble reading that document. Try uploading again — make sure it's a PDF.",
      });
    }
  },
});
