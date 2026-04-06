"use node";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { generateText, generateObject } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// ── Constants ──

const QUESTIONS_PER_BATCH = 5;

// ── Extract questions from an application PDF ──

export const extractApplicationFields = internalAction({
  args: {
    applicationId: v.id("applications"),
    userId: v.id("users"),
    phone: v.string(),
    linqChatId: v.optional(v.string()),
    imessageSender: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      // Get the application record
      const app = await ctx.runQuery(internal.applications.getById, {
        applicationId: args.applicationId,
      });
      if (!app) throw new Error("Application not found");

      // Download the PDF
      const blob = await ctx.storage.get(app.pdfStorageId);
      if (!blob) throw new Error("PDF not found in storage");
      const buffer = await blob.arrayBuffer();
      const pdfBase64 = Buffer.from(buffer).toString("base64");

      // Load user's existing policies for context
      const policies = await ctx.runQuery(internal.policies.getByUser, {
        userId: args.userId,
      });
      const readyPolicies = policies.filter((p: any) => p.status === "ready");

      // Build policy context for auto-filling
      const policyContext = readyPolicies.map((p: any) => {
        const raw = p.rawExtracted || {};
        return {
          category: p.category,
          carrier: raw.carrier || p.carrier,
          policyNumber: raw.policyNumber || p.policyNumber,
          insuredName: raw.insuredName || p.insuredName,
          insuredAddress: raw.insuredAddress,
          effectiveDate: raw.effectiveDate || p.effectiveDate,
          expirationDate: raw.expirationDate || p.expirationDate,
          premium: raw.premium || p.premium,
          coverages: raw.coverages || p.coverages,
          policyTypes: raw.policyTypes || p.policyTypes,
          broker: raw.broker || raw.brokerAgency,
          carrierLegalName: raw.security || raw.carrierLegalName,
        };
      });

      const anthropic = createAnthropic();

      // Step 1: Extract all questions/fields from the application
      const { object: extraction } = await generateObject({
        model: anthropic("claude-sonnet-4-6"),
        schema: z.object({
          applicationTitle: z.string().describe("Title of the application form (e.g. 'ACORD 125 - Commercial Insurance Application')"),
          carrier: z.string().optional().describe("Target carrier/insurer if mentioned"),
          fields: z.array(z.object({
            id: z.string().describe("Unique field identifier like 'insured_name', 'effective_date', 'business_type' etc"),
            question: z.string().describe("The question or field label as it appears on the form"),
            section: z.string().optional().describe("Section of the form this belongs to"),
            type: z.enum(["text", "date", "number", "boolean", "choice"]),
            choices: z.array(z.string()).optional().describe("Available choices for choice-type fields"),
            required: z.boolean(),
          })),
        }),
        prompt: `You are analyzing an insurance application PDF. Extract ALL fillable fields and questions from this document.

For each field, provide:
- A unique camelCase id
- The exact question/label text
- The section it belongs to
- The field type (text, date, number, boolean for yes/no, choice for multiple choice)
- Whether it's required

Be thorough — capture every field that needs to be filled in, including checkboxes, date fields, name fields, address fields, etc.

Group related fields logically (e.g., all address fields together, all coverage fields together).

The PDF content (base64): ${pdfBase64.slice(0, 100000)}`,
        maxOutputTokens: 4096,
      });

      // Step 2: Auto-fill from existing policies
      let answers: Record<string, { value: string; source: string; policyId?: string }> = {};

      if (readyPolicies.length > 0) {
        const { object: autoFilled } = await generateObject({
          model: anthropic("claude-sonnet-4-6"),
          schema: z.object({
            answers: z.array(z.object({
              fieldId: z.string(),
              value: z.string(),
              policyId: z.string().optional().describe("ID of the policy this was pulled from"),
              confidence: z.enum(["high", "medium", "low"]),
            })),
          }),
          prompt: `You have these insurance application fields to fill:

${JSON.stringify(extraction.fields, null, 2)}

And here is data from the user's existing insurance policies:

${JSON.stringify(policyContext, null, 2)}

For each field where you can find a matching answer from the policy data, provide the answer.
Only fill fields where you have HIGH or MEDIUM confidence the data matches.
For dates, use MM/DD/YYYY format.
For boolean fields, use "Yes" or "No".
For names/addresses, use exactly what appears in the policy data.

Do NOT guess or make up information. Only use data directly from the policies.`,
          maxOutputTokens: 4096,
        });

        for (const a of autoFilled.answers) {
          if (a.confidence !== "low") {
            answers[a.fieldId] = {
              value: a.value,
              source: "policy",
              policyId: a.policyId,
            };
          }
        }
      }

      // Calculate batches for unanswered required fields
      const unansweredRequired = extraction.fields.filter(
        (f) => f.required && !answers[f.id]
      );
      const unansweredOptional = extraction.fields.filter(
        (f) => !f.required && !answers[f.id]
      );
      const unanswered = [...unansweredRequired, ...unansweredOptional];
      const totalBatches = Math.ceil(unanswered.length / QUESTIONS_PER_BATCH);

      // Update the application record
      await ctx.runMutation(internal.applications.updateFields, {
        applicationId: args.applicationId,
        fields: extraction.fields,
        answers,
        applicationTitle: extraction.applicationTitle,
        carrier: extraction.carrier,
        totalBatches: Math.max(totalBatches, 0),
        status: Object.keys(answers).length > 0 ? "answering" : "answering",
      });

      // Build summary message
      const totalFields = extraction.fields.length;
      const autoFilledCount = Object.keys(answers).length;
      const remainingCount = unanswered.length;

      const messages: string[] = [
        `Got it — this is a ${extraction.applicationTitle || "insurance application"}${extraction.carrier ? ` for ${extraction.carrier}` : ""}`,
        `Found ${totalFields} fields to fill${autoFilledCount > 0 ? `. I was able to pre-fill ${autoFilledCount} from your existing ${readyPolicies.length === 1 ? "policy" : "policies"}` : ""}`,
      ];

      if (autoFilledCount > 0) {
        // Show pre-filled answers for confirmation
        const preFilledSummary = Object.entries(answers)
          .slice(0, 8)
          .map(([fieldId, ans]) => {
            const field = extraction.fields.find((f: any) => f.id === fieldId);
            return `· ${field?.question || fieldId}: ${ans.value}`;
          })
          .join("\n");

        messages.push(
          `Here's what I pre-filled:\n${preFilledSummary}${Object.keys(answers).length > 8 ? `\n...and ${Object.keys(answers).length - 8} more` : ""}`
        );
        messages.push(
          remainingCount > 0
            ? `Does this look right? Say "yes" to confirm and I'll ask you the remaining ${remainingCount} questions, or point out anything that needs fixing`
            : `Does this look right? Say "yes" to confirm and I'll fill the application, or point out anything that needs fixing`
        );
      } else if (remainingCount > 0) {
        messages.push(
          `I'll need to ask you ${remainingCount} questions to fill this out. Ready? Say "yes" to start`
        );
      }

      // Set user state
      await ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "awaiting_app_questions",
      });

      // Store the active application ID on the user
      await ctx.runMutation(internal.users.setActiveApplication, {
        userId: args.userId,
        activeApplicationId: args.applicationId,
      });

      // Send messages
      for (let i = 0; i < messages.length; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 800 + Math.random() * 700));
        await sendAndLog(ctx, args.userId, args.phone, messages[i], args.linqChatId, args.imessageSender);
      }
    } catch (error: any) {
      console.error("Application field extraction failed:", error);
      await ctx.runMutation(internal.applications.updateStatus, {
        applicationId: args.applicationId,
        status: "failed",
      });
      await ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "active",
      });
      await sendAndLog(
        ctx, args.userId, args.phone,
        "Had trouble reading that application — try sending it again?",
        args.linqChatId, args.imessageSender
      );
    }
  },
});

