"use node";

import { createHash } from "node:crypto";
import { stepCountIs, tool, type ModelMessage } from "ai";
import { z } from "zod";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  generateAgentTextForPublicTask,
  generatedTextFromResult,
  type ModelTask,
} from "../lib/models";
import { markdownToHtml, stripMarkdown } from "../lib/aiUtils";
import {
  buildAgentEmailHtmlBody,
  buildEmailSignature,
} from "../lib/emailSubagent";
import {
  buildPublicDemoBookingUrl,
  buildPublicDemoSystemPrompt,
  looksLikeBookingIntent,
  publicDemoNeedsTextEmail,
  PUBLIC_DEMO_BOOKING_URL,
  PUBLIC_DEMO_EXAMPLE_DATA,
  PUBLIC_DEMO_SIGNUP_URL,
  type PublicDemoChannel,
  type PublicDemoCtaStatus,
  type PublicDemoLeadContext,
  type PublicDemoLeadStage,
} from "../lib/publicDemoAgent";
import { collectToolAudit } from "../lib/agentToolAudit";
import { getAgentDomain } from "../lib/resend";

type PublicDemoConversation = Doc<"publicDemoConversations">;
type PublicDemoLog = Doc<"publicDemoChatLogs">;

type PublicDemoAgentResponse = {
  conversationId: Id<"publicDemoConversations">;
  outboundLogId: Id<"publicDemoChatLogs">;
  text: string;
  html: string;
  ctaUrl?: string;
  route?: { provider: string; model: string };
  routeSource?: string;
};

function senderHash(channel: PublicDemoChannel, senderContact: string) {
  return createHash("sha256")
    .update(`${channel}:${senderContact.trim().toLowerCase()}`)
    .digest("hex");
}

function compact(value: string | undefined) {
  const cleaned = value?.trim().replace(/\s+/g, " ");
  return cleaned || undefined;
}

function mergeLead(
  conversation: PublicDemoConversation,
  patch: PublicDemoLeadContext,
): PublicDemoLeadContext {
  return {
    name: compact(patch.name) ?? conversation.leadName,
    company: compact(patch.company) ?? conversation.leadCompany,
    email: compact(patch.email) ?? conversation.leadEmail,
    useCase: compact(patch.useCase) ?? conversation.leadUseCase,
  };
}

function logsToMessages(logs: PublicDemoLog[]): ModelMessage[] {
  return logs
    .filter((log) => log.direction !== "system")
    .slice(-10)
    .map((log) => ({
      role: log.direction === "inbound" ? "user" : "assistant",
      content:
        log.direction === "inbound" && log.subject
          ? `Subject: ${log.subject}\n\n${log.content}`
          : log.content,
    }));
}

function inferStage(args: {
  current: PublicDemoLeadStage;
  message: string;
  ctaStatus: PublicDemoCtaStatus;
  lead: PublicDemoLeadContext;
}): PublicDemoLeadStage {
  if (args.ctaStatus === "cal_link_sent") return "cta_sent";
  if (args.ctaStatus === "signup_link_sent") return "signup_intent";
  if (looksLikeBookingIntent(args.message)) return "booking_intent";
  if (args.lead.name && args.lead.company) return "qualified";
  if (args.current === "new") return "engaged";
  return args.current;
}

function extractObjections(logs: PublicDemoLog[]) {
  const text = logs.map((log) => log.content).join("\n").toLowerCase();
  return [
    /\b(price|pricing|cost|expensive)\b/.test(text) ? "Pricing" : undefined,
    /\b(security|privacy|data|soc|compliance)\b/.test(text)
      ? "Security or data handling"
      : undefined,
    /\b(real|binding|valid|certificate|coi)\b/.test(text)
      ? "Certificate validity"
      : undefined,
    /\b(integration|api|mailbox|email|imap)\b/.test(text)
      ? "Integration workflow"
      : undefined,
  ].filter((item): item is string => Boolean(item));
}

