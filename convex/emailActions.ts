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

    // Generate a thread-specific from address so replies route back
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

      // Send as plaintext email (htmlBody field contains plaintext content)
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
          text: pending.htmlBody, // plaintext content
          reply_to: fromAddress,
          ...(attachments.length > 0 ? { attachments } : {}),
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Resend API error ${response.status}: ${errorBody}`);
      }

      const result = await response.json();
      const resendMessageId = result.id || "";

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

      // Auto-save recipient as a contact
      await ctx.runMutation(internal.contacts.upsert, {
        userId: pending.userId,
        name: pending.recipientName || pending.recipientEmail,
        email: pending.recipientEmail,
      });

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

// ── Generate AI-written email body ──

export const generateEmailBody = internalAction({
  args: {
    purpose: v.string(), // "proof_of_insurance" | "coverage_details" | "coi" | "general_info"
    recipientName: v.string(),
    recipientEmail: v.string(),
    userName: v.string(),
    userEmail: v.optional(v.string()),
    policyData: v.any(), // rawExtracted policy data
    customMessage: v.optional(v.string()),
    coverageNames: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const anthropic = createAnthropic();
    const raw = args.policyData;

    // Build a rich context from rawExtracted data
    const policyContext = [
      `Policy Number: ${raw.policyNumber || "N/A"}`,
      `Insurer/Underwriter: ${raw.security || raw.carrierLegalName || raw.carrier || "N/A"}`,
      `Broker/Producer: ${raw.broker || raw.brokerAgency || raw.mga || "N/A"}`,
      `Named Insured: ${raw.insuredName || args.userName}`,
      raw.insuredAddress ? `Insured Address: ${raw.insuredAddress.street1 || ""}, ${raw.insuredAddress.city || ""}, ${raw.insuredAddress.state || ""} ${raw.insuredAddress.zip || ""}` : "",
      `Effective Date: ${raw.effectiveDate || "N/A"}`,
      `Expiration Date: ${raw.expirationDate || "N/A"}`,
      `Premium: ${raw.premium || "N/A"}`,
      `Policy Type: ${raw.policyTypes?.[0] || raw.declarations?.formType || "N/A"}`,
      raw.summary ? `Summary: ${raw.summary}` : "",
    ].filter(Boolean).join("\n");

    const coverageLines = (raw.coverages || []).map((c: any) =>
      `- ${c.name}: Limit ${c.limit || "N/A"}, Deductible ${c.deductible || "N/A"}`
    ).join("\n");

    const purposeDescriptions: Record<string, string> = {
      proof_of_insurance: `Write a brief, professional plaintext email providing proof of insurance. Include the key policy details: carrier/insurer, policy number, named insured, coverage period, and main coverages with limits. Keep it natural — like a real person wrote it, not a template.`,
      coverage_details: `Write a brief, professional plaintext email detailing the requested coverages${args.coverageNames?.length ? ` (specifically: ${args.coverageNames.join(", ")})` : ""}. Include limits, deductibles, and what's covered. Keep it natural.`,
      coi: `Write a brief, professional plaintext email accompanying a Certificate of Insurance (attached as PDF). Mention the key details: insurer, policy number, insured name, coverage period. The COI PDF has the full details — the email should be a concise cover note.`,
      general_info: `Write a brief, professional plaintext email with the requested insurance information. Keep it natural and helpful.`,
    };

    const prompt = `${purposeDescriptions[args.purpose] || purposeDescriptions.general_info}

${args.customMessage ? `The user wants to convey: ${args.customMessage}` : ""}

Policy details:
${policyContext}

Coverages:
${coverageLines || "No coverages on file"}

Write the email addressed to ${args.recipientName}. Sign it with:

—
Spot, on behalf of ${args.userName}
Powered by Clarity Labs

Rules:
- Plaintext only. No HTML, no markdown formatting, no bullet symbols.
- Use line breaks for readability.
- Be concise and professional but warm — not corporate template-speak.
- Include only relevant policy details for the purpose.
- Do NOT include the subject line in the body.`;

    const { text } = await generateText({
      model: anthropic("claude-sonnet-4-6"),
      prompt,
      maxOutputTokens: 500,
    });

    return text;
  },
});

// ── Handle inbound email reply ──