// ── Fill the application PDF with answers ──

export const fillApplicationPdf = internalAction({
  args: {
    applicationId: v.id("applications"),
    userId: v.id("users"),
    phone: v.string(),
    linqChatId: v.optional(v.string()),
    imessageSender: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      const app = await ctx.runQuery(internal.applications.getById, {
        applicationId: args.applicationId,
      });
      if (!app) throw new Error("Application not found");

      await ctx.runMutation(internal.applications.updateStatus, {
        applicationId: args.applicationId,
        status: "filling",
      });

      await sendAndLog(
        ctx, args.userId, args.phone,
        "Filling out your application now — one sec",
        args.linqChatId, args.imessageSender
      );

      // Start typing for Linq users
      if (args.linqChatId) {
        try {
          await ctx.runAction(internal.sendLinq.startTyping, { chatId: args.linqChatId });
        } catch (_) {}
      }

      const fields = (app.fields || []) as Array<{
        id: string;
        question: string;
        section?: string;
        type: string;
      }>;
      const answers = (app.answers || {}) as Record<string, { value: string; source: string }>;

      // Build a filled form summary for the PDF
      const filledData: Array<{ question: string; answer: string; section?: string }> = [];
      for (const field of fields) {
        const ans = answers[field.id];
        if (ans) {
          filledData.push({
            question: field.question,
            answer: ans.value,
            section: field.section,
          });
        }
      }

      // Generate a filled application PDF
      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const fontSize = 10;
      const lineHeight = 14;
      const margin = 50;

      let page = pdfDoc.addPage([612, 792]); // Letter size
      let y = 742;

      // Title
      page.drawText(app.applicationTitle || "Insurance Application", {
        x: margin,
        y,
        size: 16,
        font: boldFont,
        color: rgb(0.067, 0.094, 0.153),
      });
      y -= 24;

      if (app.carrier) {
        page.drawText(`Carrier: ${app.carrier}`, {
          x: margin,
          y,
          size: 11,
          font,
          color: rgb(0.4, 0.4, 0.4),
        });
        y -= 20;
      }

      page.drawText(`Generated by Spot on ${new Date().toLocaleDateString("en-US")}`, {
        x: margin,
        y,
        size: 9,
        font,
        color: rgb(0.54, 0.53, 0.47),
      });
      y -= 24;

      // Draw a line
      page.drawLine({
        start: { x: margin, y },
        end: { x: 562, y },
        thickness: 0.5,
        color: rgb(0.8, 0.8, 0.8),
      });
      y -= 16;

      let currentSection = "";

      for (const item of filledData) {
        // New section header
        if (item.section && item.section !== currentSection) {
          currentSection = item.section;
          if (y < margin + 40) {
            page = pdfDoc.addPage([612, 792]);
            y = 742;
          }
          y -= 8;
          page.drawText(currentSection.toUpperCase(), {
            x: margin,
            y,
            size: 11,
            font: boldFont,
            color: rgb(0.067, 0.094, 0.153),
          });
          y -= lineHeight + 4;
        }

        // Check if we need a new page
        if (y < margin + 20) {
          page = pdfDoc.addPage([612, 792]);
          y = 742;
        }

        // Question
        page.drawText(item.question + ":", {
          x: margin,
          y,
          size: fontSize,
          font: boldFont,
          color: rgb(0.2, 0.2, 0.2),
        });

        // Answer — handle long answers by wrapping
        const maxWidth = 562 - margin - 10;
        const answerX = margin + 10;
        y -= lineHeight;

        const words = item.answer.split(" ");
        let line = "";
        for (const word of words) {
          const testLine = line ? `${line} ${word}` : word;
          const width = font.widthOfTextAtSize(testLine, fontSize);
          if (width > maxWidth && line) {
            if (y < margin + 20) {
              page = pdfDoc.addPage([612, 792]);
              y = 742;
            }
            page.drawText(line, { x: answerX, y, size: fontSize, font, color: rgb(0.1, 0.1, 0.1) });
            y -= lineHeight;
            line = word;
          } else {
            line = testLine;
          }
        }
        if (line) {
          if (y < margin + 20) {
            page = pdfDoc.addPage([612, 792]);
            y = 742;
          }
          page.drawText(line, { x: answerX, y, size: fontSize, font, color: rgb(0.1, 0.1, 0.1) });
          y -= lineHeight + 4;
        }
      }

      const pdfBytes = await pdfDoc.save();

      // Store the filled PDF
      const pdfBlob = new Blob([Buffer.from(pdfBytes)], { type: "application/pdf" });
      const filledPdfStorageId = await ctx.storage.store(pdfBlob);

      // Stop typing
      if (args.linqChatId) {
        try {
          await ctx.runAction(internal.sendLinq.stopTyping, { chatId: args.linqChatId });
        } catch (_) {}
      }

      await ctx.runMutation(internal.applications.updateStatus, {
        applicationId: args.applicationId,
        status: "ready",
        filledPdfStorageId,
      });

      // Transition user back to active
      await ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "active",
      });
      await ctx.runMutation(internal.users.setActiveApplication, {
        userId: args.userId,
        activeApplicationId: undefined,
      });

      const answeredCount = Object.keys(answers).length;
      const totalCount = fields.length;

      await sendAndLog(
        ctx, args.userId, args.phone,
        `Your application is ready — filled ${answeredCount}/${totalCount} fields. You can ask me to email it to someone, or say "send application to [email]"`,
        args.linqChatId, args.imessageSender
      );
    } catch (error: any) {
      console.error("Application filling failed:", error);

      if (args.linqChatId) {
        try {
          await ctx.runAction(internal.sendLinq.stopTyping, { chatId: args.linqChatId });
        } catch (_) {}
      }

      await ctx.runMutation(internal.applications.updateStatus, {
        applicationId: args.applicationId,
        status: "failed",
      });
      await ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "active",
      });
      await sendAndLog(
        ctx, args.userId, args.phone,
        "Had trouble filling the application — try again?",
        args.linqChatId, args.imessageSender
      );
    }
  },
});

// ── Helper: send and log (mirrors process.ts pattern) ──

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
