"use node";

import { z } from "zod";
import { decideWithFallback } from "./decisions";
import {
  acceptedChoice,
  choiceQuestion,
  decisionState,
} from "./domainDecisionQuestions";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { generateObjectForOrg } from "./models";
import type { ForwardReplyDirection } from "./inboundEmailParser";

const ForwardReplyDecisionSchema = z.object({
  target: z.enum(["forwarder", "original_sender", "ambiguous"]),
  direction: z.enum(["affirmative", "negated", "absent", "ambiguous"]),
  originalSender: z.string().email().optional(),
  intentEvidence: z.string().max(240),
  confidence: z.number().min(0).max(1),
});

export async function decideForwardReplyDirection(
  ctx: ActionCtx,
  args: {
    orgId: Id<"organizations">;
    currentText: string;
    forwarderEmail: string;
    parsedOriginalSender?: string;
  },
): Promise<ForwardReplyDirection | undefined> {
  if (!args.parsedOriginalSender) return undefined;
  const decision = await decideWithFallback<ForwardReplyDirection | null>({
    ctx,
    orgId: args.orgId,
    family: "intent.forward_direction",
    state: decisionState(args),
    questions: {
      target: choiceQuestion(
        "Who does the forwarding user's current unquoted text explicitly direct Spot to answer?",
        {
          original_sender: {
            meaning:
              "Affirmative explicit reply/respond direction to the exact parsedOriginalSender, with no negation or ambiguity.",
            address: args.parsedOriginalSender,
          },
          forwarder:
            "No explicit direction to answer the original sender; forwarding, review requests and quoted headers do not authorize redirecting a reply.",
        },
      ),
    },
    accept: (answers) => {
      const choice = acceptedChoice(answers.target, [
        "original_sender",
        "forwarder",
      ]);
      if (!choice) return undefined;
      return choice.value === "original_sender"
        ? {
            target: "original_sender",
            originalSender: args.parsedOriginalSender!.trim().toLowerCase(),
          }
        : null;
    },
    fallback: async () =>
      (await reasonForwardReplyDirection(ctx, args)) ?? null,
  });
  return decision ?? undefined;
}

async function reasonForwardReplyDirection(
  ctx: ActionCtx,
  args: {
    orgId: Id<"organizations">;
    currentText: string;
    forwarderEmail: string;
    parsedOriginalSender?: string;
  },
): Promise<ForwardReplyDirection | undefined> {
  if (!args.parsedOriginalSender) return undefined;
  try {
    const { object } = await generateObjectForOrg(
      ctx,
      args.orgId,
      "classification",
      {
        schema: ForwardReplyDecisionSchema,
        maxOutputTokens: 220,
        system: `Decide who Spot is explicitly directed to answer in an internally forwarded email. Default to the forwarding user. Select original_sender only when the forwarding user's current, unquoted text affirmatively tells Spot to reply or respond to that exact original sender. Merely forwarding a message, asking Spot to review it, or quoting headers is not direction. Honor negation. Return the exact supplied original sender address or omit it.`,
        prompt: JSON.stringify({
          currentText: args.currentText,
          forwarderEmail: args.forwarderEmail,
          originalSender: args.parsedOriginalSender,
        }),
      },
    );
    const parsed = ForwardReplyDecisionSchema.safeParse(object);
    if (!parsed.success) return undefined;
    const decision = parsed.data;
    const originalSender = args.parsedOriginalSender.trim().toLowerCase();
    return decision.target === "original_sender" &&
      decision.direction === "affirmative" &&
      decision.confidence >= 0.9 &&
      decision.originalSender?.trim().toLowerCase() === originalSender &&
      Boolean(decision.intentEvidence.trim())
      ? { target: "original_sender", originalSender }
      : undefined;
  } catch {
    return undefined;
  }
}