export const handleInboundEmail = internalAction({
  args: {
    resendEmailId: v.string(),
    from: v.string(),
    to: v.array(v.string()),
    subject: v.string(),
  },
  handler: async (ctx, args) => {
    const toAddress = args.to.find((addr) => addr.includes("spot+")) || args.to[0] || "";
    const emailMatch = toAddress.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+/);
    const cleanTo = emailMatch ? emailMatch[0].toLowerCase() : toAddress.toLowerCase();

    const thread = await ctx.runQuery(internal.email.getThreadByFromAddress, {
      fromAddress: cleanTo,
    });

    if (!thread) {
      console.log(`No thread found for inbound email to ${cleanTo}, ignoring`);
      return;
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error("RESEND_API_KEY not set");
      return;
    }

    const emailResponse = await fetch(
      `https://api.resend.com/emails/receiving/${args.resendEmailId}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );

    if (!emailResponse.ok) {
      console.error(`Failed to fetch inbound email: ${emailResponse.status}`);
      return;
    }

    const emailData = await emailResponse.json();
    const replyText = emailData.text || "";
    const inboundMessageId = emailData.message_id || "";
    const senderName = args.from.replace(/<.*>/, "").trim() || thread.recipientEmail;

    const user = await ctx.runQuery(internal.users.get, { userId: thread.userId });
    if (!user) return;

    const policies = await ctx.runQuery(internal.policies.getByUser, { userId: thread.userId });
    const readyPolicies = policies.filter((p: any) => p.status === "ready");

    await ctx.runMutation(internal.messages.log, {
      userId: thread.userId,
      direction: "inbound",
      body: `[Email from ${senderName}] ${replyText.slice(0, 500)}`,
      hasAttachment: false,
      channel: "email",
    });

    await ctx.runMutation(internal.email.updateThreadActivity, { threadId: thread._id });

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
        quoteDocs.push({ ...base, type: "quote" as const, quoteNumber: raw.quoteNumber || p.policyNumber || "", proposedEffectiveDate: raw.proposedEffectiveDate || p.effectiveDate, proposedExpirationDate: raw.proposedExpirationDate || p.expirationDate });
      } else {
        policyDocs.push({ ...base, type: "policy" as const, policyNumber: raw.policyNumber || p.policyNumber || "", effectiveDate: raw.effectiveDate || p.effectiveDate || "", expirationDate: raw.expirationDate || p.expirationDate || "" });
      }
    }

    const { context: documentContext } = buildDocumentContext(policyDocs, quoteDocs, replyText);

    const systemPrompt = `You are Spot, an insurance assistant replying to an email thread on behalf of a policyholder.

Context:
- You originally sent an email (subject: "${thread.subject}") to ${senderName} (${thread.recipientEmail}).
- ${senderName} has replied.
- The policyholder is ${user.name || "the insured"}.

${documentContext}

Your job:
1. If you can answer from the policy data, reply directly. Keep it professional but natural — plaintext, like a real person.
2. If you CAN answer, respond with: {"action":"reply","message":"your reply text","summary":"one-line summary"}
3. If you CANNOT answer, respond with: {"action":"escalate","summary":"what they're asking about"}

Sign replies with:
—
Spot, on behalf of ${user.name || "the policyholder"}
Powered by Clarity Labs

Respond with ONLY the JSON object.`;

    const anthropic = createAnthropic();
    const { text: aiResponse } = await generateText({
      model: anthropic("claude-sonnet-4-6"),
      system: systemPrompt,
      prompt: `Email from ${senderName}:\n\n${replyText}`,
      maxOutputTokens: 600,
    });

    let decision: { action: string; message?: string; summary: string };
    try {
      decision = JSON.parse(aiResponse.trim());
    } catch {
      decision = { action: "escalate", summary: `${senderName} replied but I couldn't process their message` };
    }

    const sendTextToUser = async (body: string) => {
      if (user.linqChatId) {
        try {
          await ctx.runAction(internal.sendLinq.sendLinqMessage, { chatId: user.linqChatId, body });
          await ctx.runMutation(internal.messages.log, { userId: thread.userId, direction: "outbound", body, hasAttachment: false, channel: "linq" });
          return;
        } catch (_) {}
      }
      if (user.imessageSender) {
        try {
          await ctx.runAction(internal.sendBridge.sendBridgeMessage, { to: user.imessageSender, body });
          await ctx.runMutation(internal.messages.log, { userId: thread.userId, direction: "outbound", body, hasAttachment: false, channel: "imessage_bridge" });
          return;
        } catch (_) {}
      }
      await ctx.runAction(internal.send.sendSms, { to: user.phone, body });
      await ctx.runMutation(internal.messages.log, { userId: thread.userId, direction: "outbound", body, hasAttachment: false, channel: "openphone" });
    };

    if (decision.action === "reply" && decision.message) {
      const replyResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: `Spot <${thread.fromAddress}>`,
          to: [thread.recipientEmail],
          cc: user.email ? [user.email] : undefined,
          subject: thread.subject.startsWith("Re:") ? thread.subject : `Re: ${thread.subject}`,
          text: decision.message, // plaintext
          headers: { "In-Reply-To": inboundMessageId, "References": `${thread.outboundMessageId} ${inboundMessageId}` },
        }),
      });

      if (!replyResponse.ok) {
        console.error(`Failed to send reply: ${await replyResponse.text()}`);
      }

      await ctx.runMutation(internal.messages.log, {
        userId: thread.userId, direction: "outbound",
        body: `[Email reply to ${senderName}] ${decision.message.slice(0, 300)}`,
        hasAttachment: false, channel: "email",
      });

      await sendTextToUser(`Heads up — ${senderName} replied to the insurance email and asked about ${decision.summary}. I replied with the info from your policy.`);
    } else {
      await sendTextToUser(`${senderName} replied to the insurance email I sent them. They're asking: ${decision.summary}\n\nWant me to respond, or would you rather handle it?`);
    }
  },
});
