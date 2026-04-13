"use node";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import {
  buildAgentSystemPrompt,
  sanitizeNulls,
  type InsuranceDocument,
} from "@claritylabs/cl-sdk";
import { tool, stepCountIs } from "ai";
import { getModel, generateTextWithFallback } from "./models";
import { z } from "zod";
import {
  isImageMimeType,
  canEmbedInPdf,
  embedImageInPdf,
  classifyMediaIntent,
  mergeIntoPdf,
} from "./imageUtils";
import { generateCoiPdf, buildCoiInput } from "./coiGenerator";
import { sendAndLog, sendBurst, sleep, getUploadLink } from "./sendHelpers";
import { buildMemoryContext } from "./memory";
import {
  getExtractor,
  documentToUpdateFields,
  detectCategory,
  extractContactsFromDocument,
  buildDocumentContextFromDocs,
  isPartialPolicy,
  buildPolicySummary,
  makeEmbedText,
  createConvexMemoryStore,
  getQueryAgent,
} from "./sdkAdapter";

// ── Helpers ──
// detectCategory, isPartialPolicy, buildPolicySummary are imported from sdkAdapter

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

// buildPolicySummary and isPartialPolicy are imported from sdkAdapter

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

// sendAndLog, sendBurst, sleep, getUploadLink imported from ./sendHelpers

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
        lastImageMimeType: args.mediaType,
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
          imageMimeType: args.mediaType,
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

// ── Multi-attachment handler — merges multiple docs into one PDF before extraction ──

export const processMultipleMedia = internalAction({
  args: {
    userId: v.id("users"),
    attachments: v.array(v.object({
      url: v.string(),
      mimeType: v.string(),
    })),
    phone: v.string(),
    userText: v.optional(v.string()),
    linqChatId: v.optional(v.string()),
    imessageSender: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      // Download all attachments in parallel
      const downloads = await Promise.all(
        args.attachments.map(async (att) => {
          const resp = await fetch(att.url);
          const buffer = await resp.arrayBuffer();
          return { buffer, mimeType: att.mimeType };
        })
      );

      // Check if any are non-document images (contextual photos) — if mixed with
      // documents, treat everything as documents for merge
      const allImages = downloads.every((d) => isImageMimeType(d.mimeType));

      // If all are images and there's only one, use the single-image path
      // (preserves vision Q&A classification logic)
      if (allImages && downloads.length === 1) {
        // Store image for vision context
        const d = downloads[0];
        const blob = new Blob([new Uint8Array(d.buffer)], { type: d.mimeType });
        const storageId = await ctx.storage.store(blob);
        await ctx.runMutation(internal.users.updateLastImageId, {
          userId: args.userId,
          lastImageId: storageId,
          lastImageMimeType: d.mimeType,
        });

        // Classify intent
        const imageBase64 = Buffer.from(d.buffer).toString("base64");
        const apiKey = process.env.ANTHROPIC_API_KEY || "";
        const intent = await classifyMediaIntent(imageBase64, args.userText || "", apiKey, d.mimeType);

        if (intent === "document" && canEmbedInPdf(d.mimeType)) {
          const pdfBase64 = await embedImageInPdf(d.buffer, d.mimeType);
          const pdfBlob = new Blob([Buffer.from(pdfBase64, "base64")], { type: "application/pdf" });
          const pdfStorageId = await ctx.storage.store(pdfBlob);
          await sendAndLog(ctx, args.userId, args.phone, "Got your photo — converting and reading through it now", args.linqChatId, args.imessageSender);
          await processExtractionPipeline(ctx, {
            userId: args.userId,
            pdfBase64,
            pdfStorageId,
            phone: args.phone,
            linqChatId: args.linqChatId,
            imessageSender: args.imessageSender,
          });
        } else if (intent === "document" && !canEmbedInPdf(d.mimeType)) {
          await sendAndLog(ctx, args.userId, args.phone,
            "I can see that's an insurance document, but I need a clearer format to extract the details — can you send it as a PDF or take a screenshot?",
            args.linqChatId, args.imessageSender);
        } else {
          const user = await ctx.runQuery(internal.users.get, { userId: args.userId });
          await ctx.runAction(internal.process.handleQuestion, {
            userId: args.userId,
            question: args.userText || "What can you tell me about this image?",
            phone: args.phone,
            uploadToken: user?.uploadToken || "",
            linqChatId: args.linqChatId,
            imageStorageId: storageId,
            imageMimeType: d.mimeType,
          });
        }
        return;
      }

      // Multiple files or single PDF — merge everything into one PDF
      // Filter out non-embeddable images (HEIC/WebP) with a warning
      const embeddable = downloads.filter((d) => {
        if (isImageMimeType(d.mimeType) && !canEmbedInPdf(d.mimeType)) {
          console.warn(`Skipping non-embeddable image type ${d.mimeType} in multi-doc merge`);
          return false;
        }
        return true;
      });

      if (embeddable.length === 0) {
        await sendAndLog(ctx, args.userId, args.phone,
          "I couldn't process those files — try sending PDFs or JPEG/PNG photos instead",
          args.linqChatId, args.imessageSender);
        return;
      }

      await sendAndLog(ctx, args.userId, args.phone,
        `Got ${embeddable.length} documents — merging and reading through them now`,
        args.linqChatId, args.imessageSender);

      const mergedPdfBase64 = await mergeIntoPdf(embeddable);

      // Store merged PDF
      const mergedBlob = new Blob([Buffer.from(mergedPdfBase64, "base64")], { type: "application/pdf" });
      const mergedStorageId = await ctx.storage.store(mergedBlob);

      await processExtractionPipeline(ctx, {
        userId: args.userId,
        pdfBase64: mergedPdfBase64,
        pdfStorageId: mergedStorageId,
        phone: args.phone,
        linqChatId: args.linqChatId,
        imessageSender: args.imessageSender,
      });
    } catch (error: any) {
      console.error("Multi-media processing failed:", error);
      await sendAndLog(ctx, args.userId, args.phone,
        "Hmm I had trouble with those files — try sending them again, or one at a time",
        args.linqChatId, args.imessageSender);
    }
  },
});

// ── Application detection helper ──

async function isApplicationForm(pdfBase64: string): Promise<boolean> {
  try {
    const result = await generateTextWithFallback({
      model: getModel("extraction_classify"),
      system: "You classify insurance documents. Respond with ONLY 'application' or 'not_application'. An insurance application is a form to be filled out to APPLY for insurance coverage (e.g. ACORD forms, carrier-specific application forms with blank fields to fill in). A policy, quote, declaration page, or certificate is NOT an application.",
      prompt: `Classify this PDF (first 20KB of base64): ${pdfBase64.slice(0, 20000)}`,
      maxOutputTokens: 10,
    });
    return result.text.trim().toLowerCase().includes("application");
  } catch (_) {
    return false;
  }
}

// ── Async chunk embedding (scheduled after extraction so it doesn't block) ──

