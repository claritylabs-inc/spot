"use node";

import type { ActionCtx } from "../_generated/server";
import { clRouterDecide } from "./clRouterClient";
import { jevChoiceConfidence, jevProceeds } from "./jevThreshold";

const RECENT_MESSAGE_LIMIT = 12;
const MESSAGE_TEXT_LIMIT = 400;
const DECISION_BUDGET_MS = 6000;

export type ThreadingCandidate = {
  guid: string;
  fromSpot: boolean;
  text: string;
  sentAt: number;
};

export type ReplyThreadingDecision =
  | { mode: "thread"; guid: string }
  | { mode: "plain" }
  | { mode: "default" };

/** Chat history in the shape Jev sees: newest first, ids kept out of its view. */
export function threadingCandidates(
  messages: readonly {
    guid: string;
    isFromMe?: boolean;
    isSystemMessage?: boolean;
    reaction?: unknown;
    dateCreated?: Date;
    content: { text?: string; attachments: readonly unknown[] };
  }[],
): ThreadingCandidate[] {
  return messages
    .filter((message) => !message.isSystemMessage && !message.reaction)
    .map((message) => ({
      guid: message.guid,
      fromSpot: message.isFromMe === true,
      text:
        message.content.text?.trim().slice(0, MESSAGE_TEXT_LIMIT) ||
        (message.content.attachments.length > 0 ? "(attachment)" : ""),
      sentAt: message.dateCreated?.getTime() ?? 0,
    }))
    .filter((candidate) => candidate.text)
    .sort((a, b) => b.sentAt - a.sentAt)
    .slice(0, RECENT_MESSAGE_LIMIT);
}

/**
 * Asks Jev whether the reply should be a native threaded reply, and to which
 * earlier message. `default` means Jev was unavailable or unsure, so the caller
 * keeps its previous behavior (thread to the inbound message when known).
 */
export async function decideReplyThreading(
  ctx: ActionCtx,
  args: {
    incomingText: string;
    replyText: string;
    candidates: readonly ThreadingCandidate[];
  },
): Promise<ReplyThreadingDecision> {
  if (args.candidates.length === 0) return { mode: "default" };
  const keys = args.candidates.map((_, index) => `m${index}`);
  const now = Date.now();
  try {
    const result = await clRouterDecide(
      {
        task: "imessage_reply_threading",
        state: {
          incoming_message: args.incomingText.slice(0, MESSAGE_TEXT_LIMIT),
          reply: args.replyText.slice(0, 1200),
          recent_messages: Object.fromEntries(
            args.candidates.map((candidate, index) => [
              keys[index],
              {
                from: candidate.fromSpot ? "spot" : "user",
                minutes_ago: Math.max(
                  0,
                  Math.round((now - candidate.sentAt) / 60000),
                ),
                text: candidate.text,
              },
            ]),
          ),
        },
        questions: {
          thread_helps: {
            type: "noul",
            instructions: {
              question:
                "Is `reply` answering one specific earlier message in `recent_messages` in a way that is unclear unless the reply is attached to that message as a native threaded reply?",
              focus:
                "Replies to an older message, or to one of several recent questions, where a standalone message would leave the reader guessing what is being answered.",
              not_for:
                "A reply that follows naturally from the latest `incoming_message`, greetings, acknowledgements, or a new topic.",
            },
          },
          target: {
            type: "choice",
            instructions:
              "Which message in `recent_messages` is `reply` primarily answering?",
            criteria: {
              ...Object.fromEntries(
                keys.map((key) => [
                  key,
                  {
                    what: `The message in \`recent_messages.${key}\`.`,
                    not_for: "A different earlier message, or the latest `incoming_message`.",
                  },
                ]),
              ),
              none: "No single earlier message is being answered.",
            },
          },
        },
        executionBudgetMs: DECISION_BUDGET_MS,
      },
      { telemetry: ctx },
    );
    const helps = result.answers.thread_helps;
    const target = result.answers.target;
    if (helps?.type !== "noul" || target?.type !== "choice") {
      return { mode: "default" };
    }
    // Confident "no": send a plain reply. Unsure: keep the default behavior.
    if (jevProceeds(1 - helps.noul)) return { mode: "plain" };
    if (!jevProceeds(helps.noul)) return { mode: "default" };
    if (!jevProceeds(jevChoiceConfidence(target))) return { mode: "default" };
    const index = keys.indexOf(target.choice);
    const candidate = index === -1 ? undefined : args.candidates[index];
    return candidate ? { mode: "thread", guid: candidate.guid } : { mode: "default" };
  } catch (error) {
    console.warn(
      "[imessage-threading] Jev threading decision failed:",
      error instanceof Error ? error.message : error,
    );
    return { mode: "default" };
  }
}
