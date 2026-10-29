"use node";

import { v } from "convex/values";
import { z } from "zod";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { logAiError } from "../lib/aiUtils";
import { clRouterDecide } from "../lib/clRouterClient";
import { jevChoiceConfidence, jevProceeds } from "../lib/jevThreshold";
import { generateObjectForPublicTask } from "../lib/models";

const MAX_SUGGESTION_CHARS = 160;

const CandidatesSchema = z.object({
  candidates: z.array(z.string().min(1).max(240)).max(3),
});

const SYSTEM_PROMPT = [
  "You suggest what an insurance operations operator will type next to their operator agent.",
  "Return up to three distinct candidates, each one short sentence in the operator's own voice, addressed to the agent.",
  "Ground every candidate in the conversation: answer a question the agent asked, take the next action the agent offered, or ask the obvious follow-up.",
  "Use only names, records and facts that appear in the conversation; never invent identifiers, amounts or dates.",
  "Return no candidates when the conversation is complete or needs information only the operator has.",
].join(" ");

function normalizeCandidate(raw: string): string | null {
  const text = raw
    .normalize("NFC")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text.length > MAX_SUGGESTION_CHARS || /[\p{Cc}\p{Cf}]/u.test(text))
    return null;
  return text;
}

/** Small-model candidates for the operator's next message; Jev picks one or none. */
export const suggest = internalAction({
  args: { messageId: v.id("operatorAgentMessages"), revision: v.number() },
  handler: async (ctx, args): Promise<null> => {
    const conversation = await ctx.runQuery(
      internal.operatorNextMessage.contextInternal,
      args,
    );
    if (!conversation?.length) return null;
    const traceId = `operator-next-message:${args.messageId}:${args.revision}`;
    try {
      const { object } = await generateObjectForPublicTask(
        ctx,
        "summary",
        {
          schema: CandidatesSchema,
          maxOutputTokens: 200,
          system: SYSTEM_PROMPT,
          prompt: conversation
            .map(({ role, content }) => `${role}:\n${content}`)
            .join("\n\n"),
        },
        {
          taskKind: "operator_next_message",
          trace: { traceId, channel: "web" },
        },
      );
      const candidates = [
        ...new Set(object.candidates.flatMap((c) => normalizeCandidate(c) ?? [])),
      ];
      if (candidates.length === 0) return null;
      const result = await clRouterDecide(
        {
          task: "operator_next_message",
          trace: { traceId, channel: "web" },
          state: { conversation, candidates },
          questions: {
            next: {
              type: "choice",
              instructions:
                "Which entry in `candidates` is the message the operator is most likely to send next, given the last agent reply in `conversation`? Choose none when no candidate is a natural, useful next step.",
              criteria: Object.fromEntries([
                ...candidates.map((_, index) => [
                  `c${index}`,
                  {
                    what: `\`candidates[${index}]\` directly continues the last agent reply and uses only facts in \`conversation\`.`,
                    not_for:
                      "Repeating a finished request, inventing facts, or changing the subject.",
                  },
                ]),
                [
                  "none",
                  "No candidate is a likely, grounded next message, or the conversation is complete.",
                ],
              ]),
            },
          },
          executionBudgetMs: 8_000,
        },
        { telemetry: ctx, abortSignal: AbortSignal.timeout(10_000) },
      );
      const answer = result.answers.next;
      if (
        answer?.type !== "choice" ||
        answer.choice === "none" ||
        !jevProceeds(jevChoiceConfidence(answer))
      )
        return null;
      const suggestion = candidates[Number(answer.choice.slice(1))];
      if (!suggestion) return null;
      await ctx.runMutation(internal.operatorNextMessage.saveInternal, {
        ...args,
        suggestion,
      });
    } catch (error) {
      // Optional hint: never retry an unknown inference outcome.
      logAiError("operatorNextMessage.suggest", error, {
        messageId: args.messageId,
      });
    }
    return null;
  },
});
