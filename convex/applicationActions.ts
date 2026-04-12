"use node";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import {
  fillAcroForm,
  getAcroFormFields,
  sanitizeNulls,
} from "@claritylabs/cl-sdk";
import { PDFDocument } from "pdf-lib";
import { getAppPipeline } from "./sdkAdapter";

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
      const app = await ctx.runQuery(internal.applications.getById, {
        applicationId: args.applicationId,
      });
      if (!app) throw new Error("Application not found");

      const blob = await ctx.storage.get(app.pdfStorageId);
      if (!blob) throw new Error("PDF not found in storage");
      const buffer = await blob.arrayBuffer();
      const pdfBase64 = Buffer.from(buffer).toString("base64");

      // Use SDK application pipeline with full Convex-backed stores
      const pipeline = getAppPipeline(ctx, args.userId);
      const { state } = await pipeline.processApplication({
        pdfBase64,
        applicationId: args.applicationId as string,
      });

      // Save SDK state to Convex
      await ctx.runMutation(internal.applications.saveState, {
        applicationId: args.applicationId,
        fields: sanitizeNulls(state.fields),
        batches: state.batches,
        currentBatchIndex: state.currentBatchIndex,
        title: state.title,
        applicationType: state.applicationType ?? undefined,
        status: state.status === "complete" ? "ready" : state.status,
      });

      // Build summary message
      const totalFields = state.fields.length;
      const autoFilledCount = state.fields.filter((f: any) => f.value).length;
      const remainingCount = totalFields - autoFilledCount;

      const messages: string[] = [
        `Got it — this is a ${state.title || "insurance application"}`,
        `Found ${totalFields} fields to fill${autoFilledCount > 0 ? `. I was able to pre-fill ${autoFilledCount} from your existing policies` : ""}`,
      ];

      if (autoFilledCount > 0) {
        const preFilledSummary = state.fields
          .filter((f: any) => f.value)
          .slice(0, 8)
          .map((f: any) => `· ${f.label}: ${f.value}`)
          .join("\n");

        messages.push(
          `Here's what I pre-filled:\n${preFilledSummary}${autoFilledCount > 8 ? `\n...and ${autoFilledCount - 8} more` : ""}`
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

      await ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "awaiting_app_questions",
      });
      await ctx.runMutation(internal.users.setActiveApplication, {
        userId: args.userId,
        activeApplicationId: args.applicationId,
      });

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

      if (args.linqChatId) {
        try {
          await ctx.runAction(internal.sendLinq.startTyping, { chatId: args.linqChatId });
        } catch (_) {}
      }

      const fields = (app.fields || []) as Array<{
        id: string;
        label: string;
        section?: string;
        fieldType?: string;
        value?: string;
      }>;

      // Get the original PDF to check for AcroForm fields
      const pdfBlob = await ctx.storage.get(app.pdfStorageId);
      let filledPdfBase64: string | null = null;

      if (pdfBlob) {
        const pdfBuffer = await pdfBlob.arrayBuffer();
        const originalPdfBase64 = Buffer.from(pdfBuffer).toString("base64");

        try {
          // Try AcroForm filling first (native PDF fields)
          const pdfBytes = Buffer.from(originalPdfBase64, "base64");
          const pdfDoc = await PDFDocument.load(pdfBytes);
          const acroFields = getAcroFormFields(pdfDoc);

          if (acroFields.length > 0) {
            const fieldMappings = fields
              .filter((f) => f.value)
              .map((f) => ({
                acroFormName: f.id,
                value: f.value!,
              }));
            const filledBytes = await fillAcroForm(new Uint8Array(pdfBytes), fieldMappings);
            filledPdfBase64 = Buffer.from(filledBytes).toString("base64");
          }
        } catch (e) {
          console.log("AcroForm filling failed, falling back to overlay:", e);
        }

        // If AcroForm didn't work, use text overlay
        if (!filledPdfBase64) {
          const filledData = fields
            .filter((f) => f.value)
            .map((f) => ({
              page: 0,
              text: `${f.label}: ${f.value}`,
              x: 10,
              y: 10,
              fontSize: 10,
            }));

          // For overlay fallback, generate a summary PDF instead
          filledPdfBase64 = await generateSummaryPdf(app, fields);
        }
      } else {
        filledPdfBase64 = await generateSummaryPdf(app, fields);
      }

      // Store the filled PDF
      const filledBlob = new Blob([Buffer.from(filledPdfBase64!, "base64")], { type: "application/pdf" });
      const filledPdfStorageId = await ctx.storage.store(filledBlob);

      if (args.linqChatId) {
        try { await ctx.runAction(internal.sendLinq.stopTyping, { chatId: args.linqChatId }); } catch (_) {}
      }

      await ctx.runMutation(internal.applications.updateStatus, {
        applicationId: args.applicationId,
        status: "ready",
        filledPdfStorageId,
      });

      await ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "active",
      });
      await ctx.runMutation(internal.users.setActiveApplication, {
        userId: args.userId,
        activeApplicationId: undefined,
      });

      const answeredCount = fields.filter((f) => f.value).length;
      const totalCount = fields.length;

      await sendAndLog(
        ctx, args.userId, args.phone,
        `Your application is ready — filled ${answeredCount}/${totalCount} fields. You can ask me to email it to someone, or say "send application to [email]"`,
        args.linqChatId, args.imessageSender
      );
    } catch (error: any) {
      console.error("Application filling failed:", error);

      if (args.linqChatId) {
        try { await ctx.runAction(internal.sendLinq.stopTyping, { chatId: args.linqChatId }); } catch (_) {}
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

// ── Generate a summary PDF when AcroForm filling isn't available ──

async function generateSummaryPdf(
  app: any,
  fields: Array<{ id: string; label: string; section?: string; fieldType?: string; value?: string }>
): Promise<string> {
  const { StandardFonts, rgb } = await import("pdf-lib");
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontSize = 10;
  const lineHeight = 14;
  const margin = 50;

  let page = pdfDoc.addPage([612, 792]);
  let y = 742;

  page.drawText(app.title || app.applicationTitle || "Insurance Application", {
    x: margin, y, size: 16, font: boldFont, color: rgb(0.067, 0.094, 0.153),
  });
  y -= 24;

  if (app.carrier) {
    page.drawText(`Carrier: ${app.carrier}`, {
      x: margin, y, size: 11, font, color: rgb(0.4, 0.4, 0.4),
    });
    y -= 20;
  }

  page.drawText(`Generated by Spot on ${new Date().toLocaleDateString("en-US")}`, {
    x: margin, y, size: 9, font, color: rgb(0.54, 0.53, 0.47),
  });
  y -= 24;

  page.drawLine({
    start: { x: margin, y }, end: { x: 562, y },
    thickness: 0.5, color: rgb(0.8, 0.8, 0.8),
  });
  y -= 16;

  let currentSection = "";
  const filledFields = fields.filter((f) => f.value);

  for (const field of filledFields) {
    if (field.section && field.section !== currentSection) {
      currentSection = field.section;
      if (y < margin + 40) { page = pdfDoc.addPage([612, 792]); y = 742; }
      y -= 8;
      page.drawText(currentSection.toUpperCase(), {
        x: margin, y, size: 11, font: boldFont, color: rgb(0.067, 0.094, 0.153),
      });
      y -= lineHeight + 4;
    }

    if (y < margin + 20) { page = pdfDoc.addPage([612, 792]); y = 742; }

    page.drawText(field.label + ":", {
      x: margin, y, size: fontSize, font: boldFont, color: rgb(0.2, 0.2, 0.2),
    });

    const maxWidth = 562 - margin - 10;
    const answerX = margin + 10;
    y -= lineHeight;

    const words = (field.value || "").split(" ");
    let line = "";
    for (const word of words) {
      const testLine = line ? `${line} ${word}` : word;
      const width = font.widthOfTextAtSize(testLine, fontSize);
      if (width > maxWidth && line) {
        if (y < margin + 20) { page = pdfDoc.addPage([612, 792]); y = 742; }
        page.drawText(line, { x: answerX, y, size: fontSize, font, color: rgb(0.1, 0.1, 0.1) });
        y -= lineHeight;
        line = word;
      } else {
        line = testLine;
      }
    }
    if (line) {
      if (y < margin + 20) { page = pdfDoc.addPage([612, 792]); y = 742; }
      page.drawText(line, { x: answerX, y, size: fontSize, font, color: rgb(0.1, 0.1, 0.1) });
      y -= lineHeight + 4;
    }
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes).toString("base64");
}

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