export const embedChunksForPolicy = internalAction({
  args: {
    policyId: v.id("policies"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    try {
      const chunks = await ctx.runQuery(internal.documentChunks.getByPolicy, {
        policyId: args.policyId,
      });
      const embed = makeEmbedText();

      for (const chunk of chunks) {
        if (chunk.embedding && chunk.embedding.length > 0) continue; // already embedded
        try {
          const embedding = await embed(chunk.text);
          await ctx.runMutation(internal.documentChunks.updateEmbedding, {
            chunkId: chunk.chunkId,
            embedding,
          });
        } catch (e) {
          console.warn(`Embedding failed for chunk ${chunk.chunkId}:`, e);
        }
      }
      console.log(`[embedChunks] Embedded ${chunks.length} chunks for policy ${args.policyId}`);
    } catch (e) {
      console.error("[embedChunks] Failed:", e);
    }
  },
});

// ── Internal extraction pipeline (shared by processPolicy and processMedia) ──
// Uses CL SDK v0.5.0's createExtractor — single extract() call handles
// classification, extraction, review, assembly, and chunking.

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
  // Run SDK extraction and application detection in parallel
  const [extractionResult, isApp] = await Promise.all([
    getExtractor().extract(args.pdfBase64),
    isApplicationForm(args.pdfBase64),
  ]);

  // If it's an application form, redirect to application flow
  if (isApp) {
    const appId = await ctx.runMutation(internal.applications.create, {
      userId: args.userId,
      pdfStorageId: args.pdfStorageId,
    });
    await ctx.scheduler.runAfter(0, internal.applicationActions.extractApplicationFields, {
      applicationId: appId,
      userId: args.userId,
      phone: args.phone,
      linqChatId: args.linqChatId,
      imessageSender: args.imessageSender,
    });
    return;
  }

  const { document: extractedDoc, chunks } = extractionResult;
  const document: any = extractedDoc;
  const documentType = document.type; // "policy" | "quote"
  const applied = documentToUpdateFields(document, extractionResult);
  const detectedCategory = applied.category;

  const startTypingIfLinq = args.linqChatId
    ? ctx.runAction(internal.sendLinq.startTyping, { chatId: args.linqChatId }).catch(() => {})
    : Promise.resolve();

  // Create policy record + send ack in parallel
  const docLabel = documentType === "quote" ? "quote" : "policy";
  const [finalPolicyId] = await Promise.all([
    ctx.runMutation(internal.policies.create, {
      userId: args.userId, category: "other", documentType, pdfStorageId: args.pdfStorageId,
    }),
    sendAndLog(ctx, args.userId, args.phone,
      documentType === "quote"
        ? "Looks like a quote — pulling out the details"
        : "Found your policy — pulling out coverages and limits",
      args.linqChatId, args.imessageSender),
    startTypingIfLinq,
  ]);

  const stopTypingIfLinq = args.linqChatId
    ? ctx.runAction(internal.sendLinq.stopTyping, { chatId: args.linqChatId }).catch(() => {})
    : Promise.resolve();

  const isQuote = documentType === "quote";
  const partial = isPartialPolicy(document);

  // Check for an existing policy this could be merged into
  const existingMatch = !isQuote
    ? await ctx.runQuery(internal.policies.findMatchingPolicy, {
        userId: args.userId,
        carrier: applied.carrier || undefined,
        policyNumber: applied.policyNumber || undefined,
        category: detectedCategory,
      })
    : null;

  // If we found a match and this is a different document, offer to merge
  if (existingMatch && existingMatch._id !== finalPolicyId) {
    await Promise.all([
      ctx.runMutation(internal.policies.updateExtracted, {
        policyId: finalPolicyId,
        ...applied,
        status: "ready",
      }),
      // Store extraction chunks
      ctx.runMutation(internal.documentChunks.saveChunks, {
        policyId: finalPolicyId,
        userId: args.userId,
        chunks: sanitizeNulls(chunks),
      }),
      ctx.runMutation(internal.users.setPendingMerge, {
        userId: args.userId,
        pendingMergePolicyId: existingMatch._id,
        pendingMergeStorageId: args.pdfStorageId,
      }),
      ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "awaiting_merge_confirm",
      }),
      stopTypingIfLinq,
    ]);

    // Extract and save contacts from document parties
    const contacts = extractContactsFromDocument(document);
    for (const c of contacts) {
      await ctx.runMutation(internal.contacts.upsert, { userId: args.userId, ...c });
    }

    // Schedule async embedding
    ctx.scheduler.runAfter(0, internal.process.embedChunksForPolicy, {
      policyId: finalPolicyId,
      userId: args.userId,
    });

    const summary = buildPolicySummary(document);
    const matchLabel = existingMatch.carrier
      ? `your ${existingMatch.carrier} ${CATEGORY_LABELS[existingMatch.category] || existingMatch.category} policy`
      : `your existing ${CATEGORY_LABELS[existingMatch.category] || existingMatch.category} policy`;

    await sendBurst(ctx, args.userId, args.phone, [
      `Got it — here's what I found`,
      summary,
      `This looks like it goes with ${matchLabel}. Want me to merge them together? (yes/no)`,
    ], args.linqChatId, args.imessageSender);
    return;
  }

  // No merge — standard flow
  const isSlipEligible = !isQuote &&
    (detectedCategory === "auto" || detectedCategory === "homeowners");

  await Promise.all([
    ctx.runMutation(internal.policies.updateExtracted, {
      policyId: finalPolicyId,
      ...applied,
      status: "ready",
    }),
    // Store extraction chunks for vector search
    ctx.runMutation(internal.documentChunks.saveChunks, {
      policyId: finalPolicyId,
      userId: args.userId,
      chunks: sanitizeNulls(chunks),
    }),
    ctx.runMutation(internal.users.updateState, {
      userId: args.userId,
      state: isSlipEligible ? "awaiting_insurance_slip" : "active",
    }),
    stopTypingIfLinq,
  ]);

  // Extract and save contacts from document parties
  const contacts = extractContactsFromDocument(document);
  for (const c of contacts) {
    await ctx.runMutation(internal.contacts.upsert, { userId: args.userId, ...c });
  }

  const summary = buildPolicySummary(document);

  let closingMsg: string;
  if (partial) {
    closingMsg = "Looks like this might be just a declarations page or partial document. If you have the full policy, send it over and I'll combine them for a more complete picture.";
  } else if (isSlipEligible) {
    closingMsg = "Do you have an existing insurance slip for this? If so, send it over and I'll save it. Otherwise just say no and I can generate one for you anytime.";
  } else {
    closingMsg = "That's the main stuff — ask me anything about it, or I can send proof of insurance / set a reminder for you";
  }

  await sendBurst(ctx, args.userId, args.phone, [
    `Ok here's what ${isQuote ? "that quote" : "you're covered for"}`,
    summary,
    closingMsg,
  ], args.linqChatId, args.imessageSender);

  // Schedule async embedding of chunks (non-blocking)
  ctx.scheduler.runAfter(0, internal.process.embedChunksForPolicy, {
    policyId: finalPolicyId,
    userId: args.userId,
  });

  // Schedule proactive health check analysis (2s delay so summary texts arrive first)
  if (!isQuote && !partial) {
    ctx.scheduler.runAfter(2000, internal.proactive.analyzePolicy, {
      policyId: finalPolicyId,
      userId: args.userId,
      phone: args.phone,
      linqChatId: args.linqChatId,
      imessageSender: args.imessageSender,
    });
  }
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

// ── Insurance Slip Upload Handlers ──

/** Handle text response when user is in awaiting_insurance_slip state. */
export const handleInsuranceSlipResponse = internalAction({
  args: {
    userId: v.id("users"),
    phone: v.string(),
    input: v.string(),
    uploadToken: v.string(),
    linqChatId: v.optional(v.string()),
    imessageSender: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const clean = args.input.toLowerCase().trim();
    const skipWords = ["no", "nah", "nope", "skip", "don't have one", "dont have one", "no thanks", "not right now", "later", "maybe later", "i don't", "i dont", "none", "n"];

    if (skipWords.some((w) => clean === w || clean.includes(w))) {
      await ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "active",
      });
      await sendAndLog(
        ctx,
        args.userId,
        args.phone,
        "No worries — I can generate one for you anytime, just ask! What else can I help with?",
        args.linqChatId,
        args.imessageSender
      );
      return;
    }

    const yesWords = ["yes", "yeah", "yep", "yup", "sure", "ok", "okay", "i do", "got one", "have one"];
    if (yesWords.some((w) => clean === w || clean.includes(w))) {
      // They said yes but didn't attach — prompt them to send it
      if (args.linqChatId || args.imessageSender) {
        await sendAndLog(
          ctx,
          args.userId,
          args.phone,
          "Send it over — just drop the photo or PDF right here",
          args.linqChatId,
          args.imessageSender
        );
      } else {
        const link = getUploadLink(args.uploadToken);
        await sendAndLog(
          ctx,
          args.userId,
          args.phone,
          `You can upload it here:\n${link}`,
        );
      }
      return;
    }

    // Anything else — treat as skipping and go to active
    await ctx.runMutation(internal.users.updateState, {
      userId: args.userId,
      state: "active",
    });
    await ctx.runAction(internal.process.handleQuestion, {
      userId: args.userId,
      question: args.input,
      phone: args.phone,
      uploadToken: args.uploadToken,
      linqChatId: args.linqChatId,
      imessageSender: args.imessageSender,
    });
  },
});

/** Process an insurance slip attachment (PDF or image) and save it on the policy. */
export const processInsuranceSlip = internalAction({
  args: {
    userId: v.id("users"),
    attachments: v.array(v.object({
      url: v.string(),
      mimeType: v.string(),
    })),
    phone: v.string(),
    linqChatId: v.optional(v.string()),
    imessageSender: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      // Find the most recent auto/home policy without a slip
      const policy = await ctx.runQuery(internal.policies.getLatestAutoOrHome, {
        userId: args.userId,
      });

      if (!policy) {
        // No eligible policy — go to active and treat as normal media
        await ctx.runMutation(internal.users.updateState, {
          userId: args.userId,
          state: "active",
        });
        if (args.attachments.length > 1) {
          await ctx.runAction(internal.process.processMultipleMedia, {
            userId: args.userId,
            attachments: args.attachments,
            phone: args.phone,
            linqChatId: args.linqChatId,
            imessageSender: args.imessageSender,
          });
        } else {
          await ctx.runAction(internal.process.processMedia, {
            userId: args.userId,
            mediaUrl: args.attachments[0].url,
            mediaType: args.attachments[0].mimeType,
            phone: args.phone,
            linqChatId: args.linqChatId,
            imessageSender: args.imessageSender,
          });
        }
        return;
      }

      // Download all attachments
      const downloads = await Promise.all(
        args.attachments.map(async (att) => {
          const resp = await fetch(att.url);
          const buffer = await resp.arrayBuffer();
          return { buffer, mimeType: att.mimeType };
        })
      );

      let storageId;
      if (downloads.length === 1) {
        // Single file — store directly
        const d = downloads[0];
        const blob = new Blob([new Uint8Array(d.buffer)], { type: d.mimeType });
        storageId = await ctx.storage.store(blob);
      } else {
        // Multiple files — merge into one PDF
        const mergedBase64 = await mergeIntoPdf(downloads);
        const mergedBlob = new Blob([Buffer.from(mergedBase64, "base64")], { type: "application/pdf" });
        storageId = await ctx.storage.store(mergedBlob);
      }

      // Save the slip on the policy and transition to active
      await Promise.all([
        ctx.runMutation(internal.policies.updateInsuranceSlip, {
          policyId: policy._id,
          insuranceSlipStorageId: storageId,
        }),
        ctx.runMutation(internal.users.updateState, {
          userId: args.userId,
          state: "active",
        }),
      ]);

      const label = policy.category === "auto" ? "auto" : "homeowners";
      await sendAndLog(
        ctx,
        args.userId,
        args.phone,
        `Got it — saved your ${label} insurance slip. I'll use this instead of generating one. Ask me anything about your coverage!`,
        args.linqChatId,
        args.imessageSender
      );
    } catch (error: any) {
      console.error("Insurance slip processing failed:", error);
      await ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "active",
      });
      await sendAndLog(
        ctx,
        args.userId,
        args.phone,
        "Hmm I had trouble saving that — you can try again later or just ask me to generate one. What else can I help with?",
        args.linqChatId,
        args.imessageSender
      );
    }
  },
});

// ── Policy Merge Confirmation Handler ──