function transcriptSummary(args: {
  lead: PublicDemoLeadContext;
  stage: PublicDemoLeadStage;
  ctaStatus: PublicDemoCtaStatus;
  latestMessage: string;
}) {
  const who = [
    args.lead.name ?? "Unknown prospect",
    args.lead.company ? `from ${args.lead.company}` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  const useCase = args.lead.useCase
    ? ` They are exploring ${args.lead.useCase}.`
    : "";
  return `${who} contacted the public Spot demo agent. Stage: ${args.stage}. CTA: ${args.ctaStatus}.${useCase} Latest user message: ${args.latestMessage.slice(0, 240)}`;
}

function nextStep(stage: PublicDemoLeadStage, ctaStatus: PublicDemoCtaStatus) {
  if (ctaStatus === "cal_link_sent") return "Watch for Cal.com booking completion or follow up from the transcript.";
  if (ctaStatus === "asked_for_email") return "Ask for the prospect's email so the Cal.com link can be prefilled.";
  if (stage === "booking_intent") return "Send the Cal.com product demo link once email is available if needed.";
  if (stage === "qualified") return "Continue demo and steer toward booking a product demo.";
  return "Continue demo, capture name/company, and qualify use case.";
}

function addSimulationNotice(args: {
  text: string;
  channel: PublicDemoChannel;
  alreadyWarned: boolean;
}) {
  const text = args.text.trim();
  if (args.alreadyWarned) return text;
  const notice =
    args.channel === "imessage"
      ? "Demo data only, not real advice."
      : "Demo only: no certificate was issued, nothing here is binding, and this is not insurance advice.";
  const separator = args.channel === "imessage" ? " " : "\n\n";
  return `${text}${separator}${notice}`;
}

const PUBLIC_DEMO_TRANSPORT_CAPS: Record<PublicDemoChannel, number> = {
  email: 8_000,
  imessage: 520,
};

function validatedPublicDemoResponse(args: {
  text: string;
  channel: PublicDemoChannel;
  alreadyWarned: boolean;
}): string | undefined {
  if (!args.text.trim()) return undefined;
  const text = addSimulationNotice(args);
  return Array.from(text).length <= PUBLIC_DEMO_TRANSPORT_CAPS[args.channel]
    ? text
    : undefined;
}

const NEUTRAL_PUBLIC_DEMO_FAILURE =
  "I couldn't safely format that demo response. Please try a shorter request.";

function formatPublicDemoEmail(args: {
  body: string;
  agentAddress?: string;
}): { text: string; html: string } {
  const signature = buildEmailSignature(
    args.agentAddress ?? `agent@${getAgentDomain()}`,
  );
  const text = stripMarkdown(args.body) + signature.text;
  const html = buildAgentEmailHtmlBody(args.body, signature);
  return { text, html };
}

export const respond = internalAction({
  args: {
    channel: v.union(v.literal("email"), v.literal("imessage")),
    senderContact: v.string(),
    messageText: v.string(),
    subject: v.optional(v.string()),
    fromName: v.optional(v.string()),
    fromEmail: v.optional(v.string()),
    agentAddress: v.optional(v.string()),
    sourceMessageId: v.optional(v.string()),
    resendEmailId: v.optional(v.string()),
    chatGuid: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<PublicDemoAgentResponse> => {
    const channel = args.channel;
    const normalizedSender = args.senderContact.trim().toLowerCase();
    const rateKey = senderHash(channel, normalizedSender);
    const rate = await ctx.runMutation(internal.publicDemo.checkRateLimit, {
      rateKey,
    });

    const conversation = await ctx.runMutation(
      internal.publicDemo.findOrCreateConversation,
      {
        channel,
        senderHash: rateKey,
        senderContact: args.senderContact,
        agentAddress: args.agentAddress,
        leadEmail: channel === "email" ? args.fromEmail : undefined,
      },
    );

    await ctx.runMutation(internal.publicDemo.appendChatLog, {
      conversationId: conversation._id,
      channel,
      direction: "inbound",
      subject: args.subject,
      content: args.messageText,
      deliveryStatus: "received",
      metadata: {
        fromName: args.fromName,
        fromEmail: args.fromEmail,
        sourceMessageId: args.sourceMessageId,
        resendEmailId: args.resendEmailId,
        chatGuid: args.chatGuid,
      },
    });

    if (!rate.allowed) {
      const text =
        channel === "imessage"
          ? `I am getting a lot of demo messages from this contact. Please try again in a few minutes, or book here: ${PUBLIC_DEMO_BOOKING_URL}`
          : `I am getting a lot of demo messages from this contact. Please try again in a few minutes, or book a product demo at ${PUBLIC_DEMO_BOOKING_URL}.`;
      const formatted =
        channel === "email"
          ? formatPublicDemoEmail({ body: text, agentAddress: args.agentAddress })
          : { text, html: markdownToHtml(text) };
      await ctx.runMutation(internal.publicDemo.updateConversationLead, {
        conversationId: conversation._id,
        stage: "rate_limited",
      });
      const outboundLogId = await ctx.runMutation(
        internal.publicDemo.appendChatLog,
        {
          conversationId: conversation._id,
          channel,
          direction: "outbound",
          subject: args.subject,
          content: text,
          contentHtml: formatted.html,
          deliveryStatus: "generated",
        },
      );
      return {
        conversationId: conversation._id,
        outboundLogId,
        text: formatted.text,
        html: formatted.html,
      };
    }

    const logs = await ctx.runQuery(
      internal.publicDemo.listConversationLogsInternal,
      {
        conversationId: conversation._id,
        limit: 16,
      },
    );
    const alreadyWarned = conversation.safetyNoticeSent === true;
    const leadPatch: PublicDemoLeadContext = {};
    let ctaStatus: PublicDemoCtaStatus = conversation.ctaStatus;
    let ctaUrl: string | undefined;
    const initialLead = mergeLead(conversation, {
      email: channel === "email" ? args.fromEmail : undefined,
    });
    const task: ModelTask = channel === "email" ? "email_reply" : "chat";

    const tools = {
      record_lead_context: tool({
        description:
          "Record prospect name, company, email, or use case when the prospect provides it. Use this before tailoring examples.",
        inputSchema: z.object({
          name: z.string().optional(),
          company: z.string().optional(),
          email: z.string().email().optional(),
          useCase: z.string().optional(),
        }),
        execute: async (input) => {
          if (input.name) leadPatch.name = input.name;
          if (input.company) leadPatch.company = input.company;
          if (input.email) leadPatch.email = input.email;
          if (input.useCase) leadPatch.useCase = input.useCase;
          return { recorded: true };
        },
      }),
      answer_example_policy_question: tool({
        description:
          "Answer a policy question using the simulated Clarity Labs policy data. This is not real insurance advice.",
        inputSchema: z.object({
          question: z.string(),
        }),
        execute: async () =>
          channel === "imessage"
            ? {
                summary:
                  "Spot would pull the policy details and answer from the evidence.",
                example:
                  "Clarity Labs has example GL and Cyber policies in the demo data.",
                note: "Demo data only.",
              }
            : {
                company: PUBLIC_DEMO_EXAMPLE_DATA.company,
                address: PUBLIC_DEMO_EXAMPLE_DATA.address,
                policies: PUBLIC_DEMO_EXAMPLE_DATA.policies,
                note: "Simulated demo data only. Not a real policy answer or insurance advice.",
              },
      }),
      check_example_vendor_compliance: tool({
        description:
          "Run a simulated vendor compliance check with example requirements and policy evidence.",
        inputSchema: z.object({
          vendorName: z.string().optional(),
        }),
        execute: async () =>
          channel === "imessage"
            ? {
                summary:
                  "Spot would check the vendor evidence and flag missing cyber plus AI wording.",
                note: "Demo data only.",
              }
            : {
                vendor: PUBLIC_DEMO_EXAMPLE_DATA.vendor.name,
                status: PUBLIC_DEMO_EXAMPLE_DATA.vendor.status,
                gaps: PUBLIC_DEMO_EXAMPLE_DATA.vendor.gaps,
                note: "Simulated demo result only. Spot would use connected vendor policies and saved requirements for a real customer.",
              },
      }),
      draft_example_certificate_email: tool({
        description:
          "Draft a simulated certificate or COI delivery email. Do not claim the certificate is real, binding, or issued.",
        inputSchema: z.object({
          recipient: z.string().optional(),
          request: z.string().optional(),
        }),
        execute: async (input) =>
          channel === "imessage"
            ? {
                summary:
                  "Spot can draft the COI request and broker follow-up.",
                note: "Demo data only. No COI is issued.",
              }
            : {
                subject: "Example certificate follow-up",
                body: [
                  `Hi ${input.recipient ?? "there"},`,
                  "",
                  "This is a simulated Spot demo email. In a real workspace, Spot would prepare the certificate request from policy evidence, flag endorsements that need review, and route the draft for send confirmation.",
                  "",
                  "Demo note: no certificate was issued or attached.",
                ].join("\n"),
              },
      }),
      explain_mailbox_agent: tool({
        description:
          "Explain how the Spot mailbox agent can search insurance emails and coordinate follow-up.",
        inputSchema: z.object({
          task: z.string().optional(),
        }),
        execute: async () =>
          channel === "imessage"
            ? {
                summary:
                  "Spot can find policy emails, pull key details, and draft the follow-up.",
              }
            : {
                workflow: [
                  "Search connected insurance mailboxes for policies, renewals, endorsements, and requirement packets.",
                  "Read bounded message and attachment content.",
                  "Import selected documents into first-class policy or compliance workflows after user confirmation.",
                  "Draft follow-up with evidence and send confirmation visible in Spot.",
                ],
              },
      }),
      build_demo_booking_link: tool({
        description:
          "Build the Cal.com product-demo link once the prospect is ready to book. For text/iMessage, ask for email first if missing.",
        inputSchema: z.object({
          notes: z.string().optional(),
        }),
        execute: async (input) => {
          const lead = mergeLead(conversation, leadPatch);
          if (channel === "imessage" && !lead.email) {
            ctaStatus = "asked_for_email";
            return {
              needsEmail: true,
              message: "Ask for the best email before sending the prefilled Cal.com link.",
            };
          }
          ctaStatus = "cal_link_sent";
          ctaUrl = buildPublicDemoBookingUrl({
            channel,
            lead,
            notes: input.notes,
          });
          return {
            bookingUrl: ctaUrl,
            signupUrl: PUBLIC_DEMO_SIGNUP_URL,
          };
        },
      }),
    };

    const system = buildPublicDemoSystemPrompt({
      channel,
      lead: initialLead,
      turnCount: conversation.turnCount,
      latestMessage: args.messageText,
    });
    const messages = [
      ...logsToMessages(logs.slice(0, -1)),
      {
        role: "user" as const,
        content: args.subject
          ? `Subject: ${args.subject}\n\n${args.messageText}`
          : args.messageText,
      },
    ];

    const publicDemoRunId =
      args.sourceMessageId ??
      args.resendEmailId ??
      `${String(conversation._id)}:${logs.length}`;
    let result = await generateAgentTextForPublicTask(
      ctx,
      task,
      {
        maxOutputTokens: channel === "imessage" ? 120 : 700,
        system,
        messages,
        tools,
        stopWhen: stepCountIs(5),
      },
      {
        taskKind:
          channel === "email" ? "public_demo_email_reply" : "public_demo_chat",
        sessionKey: String(conversation._id),
        trace: {
          traceId: `${publicDemoRunId}:agent`,
          parentRequestId: publicDemoRunId,
          label: "convex.publicDemoAgent",
          phase:
            channel === "email"
              ? "public_demo_email_reply"
              : "public_demo_chat",
          channel,
        },
      },
    );

    let responseText = generatedTextFromResult(result).trim();
    const lead = mergeLead(conversation, leadPatch);
    const needsTextEmail = publicDemoNeedsTextEmail({
      channel,
      lead,
      latestMessage: args.messageText,
    });
    if (needsTextEmail && ctaStatus !== "cal_link_sent") {
      ctaStatus = "asked_for_email";
    }
    const nextStage = inferStage({
      current: conversation.stage,
      message: args.messageText,
      ctaStatus,
      lead,
    });
    let validatedResponse = validatedPublicDemoResponse({
      text: responseText,
      channel,
      alreadyWarned,
    });
    if (!validatedResponse) {
      const retry = await generateAgentTextForPublicTask(
        ctx,
        task,
        {
          maxOutputTokens: channel === "imessage" ? 120 : 700,
          system: `${system}\n\nRETRY REQUIREMENT: Return one self-contained, safe response under ${PUBLIC_DEMO_TRANSPORT_CAPS[channel]} Unicode code points. Do not claim that a real artifact was created or delivered. Do not add a simulation notice; the transport owns it.`,
          messages: [
            ...messages,
            { role: "assistant", content: responseText },
            {
              role: "user",
              content:
                "Rewrite that response to satisfy the retry requirement without adding a new topic or call to action.",
            },
          ],
        },
        {
          taskKind:
            channel === "email"
              ? "public_demo_email_reply"
              : "public_demo_chat",
          sessionKey: String(conversation._id),
          trace: {
            traceId: `${publicDemoRunId}:retry`,
            parentRequestId: publicDemoRunId,
            label: "convex.publicDemoAgent.retry",
            phase:
              channel === "email"
                ? "public_demo_email_reply"
                : "public_demo_chat",
            channel,
          },
        },
      );
      result = retry;
      responseText = generatedTextFromResult(retry).trim();
      validatedResponse = validatedPublicDemoResponse({
        text: responseText,
        channel,
        alreadyWarned,
      });
    }
    responseText =
      validatedResponse ??
      addSimulationNotice({
        text: NEUTRAL_PUBLIC_DEMO_FAILURE,
        channel,
        alreadyWarned,
      });

    const toolCalls = collectToolAudit(result).toolCalls;
    const formatted =
      channel === "email"
        ? formatPublicDemoEmail({
            body: responseText,
            agentAddress: args.agentAddress,
          })
        : { text: responseText, html: markdownToHtml(responseText) };
    const outboundLogId = await ctx.runMutation(
      internal.publicDemo.appendChatLog,
      {
        conversationId: conversation._id,
        channel,
        direction: "outbound",
        subject: args.subject,
        content: responseText,
        contentHtml: formatted.html,
        modelProvider: result.route.provider,
        model: result.route.model,
        routeSource: result.routeSource,
        transport: result.transport,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        ctaUrl,
        deliveryStatus: "generated",
      },
    );
    await ctx.runMutation(internal.publicDemo.updateConversationLead, {
      conversationId: conversation._id,
      leadName: lead.name,
      leadCompany: lead.company,
      leadEmail: lead.email,
      leadUseCase: lead.useCase,
      stage: nextStage,
      ctaStatus,
      safetyNoticeSent: true,
    });

    const latestLogs = await ctx.runQuery(
      internal.publicDemo.listConversationLogsInternal,
      {
        conversationId: conversation._id,
        limit: 20,
      },
    );
    await ctx.runMutation(internal.publicDemo.upsertSalesTranscript, {
      conversationId: conversation._id,
      channel,
      senderContact: args.senderContact,
      leadName: lead.name,
      leadCompany: lead.company,
      leadEmail: lead.email,
      leadUseCase: lead.useCase,
      stage: nextStage,
      ctaStatus,
      summary: transcriptSummary({
        lead,
        stage: nextStage,
        ctaStatus,
        latestMessage: args.messageText,
      }),
      objections: extractObjections(latestLogs),
      nextStep: nextStep(nextStage, ctaStatus),
      curatedTurns: latestLogs.slice(-8).map((log) => ({
        speaker: log.direction === "inbound" ? "Prospect" : "Spot demo agent",
        content: stripMarkdown(log.content).slice(0, 1200),
        at: log.createdAt,
      })),
    });

    return {
      conversationId: conversation._id,
      outboundLogId,
      text: formatted.text,
      html: formatted.html,
      ctaUrl,
      route: result.route,
      routeSource: result.routeSource,
    };
  },
});
