"use node";

import { v } from "convex/values";
import { z } from "zod";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  generateObjectForOrg,
  generateObjectForPublicTask,
} from "../lib/models";
import { logAiError } from "../lib/aiUtils";
import { tokenizeSearchText } from "../lib/searchTokenizer";
import {
  slackThreadTitle,
  slackThreadTitleSeed,
} from "../lib/slackThreadTitle";
import { buildTitleSystemPrompt } from "../lib/channelStyle";

export const TITLE_SYSTEM_PROMPT = buildTitleSystemPrompt();

const ThreadTitleOutputSchema = z.object({
  title: z.string().min(1).max(80),
});

const TITLE_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "about",
  "of",
  "to",
  "this",
  "please",
  "can",
  "could",
  "would",
  "will",
  "you",
  "your",
  "our",
  "what",
  "when",
  "where",
  "which",
  "show",
  "tell",
  "need",
  "want",
  "does",
  "have",
  "new",
]);

const CONVERSATIONAL_TITLE_OPENINGS = new Set([
  "can you",
  "could you",
  "would you",
  "will you",
  "i need",
  "i want",
  "we need",
  "we want",
]);

type TitleContext = {
  userMessage: string;
  initialContext?: {
    pageType: string;
    summary?: string;
  };
  attachments?: Array<{
    filename: string;
    contentType?: string;
  }>;
  assistantReply?: string;
};

type ThreadTitleGenerationArgs = {
  seed: string;
  context: TitleContext;
  titlePrefix?: string;
};

async function generateThreadTitle(
  generateObject: (options: {
    schema: typeof ThreadTitleOutputSchema;
    maxOutputTokens: number;
    system: string;
    prompt: string;
  }) => Promise<{ object: z.infer<typeof ThreadTitleOutputSchema> }>,
  args: ThreadTitleGenerationArgs,
) {
  let subject = fallbackTitle(args.seed);
  const result = await generateObject({
    schema: ThreadTitleOutputSchema,
    maxOutputTokens: 16,
    system: buildTitleSystemPrompt({ slack: Boolean(args.titlePrefix) }),
    prompt: buildTitlePromptContent(args.context),
  });
  const generated = normalizeGeneratedTitle(result.object.title);
  if (generated) subject = generated;
  return args.titlePrefix
    ? slackThreadTitle(args.titlePrefix, subject)
    : subject;
}

function fallbackThreadTitle(seed: string, prefix?: string) {
  const fallback = fallbackTitle(seed);
  return prefix ? slackThreadTitle(prefix, fallback) : fallback;
}

function stripStructuredTitleNoise(input: string): string {
  return input
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ")
    .replace(/https?:\/\/\S+/giu, " ");
}