export const handleMergeConfirmation = internalAction({
  args: {
    userId: v.id("users"),
    phone: v.string(),
    input: v.string(),
    linqChatId: v.optional(v.string()),
    imessageSender: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const clean = args.input.toLowerCase().trim();
    const user = await ctx.runQuery(internal.users.get, { userId: args.userId });

    if (!user?.pendingMergePolicyId || !user?.pendingMergeStorageId) {
      await ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "active",
      });
      await sendAndLog(ctx, args.userId, args.phone,
        "No pending merge — what else can I help with?",
        args.linqChatId, args.imessageSender);
      return;
    }

    const confirmExact = ["yes", "yeah", "yep", "yup", "sure", "ok", "okay", "merge", "combine", "go", "do it", "go ahead", "sounds good", "please", "y"];
    const denyExact = ["no", "nah", "nope", "keep separate", "separate", "don't", "dont", "cancel", "skip", "n"];

    if (confirmExact.some((w) => clean === w)) {
      // Execute the merge
      await ctx.runAction(internal.process.executePolicyMerge, {
        userId: args.userId,
        existingPolicyId: user.pendingMergePolicyId,
        newStorageId: user.pendingMergeStorageId,
        phone: args.phone,
        linqChatId: args.linqChatId,
        imessageSender: args.imessageSender,
      });
    } else if (denyExact.some((w) => clean === w)) {
      // Keep as separate policy
      await Promise.all([
        ctx.runMutation(internal.users.clearPendingMerge, { userId: args.userId }),
        ctx.runMutation(internal.users.updateState, { userId: args.userId, state: "active" }),
      ]);
      await sendAndLog(ctx, args.userId, args.phone,
        "Ok, kept them as separate policies. Ask me anything about either one!",
        args.linqChatId, args.imessageSender);
    } else {
      // Unclear response — ask again
      await sendAndLog(ctx, args.userId, args.phone,
        "Just want to confirm — should I merge these documents into one policy? (yes/no)",
        args.linqChatId, args.imessageSender);
    }
  },
});

/** Handle yes/no confirmation for /clear command. */
export const handleClearConfirmation = internalAction({
  args: {
    userId: v.id("users"),
    phone: v.string(),
    input: v.string(),
    linqChatId: v.optional(v.string()),
    imessageSender: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const clean = args.input.toLowerCase().trim();

    const confirmExact = ["yes", "yeah", "yep", "yup", "sure", "ok", "okay", "go", "do it", "go ahead", "sounds good", "please", "y"];
    const denyExact = ["no", "nah", "nope", "cancel", "nevermind", "never mind", "n"];

    if (confirmExact.some((w) => clean === w)) {
      const count = await ctx.runMutation(internal.policies.deleteAllByUser, {
        userId: args.userId,
      });
      await ctx.runMutation(internal.reminders.cancelAllByUser, {
        userId: args.userId,
      });
      await ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "awaiting_policy",
      });

      const isImChannel = !!(args.linqChatId || args.imessageSender);
      const user = await ctx.runQuery(internal.users.get, { userId: args.userId });
      await sendBurst(ctx, args.userId, args.phone, [
        `Done — deleted ${count} ${count === 1 ? "policy" : "policies"} and cancelled any reminders.`,
        isImChannel
          ? "Send me a new policy PDF or photo whenever you're ready"
          : `Upload a new policy here: ${process.env.NEXT_PUBLIC_APP_URL || "https://spot.claritylabs.inc"}/app/${user?.uploadToken}`,
      ], args.linqChatId, args.imessageSender);
    } else if (denyExact.some((w) => clean === w)) {
      await ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "active",
      });
      await sendAndLog(ctx, args.userId, args.phone,
        "No worries — your policies are safe. What else can I help with?",
        args.linqChatId, args.imessageSender);
    } else {
      await sendAndLog(ctx, args.userId, args.phone,
        "Just want to confirm — delete all your policies and start fresh? (yes/no)",
        args.linqChatId, args.imessageSender);
    }
  },
});

/** Execute the actual PDF merge + re-extraction. */
export const executePolicyMerge = internalAction({
  args: {
    userId: v.id("users"),
    existingPolicyId: v.id("policies"),
    newStorageId: v.id("_storage"),
    phone: v.string(),
    linqChatId: v.optional(v.string()),
    imessageSender: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      const existingPolicy = await ctx.runQuery(internal.policies.getById, {
        policyId: args.existingPolicyId,
      });

      // Transition to active immediately so new messages during merge aren't re-routed here
      await Promise.all([
        ctx.runMutation(internal.users.clearPendingMerge, { userId: args.userId }),
        ctx.runMutation(internal.users.updateState, { userId: args.userId, state: "active" }),
      ]);

      if (!existingPolicy) {
        await sendAndLog(ctx, args.userId, args.phone,
          "Hmm I couldn't find the original policy — keeping this as a new one. What else can I help with?",
          args.linqChatId, args.imessageSender);
        return;
      }

      await sendAndLog(ctx, args.userId, args.phone,
        "Merging those documents now — one sec",
        args.linqChatId, args.imessageSender);

      // Download both PDFs
      const [existingBlob, newBlob] = await Promise.all([
        existingPolicy.pdfStorageId ? ctx.storage.get(existingPolicy.pdfStorageId) : null,
        ctx.storage.get(args.newStorageId),
      ]);

      if (!newBlob) throw new Error("New document not found in storage");

      let mergedBase64: string;

      if (existingBlob) {
        // Merge existing + new into one PDF
        const [existingBuffer, newBuffer] = await Promise.all([
          existingBlob.arrayBuffer(),
          newBlob.arrayBuffer(),
        ]);
        mergedBase64 = await mergeIntoPdf([
          { buffer: existingBuffer, mimeType: "application/pdf" },
          { buffer: newBuffer, mimeType: "application/pdf" },
        ]);
      } else {
        // No existing PDF — just use the new one
        const newBuffer = await newBlob.arrayBuffer();
        mergedBase64 = Buffer.from(newBuffer).toString("base64");
      }

      // Store merged PDF
      const mergedBlob = new Blob([Buffer.from(mergedBase64, "base64")], { type: "application/pdf" });
      const mergedStorageId = await ctx.storage.store(mergedBlob);

      // Re-extract from the merged document
      const mergeResult = await getExtractor().extract(mergedBase64);
      const { document: mergedDoc, chunks: mergedChunks } = mergeResult;
      const applied = documentToUpdateFields(mergedDoc, mergeResult);
      const detectedCategory = applied.category;

      // Update the existing policy with merged data, delete the duplicate
      const userPolicies = await ctx.runQuery(internal.policies.getByUser, {
        userId: args.userId,
      });
      const duplicatePolicy = userPolicies.find(
        (p: any) => p._id !== args.existingPolicyId && p.pdfStorageId === args.newStorageId
      );

      await Promise.all([
        ctx.runMutation(internal.policies.updateExtracted, {
          policyId: args.existingPolicyId,
          ...applied,
          status: "ready",
        }),
        // Store extraction chunks
        ctx.runMutation(internal.documentChunks.saveChunks, {
          policyId: args.existingPolicyId,
          userId: args.userId,
          chunks: sanitizeNulls(mergedChunks),
        }),
        // Update the storage ID to the merged PDF
        ctx.runMutation(internal.policies.updatePdfStorageId, {
          policyId: args.existingPolicyId,
          pdfStorageId: mergedStorageId,
        }),
        // Clean up the duplicate policy if found
        ...(duplicatePolicy
          ? [ctx.runMutation(internal.policies.remove, { policyId: duplicatePolicy._id })]
          : []),
      ]);

      // Extract contacts from merged document
      const contacts = extractContactsFromDocument(mergedDoc);
      for (const c of contacts) {
        await ctx.runMutation(internal.contacts.upsert, { userId: args.userId, ...c });
      }

      // Schedule async embedding of merged chunks
      ctx.scheduler.runAfter(0, internal.process.embedChunksForPolicy, {
        policyId: args.existingPolicyId,
        userId: args.userId,
      });

      const summary = buildPolicySummary(mergedDoc);
      const label = friendlyCategoryLabel(detectedCategory, applied.policyTypes);
      await sendBurst(ctx, args.userId, args.phone, [
        `Done — merged your ${label} documents and re-read the combined policy`,
        summary,
        "Ask me anything about your coverage, or type /merge to check for more duplicates",
      ], args.linqChatId, args.imessageSender);
    } catch (error: any) {
      console.error("Policy merge failed:", error);
      // State already set to active at start — just notify
      await sendAndLog(ctx, args.userId, args.phone,
        "I had trouble merging those — both documents are saved separately. What else can I help with?",
        args.linqChatId, args.imessageSender);
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

    // Match confirmation/cancellation/undo — use .includes() so "yup all good" matches "good", "yup", etc.
    const confirmWords = ["send", "yes", "yeah", "yep", "yup", "go", "ok", "okay", "sure", "do it", "confirm", "good", "looks good", "all good", "sounds good", "go ahead", "ship it", "fire away"];
    const cancelWords = ["cancel", "don't", "stop", "never mind", "nevermind", "scratch that"];
    const hardNo = ["no", "nah", "nope"]; // only match if the entire message is just "no"
    const undoWords = ["undo"];

    if (pending.status === "scheduled" && undoWords.some(w => clean.includes(w))) {
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

    if (cancelWords.some(w => clean.includes(w)) || hardNo.some(w => clean === w)) {
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

    if (confirmWords.some(w => clean.includes(w))) {
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
        `Sent! ${pending.recipientName || pending.recipientEmail} should have it shortly`,
        args.linqChatId,
        args.imessageSender
      );
      return;
    }

    // Unrecognized — don't re-prompt robotically, just nudge naturally
    await sendAndLog(
      ctx,
      args.userId,
      args.phone,
      `Just checking — should I send that email to ${pending.recipientEmail}?`,
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
    const clean = args.input.toLowerCase().trim();

    // If user replies with a confirmation word (not an email), they might be confirming
    // a prior email that Claude asked about. Check if we already have their email on file.
    const confirmWords = ["yes", "yeah", "yep", "yup", "correct", "that's right", "ok", "okay", "sure"];
    if (confirmWords.some(w => clean === w || clean === w + "!")) {
      const existingUser = await ctx.runQuery(internal.users.get, { userId: args.userId });
      if (existingUser?.email) {
        // They already have an email — this was a confirmation, not a new email
        // Check for pending email and resume flow
        const pending = await ctx.runQuery(internal.email.getPendingForUser, { userId: args.userId });
        if (pending) {
          await ctx.runMutation(internal.users.updateState, { userId: args.userId, state: "awaiting_email_confirm" });
          await sendAndLog(ctx, args.userId, args.phone,
            `Got it — using ${existingUser.email}. Ready to send to ${pending.recipientEmail}. Reply "send" to confirm.`,
            args.linqChatId, args.imessageSender);
        } else {
          await ctx.runMutation(internal.users.updateState, { userId: args.userId, state: "active" });
          await sendAndLog(ctx, args.userId, args.phone,
            `Your email is ${existingUser.email}. What can I help you with?`,
            args.linqChatId, args.imessageSender);
        }
        return;
      }
    }

    // Try to extract an email address
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    const match = args.input.match(emailRegex);

    if (!match) {
      await sendAndLog(
        ctx,
        args.userId,
        args.phone,
        "I need your email address so I can CC you on emails I send. What's your email?",
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

    // Check if there's a pending email that was waiting for the user's email to be set
    const pending = await ctx.runQuery(internal.email.getPendingForUser, {
      userId: args.userId,
    });

    if (pending && pending.status === "awaiting_confirmation") {
      // Update the CC email on the pending email now that we have it
      await ctx.runMutation(internal.email.updatePendingEmailStatus, {
        pendingEmailId: pending._id,
        status: "awaiting_confirmation", // keep same status, just update the CC
      });
      // Move to email confirm state
      await ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "awaiting_email_confirm",
      });
      await sendAndLog(
        ctx,
        args.userId,
        args.phone,
        `Got it — ${email}. I have an email ready to send to ${pending.recipientEmail} (${pending.subject}). Want me to send it?`,
        args.linqChatId,
        args.imessageSender
      );
    } else {
      await ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "active",
      });
      await sendAndLog(
        ctx,
        args.userId,
        args.phone,
        `Got it — ${email}. What can I help you with?`,
        args.linqChatId,
        args.imessageSender
      );
    }
  },
});

