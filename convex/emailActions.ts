"use node";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import {
  buildAgentSystemPrompt,
  buildDocumentContext,
} from "@claritylabs/cl-sdk";

function generateThreadId(): string {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  let id = "";
  for (let i = 0; i < 12; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// ── Send outbound email via Resend ──

export const sendEmailNow = internalAction({
  args: {
    pendingEmailId: v.id("pendingEmails"),
  },
  handler: async (ctx, args) => {
    const pending = await ctx.runQuery(internal.email.getPendingEmailById, {
      pendingEmailId: args.pendingEmailId,
    });

    if (!pending) {
      console.error(`Pending email ${args.pendingEmailId} not found`);
      return;
    }

    if (pending.status === "undone" || pending.status === "cancelled") {
      console.log(`Email ${args.pendingEmailId} was ${pending.status}, skipping send`);
      return;
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error("RESEND_API_KEY not set");
      await ctx.runMutation(internal.email.updatePendingEmailStatus, {
        pendingEmailId: args.pendingEmailId,
        status: "failed",
      });
      return;
    }

    // Generate a thread-specific from address so replies route back to this thread
    const threadId = generateThreadId();
    const emailDomain = process.env.RESEND_EMAIL_DOMAIN || "spot.claritylabs.inc";
    const fromAddress = `spot+${threadId}@${emailDomain}`;
    const fromDisplay = `Spot <${fromAddress}>`;

    try {
      // Build attachments array if COI PDF exists
      const attachments: Array<{ filename: string; content: string }> = [];
      if (pending.coiPdfStorageId) {
        const pdfBlob = await ctx.storage.get(pending.coiPdfStorageId);
        if (pdfBlob) {
          const pdfBuffer = await pdfBlob.arrayBuffer();
          const pdfBase64 = Buffer.from(pdfBuffer).toString("base64");
          attachments.push({
            filename: "Certificate_of_Insurance.pdf",
            content: pdfBase64,
          });
        }
      }

      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromDisplay,
          to: [pending.recipientEmail],
          cc: pending.ccEmail ? [pending.ccEmail] : undefined,
          subject: pending.subject,
          html: pending.htmlBody,
          reply_to: fromAddress, // replies come back to Spot, not the user
          ...(attachments.length > 0 ? { attachments } : {}),
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Resend API error ${response.status}: ${errorBody}`);
      }

      const result = await response.json();
      const resendMessageId = result.id || "";

      // Update pending email status
      await ctx.runMutation(internal.email.updatePendingEmailStatus, {
        pendingEmailId: args.pendingEmailId,
        status: "sent",
      });

      // Create email thread for tracking replies
      await ctx.runMutation(internal.email.createEmailThread, {
        userId: pending.userId,
        pendingEmailId: args.pendingEmailId,
        outboundMessageId: resendMessageId,
        recipientEmail: pending.recipientEmail,
        recipientName: pending.recipientName,
        subject: pending.subject,
        fromAddress,
      });

      // Log the email send
      await ctx.runMutation(internal.messages.log, {
        userId: pending.userId,
        direction: "outbound",
        body: `[Email sent] To: ${pending.recipientEmail} — Subject: ${pending.subject}`,
        hasAttachment: false,
        channel: "email",
      });

      console.log(`Email sent to ${pending.recipientEmail} from ${fromAddress}: ${pending.subject}`);
    } catch (error: any) {
      console.error(`Failed to send email ${args.pendingEmailId}:`, error.message);
      await ctx.runMutation(internal.email.updatePendingEmailStatus, {
        pendingEmailId: args.pendingEmailId,
        status: "failed",
      });
    }
  },
});

// ── Handle inbound email reply ──

export const handleInboundEmail = internalAction({
  args: {
    resendEmailId: v.string(), // The received email's ID from Resend webhook
    from: v.string(), // Sender (the recipient who replied)
    to: v.array(v.string()), // Recipient addresses (our spot+xxx address)
    subject: v.string(),
  },
  handler: async (ctx, args) => {
    // Step 1: Find the thread by matching the to address
    const toAddress = args.to.find((addr) => addr.includes("spot+")) || args.to[0] || "";
    // Extract just the email part (strip display name if present)
    const emailMatch = toAddress.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+/);
    const cleanTo = emailMatch ? emailMatch[0].toLowerCase() : toAddress.toLowerCase();

    const thread = await ctx.runQuery(internal.email.getThreadByFromAddress, {
      fromAddress: cleanTo,
    });

    if (!thread) {
      console.log(`No thread found for inbound email to ${cleanTo}, ignoring`);
      return;
    }

    // Step 2: Fetch full email content from Resend API
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error("RESEND_API_KEY not set, can't fetch inbound email");
      return;
    }

    const emailResponse = await fetch(
      `https://api.resend.com/emails/receiving/${args.resendEmailId}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      }
    );

    if (!emailResponse.ok) {
      console.error(`Failed to fetch inbound email: ${emailResponse.status}`);
      return;
    }

    const emailData = await emailResponse.json();
    const replyText = emailData.text || "";
    const replyHtml = emailData.html || "";
    const inboundMessageId = emailData.message_id || "";
    const senderName = args.from.replace(/<.*>/, "").trim() || thread.recipientEmail;

    // Step 3: Load user + policies
    const user = await ctx.runQuery(internal.users.get, { userId: thread.userId });
    if (!user) {
      console.error(`User ${thread.userId} not found for email thread`);
      return;
    }

    const policies = await ctx.runQuery(internal.policies.getByUser, {
      userId: thread.userId,
    });
    const readyPolicies = policies.filter((p: any) => p.status === "ready");

    // Log the inbound email as a message
    await ctx.runMutation(internal.messages.log, {
      userId: thread.userId,
      direction: "inbound",
      body: `[Email from ${senderName}] ${replyText.slice(0, 500)}`,
      hasAttachment: false,
      channel: "email",
    });

    // Update thread activity
    await ctx.runMutation(internal.email.updateThreadActivity, {
      threadId: thread._id,
    });

    // Step 4: Use Claude to decide if Spot can answer or should ask the user
    const sdkPrompt = buildAgentSystemPrompt({
      platform: "email",
      intent: "direct",
      companyName: "Spot",
      agentName: "Spot",
      siteUrl: "https://secure.claritylabs.inc",
      coiHandling: "ignore",
    });

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

    const { context: documentContext } = buildDocumentContext(policyDocs, quoteDocs, replyText);

    const systemPrompt = `You are Spot, an insurance assistant replying to an email thread on behalf of a policyholder.

Context:
- You originally sent an email about the policyholder's insurance (subject: "${thread.subject}") to ${senderName} (${thread.recipientEmail}).
- ${senderName} has now replied to that email.
- The policyholder's name is ${user.name || "the insured"}.

${sdkPrompt}

Here are the policyholder's insurance documents:
${documentContext}

Your job:
1. If the reply asks a question about coverage, limits, dates, or anything in the policy data — answer it directly and professionally. Keep it concise and email-appropriate (not texting tone).
2. If you CAN answer confidently, respond with: {"action":"reply","message":"your reply text","summary":"one-line summary for the policyholder"}
3. If you CANNOT answer (the question is outside the policy data, requires the policyholder's input, or is about something you don't have info on), respond with: {"action":"escalate","summary":"what they're asking about"}

Respond with ONLY the JSON object, no other text.`;

    const anthropic = createAnthropic();
    const { text: aiResponse } = await generateText({
      model: anthropic("claude-sonnet-4-6"),
      system: systemPrompt,
      prompt: `Email from ${senderName}:\n\n${replyText}`,
      maxOutputTokens: 600,
    });

    // Parse Claude's decision
    let decision: { action: string; message?: string; summary: string };
    try {
      decision = JSON.parse(aiResponse.trim());
    } catch {
      // If parsing fails, escalate to user
      decision = { action: "escalate", summary: `${senderName} replied to the insurance email but I couldn't process their message` };
    }

    // Step 5: Act on the decision

    // Helper to send text to user via their channel
    const sendTextToUser = async (body: string) => {
      if (user.linqChatId) {
        try {
          await ctx.runAction(internal.sendLinq.sendLinqMessage, {
            chatId: user.linqChatId,
            body,
          });
          await ctx.runMutation(internal.messages.log, {
            userId: thread.userId, direction: "outbound", body, hasAttachment: false, channel: "linq",
          });
          return;
        } catch (_) {}
      }
      if (user.imessageSender) {
        try {
          await ctx.runAction(internal.sendBridge.sendBridgeMessage, {
            to: user.imessageSender,
            body,
          });
          await ctx.runMutation(internal.messages.log, {
            userId: thread.userId, direction: "outbound", body, hasAttachment: false, channel: "imessage_bridge",
          });
          return;
        } catch (_) {}
      }
      await ctx.runAction(internal.send.sendSms, { to: user.phone, body });
      await ctx.runMutation(internal.messages.log, {
        userId: thread.userId, direction: "outbound", body, hasAttachment: false, channel: "openphone",
      });
    };

    if (decision.action === "reply" && decision.message) {
      // Spot can answer — reply to the email thread and notify the user
      const emailDomain = process.env.RESEND_EMAIL_DOMAIN || "spot.claritylabs.inc";

      const replyResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `Spot <${thread.fromAddress}>`,
          to: [thread.recipientEmail],
          cc: user.email ? [user.email] : undefined,
          subject: thread.subject.startsWith("Re:") ? thread.subject : `Re: ${thread.subject}`,
          html: `<div style="font-family:system-ui,-apple-system,sans-serif;color:#111827;line-height:1.6;">${decision.message.replace(/\n/g, "<br>")}</div><p style="font-size:12px;color:#8a8578;margin-top:24px;border-top:1px solid #e5e2dc;padding-top:12px;">Sent by Spot, powered by <a href="https://claritylabs.inc" style="color:#8a8578;">Clarity Labs</a></p>`,
          headers: {
            "In-Reply-To": inboundMessageId,
            "References": `${thread.outboundMessageId} ${inboundMessageId}`,
          },
        }),
      });

      if (!replyResponse.ok) {
        console.error(`Failed to send reply: ${await replyResponse.text()}`);
      }

      // Log the outbound reply
      await ctx.runMutation(internal.messages.log, {
        userId: thread.userId,
        direction: "outbound",
        body: `[Email reply to ${senderName}] ${decision.message.slice(0, 300)}`,
        hasAttachment: false,
        channel: "email",
      });

      // Text the user a summary
      await sendTextToUser(
        `Heads up — ${senderName} replied to the insurance email and asked about ${decision.summary}. I replied with the info from your policy.`
      );
    } else {
      // Can't answer — escalate to user via text
      await sendTextToUser(
        `${senderName} replied to the insurance email I sent them. They're asking: ${decision.summary}\n\nWant me to respond, or would you rather handle it?`
      );
    }
  },
});
