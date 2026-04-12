"use node";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { sanitizeNulls } from "@claritylabs/cl-sdk";
import {
  getExtractor,
  documentToUpdateFields,
  extractContactsFromDocument,
  isPartialPolicy,
  buildPolicySummary,
} from "./sdkAdapter";

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

      // Ack + SDK extraction in parallel
      const [, { document: extractedDoc, chunks }] = await Promise.all([
        sendNotification(ctx, args.userId, args.phone, "Got your upload — reading through it now", linqChatId, imessageSender),
        getExtractor().extract(pdfBase64),
      ]);

      const document: any = extractedDoc;
      const applied = documentToUpdateFields(document);
      const detectedCategory = applied.category;
      const documentType = document.type;
      const isQuote = documentType === "quote";
      const partial = isPartialPolicy(document);

      // Create policy record
      const finalPolicyId = await ctx.runMutation(internal.policies.create, {
        userId: args.userId, category: "other", documentType, pdfStorageId: args.storageId,
      });

      // Check for an existing policy this could be merged into
      const existingMatch = !isQuote
        ? await ctx.runQuery(internal.policies.findMatchingPolicy, {
            userId: args.userId,
            carrier: applied.carrier || undefined,
            policyNumber: applied.policyNumber || undefined,
            category: detectedCategory,
          })
        : null;

      // If we found a match, offer to merge
      if (existingMatch && existingMatch._id !== finalPolicyId) {
        await Promise.all([
          ctx.runMutation(internal.policies.updateExtracted, {
            policyId: finalPolicyId,
            ...applied,
            status: "ready",
          }),
          ctx.runMutation(internal.documentChunks.saveChunks, {
            policyId: finalPolicyId, userId: args.userId, chunks: sanitizeNulls(chunks),
          }),
          ctx.runMutation(internal.users.setPendingMerge, {
            userId: args.userId,
            pendingMergePolicyId: existingMatch._id,
            pendingMergeStorageId: args.storageId,
          }),
          ctx.runMutation(internal.users.updateState, {
            userId: args.userId,
            state: "awaiting_merge_confirm",
          }),
        ]);

        // Extract contacts from document
        const contacts = extractContactsFromDocument(document);
        for (const c of contacts) {
          await ctx.runMutation(internal.contacts.upsert, { userId: args.userId, ...c });
        }

        // Schedule async embedding of chunks
        ctx.scheduler.runAfter(0, internal.process.embedChunksForPolicy, {
          policyId: finalPolicyId, userId: args.userId,
        });

        const summary = buildPolicySummary(document);
        const matchLabel = existingMatch.carrier
          ? `your ${existingMatch.carrier} policy`
          : `your existing ${detectedCategory} policy`;
        const msg = `Got your upload! Here's what I found:\n\n${summary}\n\nThis looks like it goes with ${matchLabel}. Want me to merge them together? (yes/no)`;
        await sendNotification(ctx, args.userId, args.phone, msg, linqChatId, imessageSender);
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
        ctx.runMutation(internal.documentChunks.saveChunks, {
          policyId: finalPolicyId, userId: args.userId, chunks: sanitizeNulls(chunks),
        }),
        ctx.runMutation(internal.users.updateState, {
          userId: args.userId,
          state: isSlipEligible ? "awaiting_insurance_slip" : "active",
        }),
      ]);

      // Extract contacts from document
      const contacts = extractContactsFromDocument(document);
      for (const c of contacts) {
        await ctx.runMutation(internal.contacts.upsert, { userId: args.userId, ...c });
      }

      // Schedule async embedding of chunks
      ctx.scheduler.runAfter(0, internal.process.embedChunksForPolicy, {
        policyId: finalPolicyId, userId: args.userId,
      });

      const summary = buildPolicySummary(document);
      const docLabel = isQuote ? "quote" : "policy";

      let closingMsg: string;
      if (partial) {
        closingMsg = "Looks like this might be just a declarations page or partial document. If you have the full policy, send it over and I'll combine them for a more complete picture.";
      } else if (isSlipEligible) {
        closingMsg = "Do you have an existing insurance slip for this? If so, send it over and I'll save it. Otherwise just say no and I can generate one for you anytime.";
      } else {
        closingMsg = "Ask me anything about your coverage.";
      }

      const msg = `Got your ${detectedCategory} ${docLabel}! Here's the breakdown:\n\n${summary}\n\n${closingMsg}`;
      await sendNotification(ctx, args.userId, args.phone, msg, linqChatId, imessageSender);
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