// ── Application Question Handler (state: "awaiting_app_questions") ──

export const handleAppQuestions = internalAction({
  args: {
    userId: v.id("users"),
    phone: v.string(),
    input: v.string(),
    linqChatId: v.optional(v.string()),
    imessageSender: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const clean = args.input.toLowerCase().trim();

    // Check for /autofill toggle
    if (clean === "/autofill on") {
      await ctx.runMutation(internal.users.setAutoFillApplications, {
        userId: args.userId,
        autoFillApplications: true,
      });
      await sendAndLog(ctx, args.userId, args.phone,
        "Auto-fill is on — I'll skip confirmations for pre-filled answers from now on",
        args.linqChatId, args.imessageSender);
      return;
    }
    if (clean === "/autofill off") {
      await ctx.runMutation(internal.users.setAutoFillApplications, {
        userId: args.userId,
        autoFillApplications: false,
      });
      await sendAndLog(ctx, args.userId, args.phone,
        "Auto-fill is off — I'll ask you to confirm pre-filled answers",
        args.linqChatId, args.imessageSender);
      return;
    }

    // Allow cancellation
    if (clean === "cancel" || clean === "/cancel" || clean === "stop") {
      const user = await ctx.runQuery(internal.users.get, { userId: args.userId });
      if (user?.activeApplicationId) {
        await ctx.runMutation(internal.applications.updateStatus, {
          applicationId: user.activeApplicationId,
          status: "failed",
        });
      }
      await ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "active",
      });
      await ctx.runMutation(internal.users.setActiveApplication, {
        userId: args.userId,
        activeApplicationId: undefined,
      });
      await sendAndLog(ctx, args.userId, args.phone,
        "No problem — cancelled the application. Let me know if you want to try again",
        args.linqChatId, args.imessageSender);
      return;
    }

    // Get the active application
    const user = await ctx.runQuery(internal.users.get, { userId: args.userId });
    if (!user?.activeApplicationId) {
      await ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "active",
      });
      await sendAndLog(ctx, args.userId, args.phone,
        "Looks like there's no active application. Send me an application PDF and I'll help you fill it out",
        args.linqChatId, args.imessageSender);
      return;
    }

    const app = await ctx.runQuery(internal.applications.getById, {
      applicationId: user.activeApplicationId,
    });
    if (!app) {
      await ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "active",
      });
      await sendAndLog(ctx, args.userId, args.phone,
        "Something went wrong with the application. Send it again and I'll start over",
        args.linqChatId, args.imessageSender);
      return;
    }

    const fields = (app.fields || []) as Array<{
      id: string;
      question: string;
      section?: string;
      type: string;
      choices?: string[];
      required: boolean;
    }>;
    const answers = (app.answers || {}) as Record<string, { value: string; source: string }>;
    const currentBatch = app.currentBatchIndex || 0;

    // Get unanswered fields
    const unansweredRequired = fields.filter((f) => f.required && !answers[f.id]);
    const unansweredOptional = fields.filter((f) => !f.required && !answers[f.id]);
    const unanswered = [...unansweredRequired, ...unansweredOptional];

    const BATCH_SIZE = 5;

    // If user confirms pre-filled data ("yes", "looks good", etc.)
    const confirmWords = ["yes", "yeah", "yep", "yup", "correct", "looks good", "looks right", "good", "ok", "okay", "sure", "confirm", "confirmed", "right"];
    const isConfirm = confirmWords.some((w) => clean === w || clean === w + "!");

    if (isConfirm) {
      // Mark all policy-sourced answers as confirmed
      const updatedAnswers = { ...answers };
      for (const [fieldId, ans] of Object.entries(updatedAnswers)) {
        if (ans.source === "policy") {
          updatedAnswers[fieldId] = { ...ans, source: "confirmed" };
        }
      }

      if (unanswered.length === 0) {
        // All fields answered — proceed to filling
        await ctx.runMutation(internal.applications.updateAnswers, {
          applicationId: app._id,
          answers: updatedAnswers,
          status: "confirming",
        });
        await ctx.runMutation(internal.users.updateState, {
          userId: args.userId,
          state: "awaiting_app_confirm",
        });
        await sendAndLog(ctx, args.userId, args.phone,
          "All fields are filled. Ready for me to generate the completed application? (yes/no)",
          args.linqChatId, args.imessageSender);
        return;
      }

      // Start asking unanswered questions
      await ctx.runMutation(internal.applications.updateAnswers, {
        applicationId: app._id,
        answers: updatedAnswers,
        currentBatchIndex: 0,
      });

      const batch = unanswered.slice(0, BATCH_SIZE);
      const batchText = batch.map((f, i) =>
        `${i + 1}. ${f.question}${f.choices ? ` (${f.choices.join(", ")})` : ""}${f.type === "boolean" ? " (yes/no)" : ""}`
      ).join("\n");

      await sendAndLog(ctx, args.userId, args.phone,
        `${unanswered.length} questions to go. Here are the first ${batch.length}:\n\n${batchText}\n\nReply with your answers numbered (e.g. "1. John Smith, 2. 01/15/1990...")`,
        args.linqChatId, args.imessageSender);
      return;
    }

    // Parse numbered answers from user input
    const answerLines = args.input.split(/\n/).map((l) => l.trim()).filter(Boolean);
    const parsedAnswers: Array<{ index: number; value: string }> = [];

    for (const line of answerLines) {
      // Match patterns like "1. answer", "1: answer", "1) answer", or just process sequentially
      const match = line.match(/^(\d+)[.):]\s*(.+)/);
      if (match) {
        parsedAnswers.push({ index: parseInt(match[1]) - 1, value: match[2].trim() });
      } else if (answerLines.length === 1 && unanswered.length > 0) {
        // Single answer without numbering — applies to first unanswered in current batch
        parsedAnswers.push({ index: 0, value: line.trim() });
      }
    }

    // If user sent a correction for pre-filled data (e.g. "name should be John Doe")
    if (parsedAnswers.length === 0 && !isConfirm) {
      // Use Claude to interpret the correction
      const currentAnswersSummary = Object.entries(answers)
        .map(([fieldId, ans]) => {
          const field = fields.find((f) => f.id === fieldId);
          return `${field?.question || fieldId}: ${ans.value} (source: ${ans.source})`;
        })
        .join("\n");

      const batchStart = currentBatch * BATCH_SIZE;
      const currentBatchFields = unanswered.slice(batchStart, batchStart + BATCH_SIZE);

      const result = await generateTextWithFallback({
        model: getModel("qa"),
        system: `You are helping fill an insurance application. The user is responding to questions or correcting pre-filled answers.

Current fields and answers:
${currentAnswersSummary}

Current batch of unanswered questions:
${currentBatchFields.map((f, i) => `${i + 1}. [${f.id}] ${f.question}`).join("\n")}

All unanswered fields:
${unanswered.map((f) => `[${f.id}] ${f.question}`).join("\n")}

Parse the user's response and return a JSON object with field updates.
If they're correcting a pre-filled answer, identify which field and the new value.
If they're answering batch questions, map answers to field IDs.
Respond ONLY with valid JSON: {"updates": [{"fieldId": "...", "value": "..."}]}
If you can't parse their intent, respond with: {"updates": [], "clarification": "..."}`,
        prompt: args.input,
        maxOutputTokens: 500,
      });

      try {
        const parsed = JSON.parse(result.text);
        if (parsed.updates && parsed.updates.length > 0) {
          const updatedAnswers = { ...answers };
          for (const update of parsed.updates) {
            updatedAnswers[update.fieldId] = { value: update.value, source: "user" };
          }
          await ctx.runMutation(internal.applications.updateAnswers, {
            applicationId: app._id,
            answers: updatedAnswers,
          });

          // Recalculate unanswered
          const stillUnanswered = fields.filter((f) => !updatedAnswers[f.id]);
          if (stillUnanswered.length === 0) {
            await ctx.runMutation(internal.users.updateState, {
              userId: args.userId,
              state: "awaiting_app_confirm",
            });
            await ctx.runMutation(internal.applications.updateAnswers, {
              applicationId: app._id,
              answers: updatedAnswers,
              status: "confirming",
            });
            await sendAndLog(ctx, args.userId, args.phone,
              "Got it — all fields are now filled. Ready for me to generate the completed application? (yes/no)",
              args.linqChatId, args.imessageSender);
          } else {
            await sendAndLog(ctx, args.userId, args.phone,
              `Updated! ${stillUnanswered.length} fields left to go`,
              args.linqChatId, args.imessageSender);
          }
          return;
        }

        if (parsed.clarification) {
          await sendAndLog(ctx, args.userId, args.phone,
            parsed.clarification,
            args.linqChatId, args.imessageSender);
          return;
        }
      } catch (_) {
        // Fall through to generic response
      }

      await sendAndLog(ctx, args.userId, args.phone,
        "I didn't quite get that. Reply with numbered answers (e.g. \"1. John Smith\") or say \"cancel\" to stop",
        args.linqChatId, args.imessageSender);
      return;
    }

    // Apply parsed answers to the current batch
    if (parsedAnswers.length > 0) {
      const batchStart = currentBatch * BATCH_SIZE;
      const currentBatchFields = unanswered.slice(batchStart, batchStart + BATCH_SIZE);
      const updatedAnswers = { ...answers };

      for (const pa of parsedAnswers) {
        if (pa.index >= 0 && pa.index < currentBatchFields.length) {
          const field = currentBatchFields[pa.index];
          updatedAnswers[field.id] = { value: pa.value, source: "user" };
        }
      }

      // Check remaining unanswered after this batch
      const nowUnanswered = fields.filter((f) => !updatedAnswers[f.id]);

      if (nowUnanswered.length === 0) {
        // All done — move to confirmation
        await ctx.runMutation(internal.applications.updateAnswers, {
          applicationId: app._id,
          answers: updatedAnswers,
          currentBatchIndex: currentBatch + 1,
          status: "confirming",
        });

        // If autofill is on, skip confirmation
        if (user.autoFillApplications) {
          await ctx.scheduler.runAfter(0, internal.applicationActions.fillApplicationPdf, {
            applicationId: app._id,
            userId: args.userId,
            phone: args.phone,
            linqChatId: args.linqChatId,
            imessageSender: args.imessageSender,
          });
          return;
        }

        await ctx.runMutation(internal.users.updateState, {
          userId: args.userId,
          state: "awaiting_app_confirm",
        });
        await sendAndLog(ctx, args.userId, args.phone,
          "All fields are filled. Ready for me to generate the completed application? (yes/no)",
          args.linqChatId, args.imessageSender);
        return;
      }

      // More questions — send next batch
      const nextBatchStart = 0; // Recalculate from remaining unanswered
      const nextBatch = nowUnanswered.slice(0, BATCH_SIZE);
      const newBatchNum = currentBatch + 1;

      await ctx.runMutation(internal.applications.updateAnswers, {
        applicationId: app._id,
        answers: updatedAnswers,
        currentBatchIndex: newBatchNum,
      });

      const batchText = nextBatch.map((f, i) =>
        `${i + 1}. ${f.question}${f.choices ? ` (${f.choices.join(", ")})` : ""}${f.type === "boolean" ? " (yes/no)" : ""}`
      ).join("\n");

      await sendAndLog(ctx, args.userId, args.phone,
        `Got it! ${nowUnanswered.length} left:\n\n${batchText}`,
        args.linqChatId, args.imessageSender);
    }
  },
});

