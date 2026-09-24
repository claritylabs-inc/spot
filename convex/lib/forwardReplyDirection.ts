"use node";

import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { clRouterDecide } from "./clRouterClient";
import { jevProceeds } from "./jevThreshold";
import type { ForwardReplyDirection } from "./inboundEmailParser";

export async function decideForwardReplyDirection(
  _ctx: ActionCtx,
  args: {
    orgId: Id<"organizations">;
    currentText: string;
    forwarderEmail: string;
    parsedOriginalSender?: string;
  },
): Promise<ForwardReplyDirection | undefined> {
  if (!args.parsedOriginalSender) return undefined;
  try {
    const originalSender = args.parsedOriginalSender.trim().toLowerCase();
    const result = await clRouterDecide({
      orgId: args.orgId,
      task: "forward_reply_direction",
      state: {
        currentText: args.currentText,
        forwarderEmail: args.forwarderEmail,
        originalSender,
      },
      questions: {
        replyToOriginal: {
          type: "noul",
          instructions:
            "Does the forwarding user's current unquoted text explicitly and affirmatively direct Spot to reply to the exact supplied original sender? Merely forwarding, asking for review, quoted headers, negation, and ambiguity do not qualify. Default to the forwarder.",
          criteria: {
            true: "Explicit affirmative direction to reply to the supplied original sender",
            false: "Absent, negated, ambiguous, or quoted direction",
          },
        },
      },
    }, { telemetry: _ctx });
    const answer = result.answers.replyToOriginal;
    return answer?.type === "noul" && jevProceeds(answer.noul)
      ? { target: "original_sender", originalSender }
      : undefined;
  } catch {
    return undefined;
  }
}