export function normalizeGeneratedTitle(raw: string): string | null {
  const trimmedRaw = raw.normalize("NFC").trim();
  if (
    !trimmedRaw ||
    trimmedRaw.includes("\n") ||
    /[\p{Cc}\p{Cf}]/u.test(trimmedRaw) ||
    /[*_`#>]/.test(trimmedRaw) ||
    /^\s*(?:[-+]\s|\d+[.)]\s)/.test(trimmedRaw) ||
    /@|https?:\/\//iu.test(trimmedRaw)
  ) {
    return null;
  }

  const cleaned = trimmedRaw
    .replace(/^["'“”‘’]|["'“”‘’]$/gu, "")
    .replace(/[.!?]+$/gu, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return null;
  if (Array.from(cleaned).length > 40) return null;
  if (cleaned.split(/\s+/).length > 4) return null;
  if (!/^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}\s&'’+/-]*$/u.test(cleaned)) {
    return null;
  }
  const words = tokenizeSearchText(cleaned);
  const conversationalOpening = words.slice(0, 2).join(" ");
  if (
    CONVERSATIONAL_TITLE_OPENINGS.has(conversationalOpening) ||
    words[0] === "please"
  ) {
    return null;
  }
  if (
    words.some((word) =>
      ["analyze", "analyse", "understand", "identify", "determine"].includes(word),
    ) && words.some((word) => ["request", "intent"].includes(word))
  ) {
    return null;
  }
  return cleaned;
}

export function fallbackTitle(seed: string): string {
  const titleText = stripStructuredTitleNoise(seed);
  const words = tokenizeSearchText(titleText, {
    minimumLength: 2,
  })
    .filter((word) => !TITLE_STOP_WORDS.has(word))
    .filter((word) => !/^\p{N}+$/u.test(word))
    .slice(0, 4);

  const fallbackWords = words.length
    ? words
    : tokenizeSearchText(titleText, { minimumLength: 1 }).slice(0, 4);
  const titledWords = fallbackWords
    .map((word) => {
      const [first, ...rest] = Array.from(word);
      return `${first?.toLocaleUpperCase("und") ?? ""}${rest.join("")}`;
    });
  const boundedWords: string[] = [];
  for (const word of titledWords) {
    const candidate = [...boundedWords, word].join(" ");
    if (Array.from(candidate).length > 40) break;
    boundedWords.push(word);
  }
  const title = boundedWords.join(" ").trim();

  return title || "New Chat";
}

export function buildTitlePromptContent(context: TitleContext): string {
  const parts = [
    `Initial user request:\n${context.userMessage.trim().slice(0, 900)}`,
  ];

  if (context.initialContext) {
    const lines = [`Page type: ${context.initialContext.pageType}`];
    if (context.initialContext.summary) lines.push(`Page summary: ${context.initialContext.summary}`);
    parts.push(`Starting page context:\n${lines.join("\n")}`);
  }

  if (context.attachments?.length) {
    parts.push(
      `Initial attachments:\n${context.attachments
        .map((attachment) => `- ${attachment.filename}${attachment.contentType ? ` (${attachment.contentType})` : ""}`)
        .join("\n")}`,
    );
  }

  if (context.assistantReply?.trim()) {
    parts.push(`Assistant response summary:\n${context.assistantReply.trim().slice(0, 300)}`);
  }

  return parts.join("\n\n");
}

export const generate = internalAction({
  args: {
    threadId: v.id("threads"),
    userMessageId: v.optional(v.id("threadMessages")),
    expectedTitle: v.optional(v.string()),
    titlePrefix: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      const thread = await ctx.runQuery(internal.threads.getInternal, {
        id: args.threadId,
      });
      if (!thread) return;
      const expectedTitle = args.expectedTitle ?? "New chat";
      if (thread.title !== expectedTitle) return;

      const message = args.userMessageId
        ? await ctx.runQuery(internal.threads.getMessageInternal, {
            id: args.userMessageId,
          })
        : undefined;
      const rawSeed = (message?.content ?? "").trim();
      const seed = args.titlePrefix
        ? slackThreadTitleSeed(rawSeed)
        : rawSeed;
      if (!seed) return;
      const context = {
        userMessage: seed,
        initialContext: thread.initialContext,
        attachments: message?.attachments?.flatMap(
          (attachment: { filename?: string; contentType?: string }) =>
            attachment.filename
              ? [
                  {
                    filename: attachment.filename,
                    contentType: attachment.contentType,
                  },
                ]
              : [],
        ),
      };

      let title: string;
      try {
        title = await generateThreadTitle(
          (options) =>
            generateObjectForOrg(ctx, thread.orgId, "summary", options),
          { seed, context, titlePrefix: args.titlePrefix },
        );
      } catch (err) {
        logAiError("threadTitle.generateText", err, { threadId: args.threadId });
        title = fallbackThreadTitle(seed, args.titlePrefix);
      }

      await ctx.runMutation(internal.threads.updateTitleInternal, {
        threadId: args.threadId,
        title,
        expectedTitle,
      });
    } catch (err) {
      logAiError("threadTitle.generate", err, { threadId: args.threadId });
    }
  },
});

export const generateOperatorSlack = internalAction({
  args: {
    threadId: v.id("operatorAgentThreads"),
    expectedTitle: v.string(),
    titlePrefix: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const context = await ctx.runQuery(
        internal.operatorAgent.getSlackThreadTitleContextInternal,
        { threadId: args.threadId, expectedTitle: args.expectedTitle },
      );
      if (!context) return;
      const seed = slackThreadTitleSeed(context.message.content);
      if (!seed) return;
      const titleContext = {
        userMessage: seed,
        attachments: context.message.attachments?.map(
          (attachment: { filename: string; contentType?: string }) => ({
            filename: attachment.filename,
            contentType: attachment.contentType,
          }),
        ),
      };
      let title: string;
      try {
        title = await generateThreadTitle(
          (options) => generateObjectForPublicTask(ctx, "summary", options),
          { seed, context: titleContext, titlePrefix: args.titlePrefix },
        );
      } catch (error) {
        logAiError("threadTitle.generateOperatorSlackText", error, {
          threadId: args.threadId,
        });
        title = fallbackThreadTitle(seed, args.titlePrefix);
      }
      await ctx.runMutation(
        internal.operatorAgent.updateSlackThreadTitleInternal,
        {
          threadId: args.threadId,
          expectedTitle: args.expectedTitle,
          title,
        },
      );
    } catch (error) {
      logAiError("threadTitle.generateOperatorSlack", error, {
        threadId: args.threadId,
      });
    }
  },
});