// ── Application Confirmation Handler (state: "awaiting_app_confirm") ──

export const handleAppConfirmation = internalAction({
  args: {
    userId: v.id("users"),
    phone: v.string(),
    input: v.string(),
    linqChatId: v.optional(v.string()),
    imessageSender: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const clean = args.input.toLowerCase().trim();

    // Allow cancel
    if (clean === "cancel" || clean === "/cancel" || clean === "no") {
      const user = await ctx.runQuery(internal.users.get, { userId: args.userId });
      if (user?.activeApplicationId) {
        await ctx.runMutation(internal.applications.updateStatus, {
          applicationId: user.activeApplicationId,
          status: "failed",
        });
      }
      await ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "active",
      });
      await ctx.runMutation(internal.users.setActiveApplication, {
        userId: args.userId,
        activeApplicationId: undefined,
      });
      await sendAndLog(ctx, args.userId, args.phone,
        "No problem — cancelled the application",
        args.linqChatId, args.imessageSender);
      return;
    }

    // Confirm — generate the filled PDF
    const confirmWords = ["yes", "yeah", "yep", "yup", "go", "sure", "do it", "okay", "ok", "send it", "generate", "fill it"];
    if (confirmWords.some((w) => clean === w || clean === w + "!")) {
      const user = await ctx.runQuery(internal.users.get, { userId: args.userId });
      if (!user?.activeApplicationId) {
        await ctx.runMutation(internal.users.updateState, {
          userId: args.userId,
          state: "active",
        });
        await sendAndLog(ctx, args.userId, args.phone,
          "Something went wrong — no active application found",
          args.linqChatId, args.imessageSender);
        return;
      }

      await ctx.scheduler.runAfter(0, internal.applicationActions.fillApplicationPdf, {
        applicationId: user.activeApplicationId,
        userId: args.userId,
        phone: args.phone,
        linqChatId: args.linqChatId,
        imessageSender: args.imessageSender,
      });
      return;
    }

    // Unrecognized
    await sendAndLog(ctx, args.userId, args.phone,
      "Want me to generate the filled application? (yes/no)",
      args.linqChatId, args.imessageSender);
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
    imageMimeType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      const clean = args.question.toLowerCase().trim();

      // /help command — list all available commands
      if (clean === "/help" || clean === "help" || clean === "commands") {
        const helpText = [
          "Here's what I can do:",
          "",
          "/help — show this list",
          "/contacts — view your saved contacts",
          "/merge — scan for duplicate policies to merge",
          "/apply — start filling an insurance application",
          "/clear — delete all your policies and start fresh",
          "/autosend on/off — toggle email send confirmation",
          "/autofill on/off — toggle application fill confirmation",
          "/debug — show current account state",
          "/logs — show recent message history",
          "/undo — cancel a recently sent email",
          "",
          "You can also just text me naturally — ask about your policy, send me docs, or ask me to email someone",
        ].join("\n");
        await sendAndLog(ctx, args.userId, args.phone, helpText, args.linqChatId, args.imessageSender);
        return;
      }

      // /apply command — prompt to send an application
      if (clean === "/apply" || clean === "fill application" || clean === "fill an application") {
        // Check if there's already an active application
        const activeApp = await ctx.runQuery(internal.applications.getActiveByUser, {
          userId: args.userId,
        });
        if (activeApp) {
          await sendAndLog(ctx, args.userId, args.phone,
            "You already have an application in progress. Say \"cancel\" to stop it, or keep answering the questions",
            args.linqChatId, args.imessageSender);
          return;
        }

        const isImChannel = !!(args.linqChatId || args.imessageSender);
        if (isImChannel) {
          await sendAndLog(ctx, args.userId, args.phone,
            "Send me the application PDF and I'll help you fill it out. I can pre-fill from your existing policies",
            args.linqChatId, args.imessageSender);
        } else {
          const link = getUploadLink(args.uploadToken);
          await sendAndLog(ctx, args.userId, args.phone,
            `Upload your application PDF here and I'll help you fill it out:\n\n${link}`,
            args.linqChatId, args.imessageSender);
        }
        return;
      }

      // /contacts command — view your saved contacts
      if (clean === "/contacts" || clean === "contacts" || clean === "my contacts") {
        const contacts = await ctx.runQuery(internal.contacts.getByUser, {
          userId: args.userId,
        });

        if (contacts.length === 0) {
          await sendAndLog(ctx, args.userId, args.phone,
            "No saved contacts yet. When you send an email through me, I'll automatically save the recipient so you can use their name next time.",
            args.linqChatId, args.imessageSender);
          return;
        }

        const contactList = contacts.map((c: any, i: number) =>
          `${i + 1}. ${c.name}${c.label ? ` (${c.label})` : ""} — ${c.email}`
        ).join("\n");

        await sendBurst(ctx, args.userId, args.phone, [
          `Your saved contacts:`,
          contactList,
          "Just mention a name when you want to send something — like \"send proof to John\"",
        ], args.linqChatId, args.imessageSender);
        return;
      }

      // /clear command — delete all policies and start fresh (with confirmation)
      if (clean === "/clear" || clean === "clear my policies" || clean === "delete all policies") {
        const allPolicies = await ctx.runQuery(internal.policies.getByUser, {
          userId: args.userId,
        });

        if (allPolicies.length === 0) {
          await sendAndLog(ctx, args.userId, args.phone,
            "You don't have any policies to clear.",
            args.linqChatId, args.imessageSender);
          return;
        }

        const count = allPolicies.length;
        await ctx.runMutation(internal.users.updateState, {
          userId: args.userId,
          state: "awaiting_clear_confirm",
        });

        await sendAndLog(ctx, args.userId, args.phone,
          `This will permanently delete ${count === 1 ? "your 1 policy" : `all ${count} of your policies`} and cancel any reminders. Are you sure? (yes/no)`,
          args.linqChatId, args.imessageSender);
        return;
      }

      // /merge command — scan all policies for merge candidates
      if (clean === "/merge" || clean === "merge my policies") {
        const allPolicies = await ctx.runQuery(internal.policies.getByUser, {
          userId: args.userId,
        });
        const readyPolicies = allPolicies.filter((p: any) => p.status === "ready");

        if (readyPolicies.length <= 1) {
          await sendAndLog(ctx, args.userId, args.phone,
            readyPolicies.length === 0
              ? "You don't have any policies uploaded yet."
              : "You only have one policy — nothing to merge.",
            args.linqChatId, args.imessageSender);
          return;
        }

        // Find merge candidates: group by carrier+policyNumber or carrier+category
        const mergeCandidates: Array<{ a: any; b: any; reason: string }> = [];
        for (let i = 0; i < readyPolicies.length; i++) {
          for (let j = i + 1; j < readyPolicies.length; j++) {
            const a = readyPolicies[i];
            const b = readyPolicies[j];

            // Same policy number
            if (a.policyNumber && b.policyNumber &&
                a.policyNumber.toLowerCase() === b.policyNumber.toLowerCase()) {
              mergeCandidates.push({ a, b, reason: `same policy #${a.policyNumber}` });
              continue;
            }

            // Same carrier + same category
            if (a.carrier && b.carrier &&
                a.carrier.toLowerCase() === b.carrier.toLowerCase() &&
                a.category === b.category) {
              mergeCandidates.push({ a, b, reason: `both ${a.carrier} ${CATEGORY_LABELS[a.category] || a.category}` });
            }
          }
        }

        if (mergeCandidates.length === 0) {
          const policyList = readyPolicies.map((p: any, i: number) =>
            `${i + 1}. ${p.carrier || "Unknown"} — ${CATEGORY_LABELS[p.category] || p.category}${p.policyNumber ? ` (#${p.policyNumber})` : ""}`
          ).join("\n");
          await sendBurst(ctx, args.userId, args.phone, [
            `You have ${readyPolicies.length} policies:`,
            policyList,
            "They all look like separate policies — no merges needed.",
          ], args.linqChatId, args.imessageSender);
          return;
        }

        // Take the first merge candidate and prompt for it
        const { a, b, reason } = mergeCandidates[0];
        const keepPolicy = a.createdAt <= b.createdAt ? a : b; // keep older
        const mergePolicy = a.createdAt <= b.createdAt ? b : a;

        await Promise.all([
          ctx.runMutation(internal.users.setPendingMerge, {
            userId: args.userId,
            pendingMergePolicyId: keepPolicy._id,
            pendingMergeStorageId: mergePolicy.pdfStorageId!,
          }),
          ctx.runMutation(internal.users.updateState, {
            userId: args.userId,
            state: "awaiting_merge_confirm",
          }),
        ]);

        await sendBurst(ctx, args.userId, args.phone, [
          `Found ${mergeCandidates.length} potential merge${mergeCandidates.length > 1 ? "s" : ""}`,
          `These two look like they belong together (${reason}):\n· ${keepPolicy.carrier || "Unknown"} — uploaded first\n· ${mergePolicy.carrier || "Unknown"} — uploaded later`,
          "Want me to merge them into one? (yes/no)",
        ], args.linqChatId, args.imessageSender);
        return;
      }

      // /debug command — dump current state for troubleshooting
      if (clean === "/debug" || clean === "debug") {
        const [dbUser, dbPolicies, dbPending, dbReminders] = await Promise.all([
          ctx.runQuery(internal.users.get, { userId: args.userId }),
          ctx.runQuery(internal.policies.getByUser, { userId: args.userId }),
          ctx.runQuery(internal.email.getPendingForUser, { userId: args.userId }),
          ctx.runQuery(internal.reminders.getByUser, { userId: args.userId }),
        ]);
        const debugInfo = [
          `🔧 Debug Info`,
          `State: ${dbUser?.state || "unknown"}`,
          `Email: ${dbUser?.email || "not set"}`,
          `Auto-send: ${dbUser?.autoSendEmails ? "on" : "off"}`,
          `Policies: ${dbPolicies.length} (${dbPolicies.filter((p: any) => p.status === "ready").length} ready)`,
          ...dbPolicies.map((p: any) => `  · ${p.category} — ${p.carrier || "?"} — ${p.status}`),
          `Pending email: ${dbPending ? `${dbPending.status} → ${dbPending.recipientEmail}` : "none"}`,
          `Reminders: ${dbReminders.length} (${dbReminders.filter((r: any) => r.status === "pending").length} pending)`,
          `Channel: ${dbUser?.linqChatId ? "linq" : dbUser?.imessageSender ? "imessage_bridge" : "openphone"}`,
          `Upload token: ${dbUser?.uploadToken || "none"}`,
        ].join("\n");
        await sendAndLog(ctx, args.userId, args.phone, debugInfo, args.linqChatId, args.imessageSender);
        return;
      }

      // /logs command — show recent message history + email activity
      if (clean === "/logs" || clean === "logs") {
        const [dbMessages, dbPendingAll] = await Promise.all([
          ctx.runQuery(internal.messages.getRecentByUser, { userId: args.userId, limit: 15 }),
          ctx.runQuery(internal.email.getPendingForUser, { userId: args.userId }),
        ]);
        const msgLines = dbMessages.map((m: any) => {
          const dir = m.direction === "inbound" ? "→" : "←";
          const ch = m.channel ? `[${m.channel}]` : "";
          const ts = new Date(m.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
          const body = m.body.slice(0, 80) + (m.body.length > 80 ? "…" : "");
          return `${ts} ${dir} ${ch} ${body}`;
        });
        const pendingLine = dbPendingAll
          ? `\n📧 Pending: ${dbPendingAll.status} → ${dbPendingAll.recipientEmail} (${dbPendingAll.subject.slice(0, 40)})`
          : "\n📧 No pending emails";
        const logText = `📋 Recent Messages (${dbMessages.length})\n${msgLines.join("\n")}${pendingLine}`;
        await sendAndLog(ctx, args.userId, args.phone, logText, args.linqChatId, args.imessageSender);
        return;
      }

      // Check for undo command (quick path — user might reply "undo" after email sent)
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

      const [policies, user, recentMessages, userMemories] = await Promise.all([
        ctx.runQuery(internal.policies.getByUser, { userId: args.userId }),
        ctx.runQuery(internal.users.get, { userId: args.userId }),
        ctx.runQuery(internal.messages.getRecentByUser, { userId: args.userId, limit: 20 }),
        ctx.runQuery(internal.memory.getForUser, { userId: args.userId }),
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
        siteUrl: "https://spot.claritylabs.inc",
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
- Email a completed insurance application to someone using send_application (only if one has been filled)
- If the user asks to fill an application, tell them to send the application PDF or say /apply

CRITICAL email rules:
- When an email tool returns "awaitingConfirmation", the email has NOT been sent yet. It is DRAFTED and waiting for the user to confirm.
- Ask naturally — like "I'll send a COI to [name] at [email] for your [policy type] policy. Good to go?" or "Sending proof of insurance to [name]. Sound right?"
- Do NOT say "Sent!", "Done!", or imply the email was already sent.
- Do NOT mention commands like "reply send" or "reply cancel" — just ask if they want you to send it. The system handles the rest.
- Only say "Sent!" if the tool returns "autoSent: true" (meaning auto-send is enabled).
- If the tool returns "no_email", ask the user for their email address naturally.
- ONE confirmation is enough. Don't re-ask if they already said yes or confirmed.

Proactive awareness:
- When answering scenario questions ("Am I covered if..."), ALWAYS check the policy exclusions. If a relevant exclusion exists, mention it naturally: "Your policy does cover X, but heads up — there's an exclusion for Y."
- If you notice something in the user's question that relates to a known risk note or gap from the health check findings, mention it naturally.
- If the user mentions a personal detail worth remembering (moving, buying something expensive, changing jobs), use the save_memory tool to record it for future reference.
- Don't be pushy about gaps — mention them once when relevant, not repeatedly.
`;

      // Build document context from InsuranceDocument objects stored in rawExtracted
      const documents: InsuranceDocument[] = readyPolicies
        .map((p: any) => p.rawExtracted as InsuranceDocument)
        .filter(Boolean);
      const documentContext = buildDocumentContextFromDocs(documents);

      const isImChannel = !!(args.linqChatId || args.imessageSender);
      const maxOutputTokens = isImChannel ? 800 : 400;

      // Build conversation history from recent messages (gives Claude context of prior exchanges)
      const conversationMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
      for (const msg of recentMessages) {
        // Skip empty messages, system-generated messages, and debug output
        if (!msg.body || msg.body.trim() === "") continue;
        if (msg.body.startsWith("[Email")) continue;
        if (msg.body.startsWith("🔧 Debug")) continue;
        const role = msg.direction === "inbound" ? "user" as const : "assistant" as const;
        // Collapse consecutive same-role messages
        const last = conversationMessages[conversationMessages.length - 1];
        if (last && last.role === role) {
          last.content += "\n" + msg.body;
        } else {
          conversationMessages.push({ role, content: msg.body });
        }
      }

      // Ensure conversation starts with user and alternates properly
      // Remove trailing messages — the current question will be the final user message
      // Keep last ~15 messages for context without blowing up the prompt
      const trimmedHistory = conversationMessages.slice(-15);

      // Build the final user message content (may include image)
      const userContent: any[] = [];
      let attachmentAnalysis = "";

      const imageId = args.imageStorageId || user?.lastImageId;
      const imageMime = args.imageMimeType || user?.lastImageMimeType || "image/jpeg";
      if (imageId) {
        try {
          const imageBlob = await ctx.storage.get(imageId);
          if (imageBlob) {
            const imageBuffer = await imageBlob.arrayBuffer();
            const imageBase64 = Buffer.from(imageBuffer).toString("base64");

            // Add raw image to user message for the model to see
            userContent.push({
              type: "image",
              image: imageBase64,
              mediaType: imageMime,
            });

            // Use SDK query agent to interpret the attachment with policy context
            try {
              const queryAgent = getQueryAgent(ctx, args.userId);
              const queryResult = await queryAgent.query({
                question: args.question,
                attachments: [{
                  kind: "image",
                  name: "user-photo",
                  mimeType: imageMime,
                  base64: imageBase64,
                }],
              });
              const qr = queryResult as any;
              if (qr.answer) {
                attachmentAnalysis = `\n\nATTACHMENT ANALYSIS (from document intelligence):\n${qr.answer}`;
                if (qr.citations && qr.citations.length > 0) {
                  const citationNotes = qr.citations
                    .map((c: any) => `[${c.field || c.documentType || "doc"}]: "${c.quote}"`)
                    .join("\n");
                  attachmentAnalysis += `\n\nRelevant policy excerpts:\n${citationNotes}`;
                }
              }
            } catch (sdkErr) {
              console.warn("SDK query agent attachment interpretation failed, continuing without:", sdkErr);
              // Non-fatal — the model still sees the raw image
            }
          }
        } catch (_) {}
      }

      userContent.push({ type: "text", text: args.question });

      // Build messages array: history + current question
      const aiMessages: any[] = [];
      for (const msg of trimmedHistory) {
        // Double-check: skip any messages with empty content
        if (typeof msg.content === "string" && msg.content.trim() === "") continue;
        aiMessages.push(msg);
      }
      // Remove the last entry if it duplicates the current question
      if (aiMessages.length > 0 && aiMessages[aiMessages.length - 1].role === "user") {
        const lastBody = (typeof aiMessages[aiMessages.length - 1].content === "string"
          ? aiMessages[aiMessages.length - 1].content : "").trim().toLowerCase();
        if (lastBody === args.question.trim().toLowerCase()) {
          aiMessages.pop();
        }
      }
      // Ensure the conversation doesn't start with assistant
      while (aiMessages.length > 0 && aiMessages[0].role === "assistant") {
        aiMessages.shift();
      }
      // Add the current question as the final user message
      aiMessages.push({ role: "user", content: userContent });

      // Define tools
      // Track tool side effects
      let pendingEmailCreated = false;
      let pendingEmailId: any = null;
      let emailRequested = false;

      // Also include pending email context if there's one awaiting confirmation
      const pendingEmailCtx = await ctx.runQuery(internal.email.getPendingForUser, { userId: args.userId });
      const pendingEmailNote = pendingEmailCtx
        ? `\n\nPENDING EMAIL: There is a pending email to ${pendingEmailCtx.recipientEmail} (subject: "${pendingEmailCtx.subject}", status: ${pendingEmailCtx.status}). If the user seems to be confirming or asking about this email, tell them to reply "send" to confirm or "cancel" to stop.`
        : "";

      // Load saved contacts
      const savedContacts = await ctx.runQuery(internal.contacts.getByUser, { userId: args.userId });
      const contactsNote = savedContacts.length > 0
        ? `\n\nSAVED CONTACTS:\n${savedContacts.map((c: any) => `· ${c.name}${c.label ? ` (${c.label})` : ""} — ${c.email}`).join("\n")}\nWhen the user mentions a contact by name (e.g. "send it to John"), use the lookup_contact tool to find their email. If a match is found, use it directly without asking for the email again.`
        : "";

      // Check for completed applications
      const userApps = await ctx.runQuery(internal.applications.getByUser, { userId: args.userId });
      const readyApp = userApps.find((a: any) => a.status === "ready" && a.filledPdfStorageId);
      const appNote = readyApp
        ? `\n\nCOMPLETED APPLICATION: The user has a filled "${readyApp.title || "insurance application"}" ready to send. If they ask to send/email the application, use the send_application tool.`
        : "";

      // Build memory context — persistent knowledge about this person
      const memoryBlock = buildMemoryContext(userMemories);

      // Include policy analysis context (health check findings)
      const analysisContext = readyPolicies
        .filter((p: any) => p.analysis?.naturalSummary)
        .map((p: any) => `${p.carrier || p.category}: ${p.analysis.naturalSummary}`)
        .join("\n");
      const analysisNote = analysisContext
        ? `\n\nPOLICY HEALTH CHECK FINDINGS:\n${analysisContext}`
        : "";

      const result = await generateTextWithFallback({
        model: getModel("qa"),
        system: `${complianceGuardrails}\n\n${sdkPrompt}\n\nHere are the user's insurance documents:\n${documentContext}${attachmentAnalysis}\n\nUser's email on file: ${user?.email || "none"}\nUser's name: ${user?.name || "Unknown"}${memoryBlock}${analysisNote}${pendingEmailNote}${contactsNote}${appNote}`,
        messages: aiMessages,
        maxOutputTokens,
        tools: {
          send_email: tool({
            description: "Send an email with policy information to someone (landlord, lender, agent, etc). The user will be CC'd. Always confirm before sending.",
            inputSchema: z.object({
              recipientEmail: z.string().email().describe("Recipient's email address"),
              recipientName: z.string().optional().describe("Recipient's name"),
              purpose: z.enum(["proof_of_insurance", "coverage_details", "coi", "general_info"]).describe("Type of email to send"),
              coverageNames: z.array(z.string()).optional().describe("Specific coverage names to include (for coverage_details)"),
              customMessage: z.string().optional().describe("Optional custom message to include"),
              policyId: z.string().optional().describe("Specific policy ID if user has multiple"),
            }),
            execute: async (input) => {
              try {
                if (!user?.email) {
                  return { success: false, reason: "no_email", message: "User doesn't have an email on file. Use request_email to ask for it first." };
                }

                const targetPolicy = input.policyId
                  ? readyPolicies.find((p: any) => p._id === input.policyId)
                  : readyPolicies[0];
                if (!targetPolicy) return { success: false, reason: "no_policy", message: "No policy found" };

                const userName = user.name || targetPolicy.insuredName || "Policyholder";
                const raw = targetPolicy.rawExtracted || targetPolicy;
                const insurer = raw.security || raw.carrierLegalName || raw.carrier || "Insurer";

                // Generate AI-written plaintext email body
                const emailBody = await ctx.runAction(internal.emailActions.generateEmailBody, {
                  purpose: input.purpose,
                  recipientName: input.recipientName || "Recipient",
                  recipientEmail: input.recipientEmail,
                  userName,
                  userEmail: user.email,
                  policyData: raw,
                  customMessage: input.customMessage,
                  coverageNames: input.coverageNames,
                });

                // Build subject line
                const subjectPrefixes: Record<string, string> = {
                  proof_of_insurance: `Proof of Insurance — ${insurer} Policy ${raw.policyNumber || ""}`,
                  coverage_details: `Coverage Details — ${insurer}`,
                  coi: `Certificate of Insurance — ${insurer}`,
                  general_info: `Insurance Information — ${insurer}`,
                };
                const subject = (subjectPrefixes[input.purpose] || subjectPrefixes.general_info).trim();

                const peId = await ctx.runMutation(internal.email.createPendingEmail, {
                  userId: args.userId,
                  recipientEmail: input.recipientEmail,
                  recipientName: input.recipientName,
                  subject,
                  htmlBody: emailBody, // plaintext stored in htmlBody field
                  ccEmail: user.email,
                  purpose: input.purpose,
                });

                pendingEmailCreated = true;
                pendingEmailId = peId;

                if (user.autoSendEmails) {
                  await ctx.runMutation(internal.email.scheduleEmailSend, { pendingEmailId: peId });
                  return { success: true, autoSent: true, message: `Email scheduled to ${input.recipientEmail} (auto-send is on).` };
                }

                return {
                  success: true,
                  awaitingConfirmation: true,
                  emailNotSentYet: true,
                  recipientEmail: input.recipientEmail,
                  subject,
                  message: `EMAIL NOT SENT YET. Drafted to ${input.recipientEmail}. You MUST ask the user to reply "send" to confirm. Do NOT say the email was sent.`,
                };
              } catch (err: any) {
                console.error("send_email tool error:", err);
                return { success: false, message: `Failed to draft email: ${err.message || "unknown error"}` };
              }
            },
          }),

          generate_coi: tool({
            description: "Generate and send a Certificate of Insurance (ACORD-style PDF) via email. The PDF uses the correct Producer (broker) and Insurer (underwriter) from the policy.",
            inputSchema: z.object({
              recipientEmail: z.string().email(),
              recipientName: z.string(),
              purpose: z.string().describe("e.g. 'apartment lease', 'mortgage application'"),
              policyId: z.string().optional(),
            }),
            execute: async (input) => {
              try {
                if (!user?.email) {
                  return { success: false, reason: "no_email", message: "User doesn't have an email on file. Use request_email first." };
                }
                const targetPolicy = input.policyId
                  ? readyPolicies.find((p: any) => p._id === input.policyId)
                  : readyPolicies[0];
                if (!targetPolicy) return { success: false, reason: "no_policy", message: "No policy found" };

                const userName = user.name || targetPolicy.insuredName || "Policyholder";
                const raw = targetPolicy.rawExtracted || targetPolicy;
                const insurer = raw.security || raw.carrierLegalName || raw.carrier || "Insurer";

                // Generate ACORD-style COI PDF with correct Producer/Insurer
                const coiInput = buildCoiInput(targetPolicy, input.recipientName, input.purpose, userName);
                const pdfBytes = await generateCoiPdf(coiInput);
                const pdfBlob = new Blob([Buffer.from(pdfBytes)], { type: "application/pdf" });
                const coiPdfStorageId = await ctx.storage.store(pdfBlob);

                // Generate AI-written plaintext cover email for the COI
                const emailBody = await ctx.runAction(internal.emailActions.generateEmailBody, {
                  purpose: "coi",
                  recipientName: input.recipientName,
                  recipientEmail: input.recipientEmail,
                  userName,
                  userEmail: user.email,
                  policyData: raw,
                  customMessage: input.purpose,
                });

                const subject = `Certificate of Insurance — ${insurer} Policy ${raw.policyNumber || ""}`.trim();

                const peId = await ctx.runMutation(internal.email.createPendingEmail, {
                  userId: args.userId,
                  recipientEmail: input.recipientEmail,
                  recipientName: input.recipientName,
                  subject,
                  htmlBody: emailBody,
                  ccEmail: user.email,
                  purpose: "coi",
                  coiPdfStorageId,
                });

                pendingEmailCreated = true;
                pendingEmailId = peId;

                if (user.autoSendEmails) {
                  await ctx.runMutation(internal.email.scheduleEmailSend, { pendingEmailId: peId });
                  return { success: true, autoSent: true, message: `COI sent to ${input.recipientEmail}.` };
                }

                return {
                  success: true,
                  awaitingConfirmation: true,
                  emailNotSentYet: true,
                  recipientEmail: input.recipientEmail,
                  message: `EMAIL NOT SENT YET. COI drafted for ${input.recipientName} at ${input.recipientEmail}. You MUST ask the user to reply "send" to confirm. Do NOT say the email was sent.`,
                };
              } catch (err: any) {
                console.error("generate_coi tool error:", err);
                return { success: false, message: `Failed to generate COI: ${err.message || "unknown error"}` };
              }
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
            description: "Ask the user for their email address. Use this when the user wants to send an email but doesn't have one on file. The state will be set to awaiting_email after your response is sent.",
            inputSchema: z.object({
              reason: z.string().describe("Why the email is needed — shown to the user"),
            }),
            execute: async (_input) => {
              // Don't change state here — it will be set after generateText completes
              // This prevents state change from happening mid-tool-use before Claude's text response is sent
              emailRequested = true;
              return { success: true, message: "Ask the user for their email address now. The system will handle the state change." };
            },
          }),

          lookup_contact: tool({
            description: "Look up a saved contact by name. Use this when the user mentions a person by name (e.g. 'send it to John', 'email my landlord'). Returns matching contacts with their email addresses.",
            inputSchema: z.object({
              name: z.string().describe("The name or role to search for (e.g. 'John', 'landlord', 'property manager')"),
            }),
            execute: async (input) => {
              try {
                const matches = await ctx.runQuery(internal.contacts.searchByName, {
                  userId: args.userId,
                  name: input.name,
                });
                if (matches.length === 0) {
                  return { found: false, message: `No saved contact matching "${input.name}". Ask the user for the email address.` };
                }
                return {
                  found: true,
                  contacts: matches.map((c: any) => ({
                    name: c.name,
                    email: c.email,
                    label: c.label || null,
                  })),
                };
              } catch (err: any) {
                return { found: false, message: `Error looking up contact: ${err.message}` };
              }
            },
          }),

          send_upload_link: tool({
            description: "Send the user their upload link so they can add another policy. The link is sent as a separate message. On iMessage, users can also just send the PDF or photo directly in the conversation.",
            inputSchema: z.object({}),
            execute: async () => {
              try {
                const link = getUploadLink(args.uploadToken);
                const isIm = !!(args.linqChatId || args.imessageSender);
                if (isIm) {
                  await sendAndLog(ctx, args.userId, args.phone,
                    `Here's your upload link:\n${link}\n\nOr you can just send me the PDF or photo right here in the chat`,
                    args.linqChatId, args.imessageSender);
                } else {
                  await sendAndLog(ctx, args.userId, args.phone,
                    `Here's your upload link:\n${link}`,
                    args.linqChatId, args.imessageSender);
                }
                return { success: true, message: "Upload link sent to the user. Don't repeat the link in your response — just acknowledge it was sent." };
              } catch (err: any) {
                console.error("send_upload_link tool error:", err);
                return { success: false, message: `Failed to send upload link: ${err.message || "unknown error"}` };
              }
            },
          }),

          send_application: tool({
            description: "Email a filled insurance application to someone. Use when the user asks to send/email their completed application. Only works if there's a completed application (status: ready).",
            inputSchema: z.object({
              recipientEmail: z.string().email().describe("Recipient's email address"),
              recipientName: z.string().optional().describe("Recipient's name"),
              customMessage: z.string().optional().describe("Optional message to include"),
            }),
            execute: async (input) => {
              try {
                if (!user?.email) {
                  return { success: false, reason: "no_email", message: "User doesn't have an email on file. Use request_email to ask for it first." };
                }

                // Find the most recent ready application
                const apps = await ctx.runQuery(internal.applications.getByUser, {
                  userId: args.userId,
                });
                const readyApp = apps.find((a: any) => a.status === "ready" && a.filledPdfStorageId);
                if (!readyApp) {
                  return { success: false, message: "No completed application found. The user needs to fill one out first." };
                }

                // Generate email body
                const emailBody = await ctx.runAction(internal.emailActions.generateEmailBody, {
                  purpose: "general_info",
                  recipientName: input.recipientName || "Recipient",
                  recipientEmail: input.recipientEmail,
                  userName: user.name || "Policyholder",
                  userEmail: user.email,
                  policyData: { applicationTitle: readyApp.title, carrier: readyApp.carrier },
                  customMessage: input.customMessage || `Please find the completed ${readyApp.title || "insurance application"} attached.`,
                });

                const subject = `${readyApp.title || "Insurance Application"} — ${readyApp.carrier || "Completed"}`.trim();

                const peId = await ctx.runMutation(internal.email.createPendingEmail, {
                  userId: args.userId,
                  recipientEmail: input.recipientEmail,
                  recipientName: input.recipientName,
                  subject,
                  htmlBody: emailBody,
                  ccEmail: user.email,
                  purpose: "general_info",
                  coiPdfStorageId: readyApp.filledPdfStorageId,
                });

                pendingEmailCreated = true;
                pendingEmailId = peId;

                if (user.autoSendEmails) {
                  await ctx.runMutation(internal.email.scheduleEmailSend, { pendingEmailId: peId });
                  return { success: true, autoSent: true, message: `Application emailed to ${input.recipientEmail}.` };
                }

                return {
                  success: true,
                  awaitingConfirmation: true,
                  emailNotSentYet: true,
                  recipientEmail: input.recipientEmail,
                  message: `EMAIL NOT SENT YET. Application email drafted to ${input.recipientEmail}. Ask the user to confirm.`,
                };
              } catch (err: any) {
                console.error("send_application tool error:", err);
                return { success: false, message: `Failed: ${err.message || "unknown error"}` };
              }
            },
          }),

          reextract_policy: tool({
            description: "Re-extract a policy from its original PDF using the latest extraction pipeline. Use when the user asks to re-extract, reprocess, re-read, or refresh their policy data.",
            inputSchema: z.object({
              policyId: z.string().optional().describe("Policy ID to re-extract. If omitted, re-extracts all policies."),
            }),
            execute: async (input) => {
              try {
                const toReextract = input.policyId
                  ? readyPolicies.filter((p: any) => p._id === input.policyId)
                  : readyPolicies;
                if (toReextract.length === 0) return { success: false, message: "No policies found to re-extract" };

                const withPdf = toReextract.filter((p: any) => p.pdfStorageId);
                if (withPdf.length === 0) return { success: false, message: "No stored PDFs found — the original documents may not have been saved" };

                for (const policy of withPdf) {
                  await ctx.runAction(internal.process.reextractPolicy, {
                    policyId: policy._id,
                    pdfStorageId: policy.pdfStorageId!,
                    userId: args.userId,
                    phone: args.phone,
                    linqChatId: args.linqChatId,
                    imessageSender: args.imessageSender,
                  });
                }

                return {
                  success: true,
                  message: `Re-extracting ${withPdf.length} ${withPdf.length === 1 ? "policy" : "policies"} with the latest pipeline. The user will get updated summaries shortly.`,
                };
              } catch (err: any) {
                console.error("reextract_policy tool error:", err);
                return { success: false, message: `Failed to re-extract: ${err.message || "unknown error"}` };
              }
            },
          }),

          save_memory: tool({
            description: "Save a fact, preference, or life event about the user that you learned during conversation. Use this when you learn something about the user that would be useful to remember for future interactions — like they're moving, have expensive jewelry, prefer short messages, etc.",
            inputSchema: z.object({
              type: z.enum(["fact", "preference", "event"]).describe("Type of memory: fact (personal detail), preference (how they like to interact), event (life event like moving, buying a car)"),
              content: z.string().describe("The memory to save — clear and concise"),
            }),
            execute: async (input) => {
              try {
                await ctx.runMutation(internal.memory.addMemory, {
                  userId: args.userId,
                  type: input.type,
                  content: input.content,
                  source: "conversation",
                });
                return { success: true, message: "Memory saved." };
              } catch (err: any) {
                return { success: false, message: `Failed to save: ${err.message}` };
              }
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

      // Set state based on what tools were called
      if (emailRequested) {
        // Claude asked for the user's email — set state so next message routes to handleEmailCollection
        await ctx.runMutation(internal.users.updateState, {
          userId: args.userId,
          state: "awaiting_email",
        });
      } else if (pendingEmailCreated && !user?.autoSendEmails) {
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

// ── Re-extraction ──

export const reextractPolicy = internalAction({
  args: {
    policyId: v.id("policies"),
    pdfStorageId: v.id("_storage"),
    userId: v.id("users"),
    phone: v.string(),
    linqChatId: v.optional(v.string()),
    imessageSender: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      // Progress: let the user know we're starting
      await sendAndLog(ctx, args.userId, args.phone, "Got it — pulling up your original document and re-reading it now", args.linqChatId, args.imessageSender);

      // Start typing for Linq users
      if (args.linqChatId) {
        try { await ctx.runAction(internal.sendLinq.startTyping, { chatId: args.linqChatId }); } catch (_) {}
      }

      // Set policy back to processing
      await ctx.runMutation(internal.policies.updateExtracted, {
        policyId: args.policyId,
        status: "processing",
      });

      // Get the stored PDF
      const blob = await ctx.storage.get(args.pdfStorageId);
      if (!blob) {
        await ctx.runMutation(internal.policies.updateExtracted, {
          policyId: args.policyId,
          status: "failed",
        });
        await sendAndLog(ctx, args.userId, args.phone, "Couldn't find the original PDF — try uploading it again", args.linqChatId, args.imessageSender);
        return;
      }

      const buffer = await blob.arrayBuffer();
      const pdfBase64 = Buffer.from(buffer).toString("base64");

      // Re-run extraction with latest SDK pipeline
      await sendAndLog(ctx, args.userId, args.phone, "Running it through the latest extraction — pulling out coverages and limits", args.linqChatId, args.imessageSender);

      const reResult = await getExtractor().extract(pdfBase64);
      const { document: reDoc, chunks: reChunks } = reResult;
      const applied = documentToUpdateFields(reDoc, reResult);

      // Stop typing before sending results
      if (args.linqChatId) {
        try { await ctx.runAction(internal.sendLinq.stopTyping, { chatId: args.linqChatId }); } catch (_) {}
      }

      await Promise.all([
        ctx.runMutation(internal.policies.updateExtracted, {
          policyId: args.policyId,
          ...applied,
          status: "ready",
        }),
        ctx.runMutation(internal.documentChunks.saveChunks, {
          policyId: args.policyId,
          userId: args.userId,
          chunks: sanitizeNulls(reChunks),
        }),
      ]);

      // Extract contacts from re-extracted document
      const contacts = extractContactsFromDocument(reDoc);
      for (const c of contacts) {
        await ctx.runMutation(internal.contacts.upsert, { userId: args.userId, ...c });
      }

      // Schedule async embedding of re-extracted chunks
      ctx.scheduler.runAfter(0, internal.process.embedChunksForPolicy, {
        policyId: args.policyId,
        userId: args.userId,
      });

      const summary = buildPolicySummary(reDoc);
      await sendBurst(ctx, args.userId, args.phone, [
        "All done — here's the updated breakdown",
        summary,
        "Ask me anything about the updated info",
      ], args.linqChatId, args.imessageSender);
    } catch (error: any) {
      console.error("Re-extraction failed:", error);
      if (args.linqChatId) {
        try { await ctx.runAction(internal.sendLinq.stopTyping, { chatId: args.linqChatId }); } catch (_) {}
      }
      await ctx.runMutation(internal.policies.updateExtracted, {
        policyId: args.policyId,
        status: "failed",
      });
      await sendAndLog(ctx, args.userId, args.phone, "Had trouble re-extracting that policy — try uploading it again?", args.linqChatId, args.imessageSender);
    }
  },
});
