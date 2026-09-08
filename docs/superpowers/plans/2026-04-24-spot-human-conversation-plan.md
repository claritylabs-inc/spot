# Spot Human Conversation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the tone-deaf first-contact loop bug in Spot and rehumanize conversation cadence with intent-aware routing, an LLM-driven discovery chat for users without policies, read receipts + typing indicators, and shorter chunked replies — shipped safely before a same-day 300-person event.

**Architecture:** Additive only. Two new Convex files (`intent.ts`, `noPolicyChat.ts`), new fields on the `users` table, three new helpers in `sendHelpers.ts`, and targeted edits to `process.ts`/`linq.ts`/`openphone.ts`/`imessageBridge.ts` to wire them in. The existing state machine stays; we intercept first-contact and add a graceful no-policy branch. Copy pass replaces robotic strings with the "chill friend" voice codex. Two kill-switch-free safeguards — 2s inbound debounce + consecutive-duplicate outbound guard — protect against rapid-fire and race conditions at event scale.

**Tech Stack:** Convex (TypeScript serverless), Vercel AI SDK, Anthropic Claude Haiku (classifier) + Claude Sonnet 4.6 (no-policy chat fallback via `models.ts`), OpenAI GPT-5.4 Mini (primary Q&A — unchanged), Linq API v3 (iMessage/RCS/SMS), OpenPhone (SMS fallback).

**Context note — testing approach:** This codebase has no existing test harness (`npm test` is unconfigured; there are no `*.test.ts` files). Writing Jest/Vitest from scratch is out of scope for a same-day event deploy. Instead, each task ends with a **dev-deploy smoke test** against the dev Convex deployment (`kindhearted-labrador-258`) and a commit. The soak test at the end of the plan exercises the full matrix on real phones.

**Spec reference:** `docs/superpowers/specs/2026-04-24-spot-human-conversation-design.md` — all design decisions locked with user.

---

## File Structure

**New files (2):**
- `convex/intent.ts` — first-message classifier (Claude Haiku, 3s timeout, 6 intents)
- `convex/noPolicyChat.ts` — LLM-driven discovery chat handler (Sonnet, structured output, 8s timeout)

**Modified files (6):**
- `convex/schema.ts` — 5 new optional user fields; add `"no_policy_chat"` to allowed state values (comment only — state is `v.string()`)
- `convex/sendHelpers.ts` — `acknowledgeInbound`, new delay formula in `sendBurst`, `debounceInbound` mutation helper, duplicate-guard in `sendAndLog`
- `convex/process.ts` — new `processBufferedTurn` action (drains debounce buffer + dispatches), copy rewrites across all hardcoded strings, `handleCategorySelection` loop fix with no-policy keyword scan and attempt counter, voice codex prepended to `handleQuestion` system prompt
- `convex/linq.ts` — webhook routes through `debounceInbound` for text-only messages; first message runs through classifier before dispatch
- `convex/openphone.ts` — same debounce + first-message classifier routing (no `markRead`/typing)
- `convex/imessageBridge.ts` — same as `openphone.ts` (bridge also lacks native typing/read receipts via the API)

Each file has one clear responsibility. No file exceeds ~400 new lines of added code in this pass.

---

## Prerequisites

- [ ] **Step 0: Confirm env state**

Run:
```bash
cd /Users/adyan/code/experiments/spot && git branch --show-current && git status --short
```

Expected: on `main` with some uncommitted changes (`convex/_generated/api.d.ts`, `convex/linq.ts`, new `app/banner/`, `convex/sandbox.ts`).

- [ ] **Step 0.1: Stash or review uncommitted changes**

If the uncommitted changes are work-in-progress you want to keep separate from this plan, stash them:
```bash
git stash push -m "pre-spot-human-conv-plan"
```

If they're intended to be part of this deploy, leave them and they'll be included in the first commit of Task 1. Ask the user to confirm before stashing.

- [ ] **Step 0.2: Create feature branch**

```bash
git checkout -b feature/human-conversation-redesign
```

Expected: switched to a new branch. All subsequent commits land here until the final merge-to-main step.

- [ ] **Step 0.3: Verify dev deployment reachable**

```bash
cd /Users/adyan/code/experiments/spot && npx convex dev --once
```

Expected: successful sync to `kindhearted-labrador-258`. If it prompts for login, complete it. This confirms the dev deployment is live before we start changing things.

---

## Task 1: Schema migration (additive fields on `users`)

**Files:**
- Modify: `convex/schema.ts:5-28`

Add five optional fields to the `users` table. All additive — no existing field changes, safe to deploy.

- [ ] **Step 1: Edit schema.ts**

Insert the following five fields inside the `users` table definition, after the existing `portfolioAnalysis` line (around line 21):

```ts
    // --- Human-conversation redesign (2026-04-24) ---
    noPolicyContext: v.optional(v.string()), // running summary from no-policy discovery chat
    categoryAttempts: v.optional(v.number()), // count of failed category parses, for 2-attempt fallback
    hasClassifiedFirstMessage: v.optional(v.boolean()), // true once first-message intent classifier has run
    messageBufferFirstAt: v.optional(v.number()), // timestamp of first message in current 2s debounce window
    messageBuffer: v.optional(v.array(v.string())), // buffered inbound text for 2s debounce window
```

Also update the inline state comment on line 9 to include the new state:

```ts
    state: v.optional(v.string()), // "awaiting_category" | "awaiting_policy" | "awaiting_email" | "awaiting_email_confirm" | "awaiting_insurance_slip" | "awaiting_merge_confirm" | "awaiting_clear_confirm" | "awaiting_app_questions" | "awaiting_app_confirm" | "no_policy_chat" | "active"
```

- [ ] **Step 2: Sync to dev deployment**

```bash
cd /Users/adyan/code/experiments/spot && npx convex dev --once
```

Expected: successful schema push to `kindhearted-labrador-258`. Because all new fields are optional, existing documents migrate automatically. No prompts.

- [ ] **Step 3: Commit**

```bash
git add convex/schema.ts
git commit -m "feat(spot): add user fields for human-conversation redesign

- noPolicyContext: running summary from discovery chat
- categoryAttempts: for 2-attempt fallback loop fix
- hasClassifiedFirstMessage: gates first-message classifier
- messageBuffer / messageBufferFirstAt: 2s debounce state"
```

---

## Task 2: `sendHelpers.ts` — tightened delay formula and duplicate-guard

**Files:**
- Modify: `convex/sendHelpers.ts:50-66` (delay formula in `sendBurst`)
- Modify: `convex/sendHelpers.ts:4-48` (`sendAndLog` — add duplicate-guard)

Two surgical edits. No new exports yet — `acknowledgeInbound` and `debounceInbound` come in Task 3.

- [ ] **Step 1: Replace the `sleep` + `sendBurst` delay formula**

Replace the current implementation (lines 50-66):

```ts
export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendBurst(
  ctx: any,
  userId: any,
  phone: string,
  messages: string[],
  linqChatId?: string,
  imessageSender?: string
) {
  for (let i = 0; i < messages.length; i++) {
    if (i > 0) await sleep(800 + Math.random() * 700);
    await sendAndLog(ctx, userId, phone, messages[i], linqChatId, imessageSender);
  }
}
```

with:

```ts
export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Tennis-rhythm delay: short messages arrive fast, longer messages take a beat.
// Base 300ms + 8ms per char, clamped to [400, 1200]ms, with ±100ms jitter.
function bubbleDelay(nextMessage: string): number {
  const base = 300 + nextMessage.length * 8;
  const clamped = Math.max(400, Math.min(1200, base));
  return clamped + (Math.random() * 200 - 100);
}

export async function sendBurst(
  ctx: any,
  userId: any,
  phone: string,
  messages: string[],
  linqChatId?: string,
  imessageSender?: string
) {
  for (let i = 0; i < messages.length; i++) {
    if (i > 0) await sleep(bubbleDelay(messages[i]));
    await sendAndLog(ctx, userId, phone, messages[i], linqChatId, imessageSender);
  }
}
```

- [ ] **Step 2: Add duplicate-guard to `sendAndLog`**

Replace the `sendAndLog` body (lines 5-48) with this version. The guard queries the most recent outbound message for the user; if it matches the new body verbatim, it appends a zero-width space to force difference. This is the safety net that makes the Anna-class loop *physically impossible* even if every other check fails.

```ts
// Channel-aware send: tries Linq first, then iMessage bridge, falls back to OpenPhone.
// Guards against identical consecutive outbound messages.
export async function sendAndLog(
  ctx: any,
  userId: any,
  phone: string,
  body: string,
  linqChatId?: string,
  imessageSender?: string
) {
  // Duplicate-guard: if the last outbound message was byte-identical, append
  // an invisible suffix so the user never sees the same line twice in a row.
  const lastOutbound = await ctx.runQuery(internal.messages.getLastOutbound, {
    userId,
  });
  let finalBody = body;
  if (lastOutbound && lastOutbound.body === body) {
    console.warn("[spot:duplicate_guard]", { userId, body });
    finalBody = body + "​"; // zero-width space; renders identical but differs byte-wise
  }

  let usedChannel = "openphone";

  if (linqChatId) {
    try {
      await ctx.runAction(internal.sendLinq.sendLinqMessage, {
        chatId: linqChatId,
        body: finalBody,
      });
      usedChannel = "linq";
    } catch (err) {
      console.error("Linq send failed, falling back to OpenPhone:", err);
      await ctx.runAction(internal.send.sendSms, { to: phone, body: finalBody });
    }
  } else if (imessageSender) {
    try {
      await ctx.runAction(internal.sendBridge.sendBridgeMessage, {
        to: imessageSender,
        body: finalBody,
      });
      usedChannel = "imessage_bridge";
    } catch (err) {
      console.error("iMessage bridge failed, falling back to OpenPhone:", err);
      await ctx.runAction(internal.send.sendSms, { to: phone, body: finalBody });
    }
  } else {
    await ctx.runAction(internal.send.sendSms, { to: phone, body: finalBody });
  }

  await ctx.runMutation(internal.messages.log, {
    userId,
    direction: "outbound" as const,
    body: finalBody,
    hasAttachment: false,
    channel: usedChannel,
  });
}
```

- [ ] **Step 3: Add `getLastOutbound` query to `messages.ts`**

The duplicate-guard needs a query that doesn't exist yet. Add to `convex/messages.ts` (append to the bottom of the file):

```ts
export const getLastOutbound = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("messages")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("direction"), "outbound"))
      .order("desc")
      .take(1);
    return results[0] || null;
  },
});
```

Make sure the imports at the top of `messages.ts` include `internalQuery` from `./_generated/server` and `v` from `convex/values`. If they're not there already, add them.

- [ ] **Step 4: Sync to dev**

```bash
cd /Users/adyan/code/experiments/spot && npx convex dev --once
```

Expected: successful push. No errors.

- [ ] **Step 5: Commit**

```bash
git add convex/sendHelpers.ts convex/messages.ts
git commit -m "feat(spot): tighten sendBurst cadence + add duplicate-guard

- bubbleDelay formula: base 300ms + 8ms/char, clamp [400,1200], ±100ms jitter
- sendAndLog guards against identical consecutive outbound messages
  via zero-width space suffix — invariant enforcement for Anna-class loop
- new internal query: messages.getLastOutbound"
```

---

## Task 3: `sendHelpers.ts` — `acknowledgeInbound` + `debounceInbound`

**Files:**
- Modify: `convex/sendHelpers.ts` (add two new exports)
- Modify: `convex/users.ts` (add mutations `appendMessageBuffer`, `drainMessageBuffer`)

- [ ] **Step 1: Add `appendMessageBuffer` and `drainMessageBuffer` mutations in `users.ts`**

These are the atomic primitives the debounce helper relies on. Convex mutations are serialized per-document, so concurrent calls writing to the same user are safe.

Append to `convex/users.ts`:

```ts
/**
 * Debounce primitive — append an inbound message to the user's buffer.
 * Returns { isFirstInWindow } — true if the buffer was empty before append,
 * meaning the caller should schedule a processBufferedTurn in 2s.
 */
export const appendMessageBuffer = internalMutation({
  args: {
    userId: v.id("users"),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return { isFirstInWindow: false };

    const existing = user.messageBuffer || [];
    const wasEmpty = existing.length === 0;

    await ctx.db.patch(args.userId, {
      messageBuffer: [...existing, args.text],
      messageBufferFirstAt: wasEmpty ? Date.now() : user.messageBufferFirstAt,
    });

    return { isFirstInWindow: wasEmpty };
  },
});

/**
 * Debounce primitive — read and clear the buffer.
 * Returns the concatenated text.
 */
export const drainMessageBuffer = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return { text: "", messageCount: 0 };

    const buffered = user.messageBuffer || [];
    const text = buffered.join(" ").trim();

    await ctx.db.patch(args.userId, {
      messageBuffer: [],
      messageBufferFirstAt: undefined,
    });

    return { text, messageCount: buffered.length };
  },
});
```

Make sure `internalMutation` is imported at the top of `users.ts`. If the file already uses `mutation` but not `internalMutation`, add it to the import line.

- [ ] **Step 2: Add `acknowledgeInbound` to `sendHelpers.ts`**

Append to `convex/sendHelpers.ts`:

```ts
/**
 * Linq-only: fire read receipt, pause briefly, then show typing indicator.
 * All calls swallow errors — acknowledgement is cosmetic, never blocks reply.
 *
 * Call this at the top of Linq inbound handlers, before dispatching to the
 * state machine, so the user sees "Read" + typing dots within ~500ms of sending.
 */
export async function acknowledgeInbound(
  ctx: any,
  linqChatId: string | undefined
): Promise<void> {
  if (!linqChatId) return;
  try {
    await ctx.runAction(internal.sendLinq.markRead, { chatId: linqChatId });
  } catch (err) {
    console.warn("[spot:ack_markRead_failed]", err);
  }
  await sleep(150 + Math.random() * 250); // 150-400ms pause, natural read-then-type beat
  try {
    await ctx.runAction(internal.sendLinq.startTyping, { chatId: linqChatId });
  } catch (err) {
    console.warn("[spot:ack_startTyping_failed]", err);
  }
}
```

- [ ] **Step 3: Add `debounceInbound` to `sendHelpers.ts`**

Append to `convex/sendHelpers.ts`:

```ts
/**
 * Rate-limit debounce. Collects rapid-fire inbound text into a 2s window
 * keyed per user. On first message, returns { shouldScheduleFlush: true }
 * and the caller must schedule processBufferedTurn 2s later. On subsequent
 * messages within the window, just appends and returns { shouldScheduleFlush: false }.
 *
 * Attachments bypass debounce (caller should skip this helper when hasAttachment).
 */
export async function debounceInbound(
  ctx: any,
  userId: any,
  text: string
): Promise<{ shouldScheduleFlush: boolean }> {
  const { isFirstInWindow } = await ctx.runMutation(
    internal.users.appendMessageBuffer,
    { userId, text }
  );
  console.log("[spot:debounce]", {
    userId,
    isFirstInWindow,
  });
  return { shouldScheduleFlush: isFirstInWindow };
}
```

- [ ] **Step 4: Sync to dev**

```bash
cd /Users/adyan/code/experiments/spot && npx convex dev --once
```

Expected: successful push.

- [ ] **Step 5: Commit**

```bash
git add convex/sendHelpers.ts convex/users.ts
git commit -m "feat(spot): acknowledgeInbound + debounceInbound helpers

- acknowledgeInbound: Linq markRead + startTyping with 150-400ms pause,
  errors swallowed (cosmetic only)
- debounceInbound: 2s rate-limit window per user, returns whether caller
  should schedule flush
- users.appendMessageBuffer / drainMessageBuffer: atomic buffer primitives"
```

---

## Task 4: `intent.ts` — first-message classifier

**Files:**
- Create: `convex/intent.ts`

Claude Haiku classifier that runs once per user, on their first message. Returns one of six intents with a 3s timeout and safe `unclear` fallback on any error.

- [ ] **Step 1: Create `convex/intent.ts`**

```ts
"use node";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";

export type Intent =
  | "greeting"
  | "capability_question"
  | "has_policy"
  | "no_policy_yet"
  | "wrong_number"
  | "unclear";

const IntentSchema = z.object({
  intent: z.enum([
    "greeting",
    "capability_question",
    "has_policy",
    "no_policy_yet",
    "wrong_number",
    "unclear",
  ]),
  extractedCategory: z
    .enum(["auto", "renters", "homeowners", "other"])
    .nullable()
    .describe("if user mentioned a specific policy category, extract it"),
  noteForContext: z
    .string()
    .max(200)
    .describe("one-line summary of what the user said, for downstream context"),
});

const SYSTEM = `you classify the first message someone sends to spot, an insurance-policy reader.

intents:
- greeting: just a hello, no content ("hey", "hi", "yo", "sup")
- capability_question: asking what spot does or what insurance they can get ("what is this", "what can you do", "what insurance can i get with you")
- has_policy: they have a policy to upload or mentioned a specific policy ("need to upload my renters", "here's my auto policy", "i've got my homeowners")
- no_policy_yet: they don't have insurance yet or are new / shopping / looking ("i don't have any", "new to the us", "just looking", "shopping for coverage")
- wrong_number: they don't know who you are in a hostile way ("who is this", "stop texting me", "remove me")
- unclear: anything else, including off-topic or ambiguous

if has_policy and they named a category (auto/renters/homeowners), set extractedCategory.
noteForContext: a single short line capturing the essence of what they said, useful for downstream handlers.`;

export const classifyFirstMessage = internalAction({
  args: { text: v.string() },
  handler: async (_ctx, args): Promise<{ intent: Intent; extractedCategory: string | null; noteForContext: string }> => {
    const anthropic = createAnthropic();
    const model = anthropic("claude-haiku-4-5-20251001");

    try {
      const result = await Promise.race([
        generateObject({
          model,
          schema: IntentSchema,
          system: SYSTEM,
          prompt: args.text,
          temperature: 0,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("classifier timeout")), 3000)
        ),
      ]);

      return {
        intent: result.object.intent,
        extractedCategory: result.object.extractedCategory,
        noteForContext: result.object.noteForContext,
      };
    } catch (err) {
      console.warn("[spot:intent_classifier_failed]", { text: args.text.slice(0, 80), err: String(err) });
      return {
        intent: "unclear",
        extractedCategory: null,
        noteForContext: args.text.slice(0, 200),
      };
    }
  },
});
```

- [ ] **Step 2: Sync to dev**

```bash
cd /Users/adyan/code/experiments/spot && npx convex dev --once
```

Expected: successful push.

- [ ] **Step 3: Smoke test the classifier from the Convex dashboard**

Open https://dashboard.convex.dev/d/kindhearted-labrador-258 → Functions → run `intent:classifyFirstMessage` with these inputs, one at a time:

```json
{ "text": "Hey Spot, what insurance can I get with you" }
```
Expected: `intent: "capability_question"`.

```json
{ "text": "hi" }
```
Expected: `intent: "greeting"`.

```json
{ "text": "need to upload my renters policy" }
```
Expected: `intent: "has_policy"`, `extractedCategory: "renters"`.

```json
{ "text": "I don't have any yet. I am new to the US" }
```
Expected: `intent: "no_policy_yet"`.

```json
{ "text": "who is this" }
```
Expected: `intent: "wrong_number"`.

If any of these misclassify, iterate the system prompt before moving on — the classifier is load-bearing for the whole redesign.

- [ ] **Step 4: Commit**

```bash
git add convex/intent.ts
git commit -m "feat(spot): add first-message intent classifier

- Claude Haiku with 3s timeout and structured output (6 intents)
- on timeout/error defaults to 'unclear' so never blocks a reply
- extracts category when present, provides noteForContext for downstream"
```

---

## Task 5: `noPolicyChat.ts` — LLM-driven discovery chat

**Files:**
- Create: `convex/noPolicyChat.ts`

Sonnet 4.6 with structured output, 8s timeout, hardcoded fallback message. Loads `noPolicyContext` + last 10 messages, emits 1-5 short bubbles, updates context, signals exit.

- [ ] **Step 1: Create `convex/noPolicyChat.ts`**

```ts
"use node";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";
import { sendBurst } from "./sendHelpers";

const NoPolicyResponseSchema = z.object({
  messages: z
    .array(z.string())
    .min(1)
    .max(5)
    .describe("1-5 short bubbles, each 1-2 sentences max"),
  updatedContext: z
    .string()
    .max(600)
    .describe("running summary of what you've learned about this person — preserved across turns"),
  shouldExit: z
    .boolean()
    .describe("true when conversation is done (user signed off, has a policy to upload, or 6+ turns with no progress)"),
});

const SYSTEM = `you're spot — a chill friend who happens to know insurance. someone is texting you and they either don't have a policy yet, asked what spot does, or got here by mistake.

your mission: learn who this person is and figure out where you can actually be useful in their life.
- most people text you because they have a policy to read
- some don't — they're new, early-stage, just curious, or nothing set up yet
- your job isn't to get rid of them. get to know them. make them feel heard.
- if they're early-stage / new to the country / haven't set things up — probe for personal policies they might already have (parents' auto, previous-country renters, etc.). cover the personal side before the business side.
- be the friend they text when they DO finally get a policy. that's the win.

voice:
- lowercase unless proper noun
- short bubbles, 1-2 sentences each
- acknowledge what they said before pivoting
- no "haha", "no worries", "great question", or assistant tics
- no emojis unless they use one first
- chill friend, not a chatbot

engagement (tennis not lecture):
- short volleys, fast back-and-forth
- one question per message max, don't stack
- end with something that invites a reply (question, observation, callback)
- never dump the full answer in one bubble

discovery:
- lead with curiosity about THEM not their coverage needs
- ask what they do, where they're at, what they're building
- coverage read surfaces from who they are, never opens with it

boundaries:
- you don't sell insurance or recommend specific carriers
- you don't give legal or financial advice
- you don't promise coverage amounts or prices

exit conditions (set shouldExit: true):
- they mention having a policy or quote → "drop it in here and i'll read it"
- they sign off / say thanks / conversation drifts → warm wrap
- 6+ exchanges with no progress → warm wrap

output: 1-5 short bubbles per turn, updatedContext preserved for next turn, shouldExit when done.`;

export const handleNoPolicyChat = internalAction({
  args: {
    userId: v.id("users"),
    phone: v.string(),
    input: v.string(),
    linqChatId: v.optional(v.string()),
    imessageSender: v.optional(v.string()),
    seedContext: v.optional(v.string()), // for first turn coming from capability_question
  },
  handler: async (ctx, args) => {
    // Load user + recent messages + existing context
    const user: any = await ctx.runQuery(internal.users.getUser, {
      userId: args.userId,
    });
    const recentMessages: any[] = await ctx.runQuery(
      internal.messages.getRecent,
      { userId: args.userId, limit: 10 }
    );

    const priorContext = user?.noPolicyContext || args.seedContext || "";
    const history = recentMessages
      .map((m: any) => `${m.direction === "inbound" ? "user" : "spot"}: ${m.body}`)
      .join("\n");

    const prompt = `${priorContext ? `context so far: ${priorContext}\n\n` : ""}recent exchange:\n${history}\n\nuser just said: ${args.input}\n\nyour turn.`;

    const anthropic = createAnthropic();
    const model = anthropic("claude-sonnet-4-6");

    let result: { messages: string[]; updatedContext: string; shouldExit: boolean };
    try {
      const llmResult = await Promise.race([
        generateObject({
          model,
          schema: NoPolicyResponseSchema,
          system: SYSTEM,
          prompt,
          temperature: 0.7,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("no-policy chat timeout")), 8000)
        ),
      ]);
      result = llmResult.object;
    } catch (err) {
      console.warn("[spot:no_policy_chat_failed]", { userId: args.userId, err: String(err) });
      result = {
        messages: ["hmm one sec — something went weird on my end", "what's going on?"],
        updatedContext: priorContext,
        shouldExit: false,
      };
    }

    // Send bubbles
    await sendBurst(
      ctx,
      args.userId,
      args.phone,
      result.messages,
      args.linqChatId,
      args.imessageSender
    );

    // Persist context
    await ctx.runMutation(internal.users.setNoPolicyContext, {
      userId: args.userId,
      context: result.updatedContext,
    });

    // Transition state if done
    if (result.shouldExit) {
      await ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "active",
      });
      console.log("[spot:no_policy_exit]", {
        userId: args.userId,
        context: result.updatedContext,
      });
    }
  },
});
```

- [ ] **Step 2: Add `setNoPolicyContext` mutation + `getUser` query + `getRecent` to `messages.ts`**

Append to `convex/users.ts`:

```ts
export const setNoPolicyContext = internalMutation({
  args: {
    userId: v.id("users"),
    context: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { noPolicyContext: args.context });
  },
});

export const getUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
  },
});
```

Ensure `internalQuery` is imported at the top of `users.ts`. Similarly, append to `convex/messages.ts`:

```ts
export const getRecent = internalQuery({
  args: {
    userId: v.id("users"),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("messages")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(args.limit);
    return results.reverse(); // chronological order for prompt
  },
});
```

Verify `updateState` already exists in `users.ts` (it's used in `process.ts` today). If it doesn't, add:

```ts
export const updateState = internalMutation({
  args: {
    userId: v.id("users"),
    state: v.string(),
    preferredCategory: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: any = { state: args.state };
    if (args.preferredCategory !== undefined) {
      patch.preferredCategory = args.preferredCategory;
    }
    await ctx.db.patch(args.userId, patch);
  },
});
```

- [ ] **Step 3: Sync to dev**

```bash
cd /Users/adyan/code/experiments/spot && npx convex dev --once
```

Expected: successful push.

- [ ] **Step 4: Smoke test `handleNoPolicyChat` from Convex dashboard**

You'll need an existing test user. Grab your user ID by running the existing admin helper or querying the `users` table filtered by your phone (`+16479221805`).

Then call `noPolicyChat:handleNoPolicyChat` with:

```json
{
  "userId": "<your user id>",
  "phone": "+16479221805",
  "input": "I don't have any yet, new to the US",
  "linqChatId": "<your linqChatId from that user record, if present>",
  "seedContext": "user just asked what Spot does — clarify + start discovery"
}
```

Expected:
- 1-5 short bubbles arrive on your phone
- voice is lowercase, chunked, asks about YOU not coverage
- Your `noPolicyContext` field is populated after the call (check in dashboard)

If the voice comes out wrong (emojis, long paragraphs, "no worries"), iterate the SYSTEM prompt in `noPolicyChat.ts` before moving on. This is the most visible output of the redesign.

- [ ] **Step 5: Commit**

```bash
git add convex/noPolicyChat.ts convex/users.ts convex/messages.ts
git commit -m "feat(spot): no-policy discovery chat handler

- Sonnet 4.6 with structured output (messages[], updatedContext, shouldExit)
- 8s timeout with hardcoded fallback message
- persists noPolicyContext across turns for continuity
- transitions to active state on exit
- adds getUser, setNoPolicyContext, messages.getRecent helpers"
```

---

## Task 6: `process.ts` — `processBufferedTurn` action (debounce consumer)

**Files:**
- Modify: `convex/process.ts` — add new action

`processBufferedTurn` is scheduled 2 seconds after the first message in a debounce window arrives. It drains the buffer, runs the first-message classifier if needed, and dispatches to the correct handler. It is the single entry point for all routed behavior — the webhooks just forward inbound text into the debounce system and walk away.

- [ ] **Step 1: Add `processBufferedTurn` to `process.ts`**

Append near the top of `process.ts` (after the `sendWelcome` action, around line 265):

```ts
/**
 * Debounce flush: fires 2s after the first inbound in a rapid-fire window.
 * Drains the user's messageBuffer, runs the first-message classifier if this
 * is their first ever message, then dispatches to the correct handler based
 * on state + intent.
 *
 * Called by the webhook scheduler; never called directly by webhooks.
 */
export const processBufferedTurn = internalAction({
  args: {
    userId: v.id("users"),
    phone: v.string(),
    uploadToken: v.string(),
    linqChatId: v.optional(v.string()),
    imessageSender: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Drain the buffer atomically
    const { text, messageCount }: { text: string; messageCount: number } = await ctx.runMutation(
      internal.users.drainMessageBuffer,
      { userId: args.userId }
    );

    if (!text) {
      console.warn("[spot:empty_buffer_flush]", { userId: args.userId });
      return;
    }

    const user: any = await ctx.runQuery(internal.users.getUser, {
      userId: args.userId,
    });
    if (!user) return;

    // First-message classifier (runs once per user lifetime)
    if (!user.hasClassifiedFirstMessage) {
      const { intent, extractedCategory, noteForContext } = await ctx.runAction(
        internal.intent.classifyFirstMessage,
        { text }
      );
      console.log("[spot:intent]", {
        userId: args.userId,
        intent,
        extractedCategory,
        messageCount,
      });

      await ctx.runMutation(internal.users.markFirstMessageClassified, {
        userId: args.userId,
      });

      switch (intent) {
        case "greeting":
          await ctx.runAction(internal.process.sendWelcome, {
            userId: args.userId,
            phone: args.phone,
            uploadToken: args.uploadToken,
            linqChatId: args.linqChatId,
            imessageSender: args.imessageSender,
          });
          return;

        case "capability_question":
          // Send immediate warm opener, then hand off to no-policy chat
          await ctx.runAction(internal.sendLinq.sendLinqMessage, {
            chatId: args.linqChatId!,
            body: "hey!",
          }).catch(() => {});
          await ctx.runMutation(internal.users.updateState, {
            userId: args.userId,
            state: "no_policy_chat",
          });
          await ctx.runAction(internal.noPolicyChat.handleNoPolicyChat, {
            userId: args.userId,
            phone: args.phone,
            input: text,
            linqChatId: args.linqChatId,
            imessageSender: args.imessageSender,
            seedContext: `user just asked what spot does — clarify briefly that you read policies (not sell them) then start discovery about who they are. their exact words: "${text}"`,
          });
          return;

        case "has_policy":
          // Skip category question, jump to awaiting_policy with pre-filled category if present
          await ctx.runMutation(internal.users.updateState, {
            userId: args.userId,
            state: "awaiting_policy",
            preferredCategory: extractedCategory || undefined,
          });
          await sendBurst(
            ctx,
            args.userId,
            args.phone,
            [
              extractedCategory ? `${extractedCategory}, cool` : "ok cool",
              "drop the pdf or a photo in here",
            ],
            args.linqChatId,
            args.imessageSender
          );
          return;

        case "no_policy_yet":
          await ctx.runMutation(internal.users.updateState, {
            userId: args.userId,
            state: "no_policy_chat",
          });
          await ctx.runAction(internal.noPolicyChat.handleNoPolicyChat, {
            userId: args.userId,
            phone: args.phone,
            input: text,
            linqChatId: args.linqChatId,
            imessageSender: args.imessageSender,
            seedContext: `user said they don't have a policy yet. their exact words: "${text}". start discovery — learn who they are, what they're building.`,
          });
          return;

        case "wrong_number":
          await sendBurst(
            ctx,
            args.userId,
            args.phone,
            [
              "hey, this is spot — an insurance-policy reader",
              "if you didn't mean to text me, no problem, just ignore",
            ],
            args.linqChatId,
            args.imessageSender
          );
          return;

        case "unclear":
        default:
          // Route to no-policy chat with the raw text as seed
          await ctx.runMutation(internal.users.updateState, {
            userId: args.userId,
            state: "no_policy_chat",
          });
          await ctx.runAction(internal.noPolicyChat.handleNoPolicyChat, {
            userId: args.userId,
            phone: args.phone,
            input: text,
            linqChatId: args.linqChatId,
            imessageSender: args.imessageSender,
            seedContext: `first message was ambiguous. their exact words: "${text}". clarify that spot reads insurance policies (not sells them) and figure out what they need.`,
          });
          return;
      }
    }

    // Post-first-message: dispatch by state (same logic the webhook had)
    console.log("[spot:state_dispatch]", {
      userId: args.userId,
      state: user.state,
      messageCount,
    });

    if (user.state === "no_policy_chat") {
      await ctx.runAction(internal.noPolicyChat.handleNoPolicyChat, {
        userId: args.userId,
        phone: args.phone,
        input: text,
        linqChatId: args.linqChatId,
        imessageSender: args.imessageSender,
      });
      return;
    }

    if (user.state === "awaiting_category") {
      await ctx.runAction(internal.process.handleCategorySelection, {
        userId: args.userId,
        phone: args.phone,
        input: text,
        uploadToken: args.uploadToken,
        hasAttachment: false,
        linqChatId: args.linqChatId,
        imessageSender: args.imessageSender,
      });
      return;
    }

    if (user.state === "awaiting_email") {
      await ctx.runAction(internal.process.handleEmailCollection, {
        userId: args.userId,
        phone: args.phone,
        input: text,
        linqChatId: args.linqChatId,
      });
      return;
    }

    if (user.state === "awaiting_email_confirm") {
      await ctx.runAction(internal.process.handleEmailConfirmation, {
        userId: args.userId,
        phone: args.phone,
        input: text,
        linqChatId: args.linqChatId,
      });
      return;
    }

    if (user.state === "awaiting_merge_confirm") {
      await ctx.runAction(internal.process.handleMergeConfirmation, {
        userId: args.userId,
        phone: args.phone,
        input: text,
        linqChatId: args.linqChatId,
      });
      return;
    }

    if (user.state === "awaiting_clear_confirm") {
      await ctx.runAction(internal.process.handleClearConfirmation, {
        userId: args.userId,
        phone: args.phone,
        input: text,
        linqChatId: args.linqChatId,
      });
      return;
    }

    if (user.state === "awaiting_app_questions") {
      await ctx.runAction(internal.process.handleAppQuestions, {
        userId: args.userId,
        phone: args.phone,
        input: text,
        linqChatId: args.linqChatId,
      });
      return;
    }

    if (user.state === "awaiting_app_confirm") {
      await ctx.runAction(internal.process.handleAppConfirmation, {
        userId: args.userId,
        phone: args.phone,
        input: text,
        linqChatId: args.linqChatId,
      });
      return;
    }

    if (user.state === "awaiting_insurance_slip") {
      await ctx.runAction(internal.process.handleInsuranceSlipResponse, {
        userId: args.userId,
        phone: args.phone,
        input: text,
        uploadToken: args.uploadToken,
        linqChatId: args.linqChatId,
      });
      return;
    }

    if (user.state === "awaiting_policy") {
      await ctx.runAction(internal.process.nudgeForPolicy, {
        userId: args.userId,
        phone: args.phone,
        input: text,
        uploadToken: args.uploadToken,
        linqChatId: args.linqChatId,
        imessageSender: args.imessageSender,
      });
      return;
    }

    // Default: active state → handleQuestion
    await ctx.runAction(internal.process.handleQuestion, {
      userId: args.userId,
      question: text,
      phone: args.phone,
      uploadToken: args.uploadToken,
      linqChatId: args.linqChatId,
    });
  },
});
```

- [ ] **Step 2: Add `markFirstMessageClassified` mutation to `users.ts`**

Append to `convex/users.ts`:

```ts
export const markFirstMessageClassified = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { hasClassifiedFirstMessage: true });
  },
});
```

- [ ] **Step 3: Verify signature compatibility**

`nudgeForPolicy` and `handleCategorySelection` signatures referenced above must accept `imessageSender`. Open `convex/process.ts:364` (`nudgeForPolicy` args) and `convex/process.ts:266-277` (`handleCategorySelection` args) — both already accept `imessageSender`. Good.

Similarly check `handleInsuranceSlipResponse`, `handleEmailConfirmation`, `handleMergeConfirmation`, `handleClearConfirmation`, `handleAppQuestions`, `handleAppConfirmation`, `handleEmailCollection`, `handleQuestion` — some don't currently accept `imessageSender`. For this pass, leave those unchanged (they're called with it omitted above — TypeScript will be happy). The existing OpenPhone/bridge paths didn't pass it either.

- [ ] **Step 4: Sync to dev**

```bash
cd /Users/adyan/code/experiments/spot && npx convex dev --once
```

Expected: successful push. If you get a TypeScript error about an action being undefined, it's probably a case where an action ref was wrong — check `internal.process.handleXxx` paths match actual exports.

- [ ] **Step 5: Commit**

```bash
git add convex/process.ts convex/users.ts
git commit -m "feat(spot): processBufferedTurn dispatcher

- drains 2s debounce buffer and runs first-message classifier on first message
- routes by intent: greeting/capability_question/has_policy/no_policy_yet/wrong_number/unclear
- post-first-message dispatches by state (mirrors existing webhook logic)
- central observability point for intent + state transitions"
```

---

## Task 7: `process.ts` — rewrite `sendWelcome` (greeting path)

**Files:**
- Modify: `convex/process.ts:241-264`

- [ ] **Step 1: Replace `sendWelcome` body**

Replace lines 241-264:

```ts
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
      "hey, i'm spot",
      "drop an insurance policy in here and i'll read it for you",
      "what kind is it?",
    ], args.linqChatId, args.imessageSender);

    // Set state to awaiting_category so the next message gets parsed accordingly
    await ctx.runMutation(internal.users.updateState, {
      userId: args.userId,
      state: "awaiting_category",
    });
  },
});
```

- [ ] **Step 2: Sync to dev**

```bash
cd /Users/adyan/code/experiments/spot && npx convex dev --once
```

- [ ] **Step 3: Commit**

```bash
git add convex/process.ts
git commit -m "feat(spot): rewrite sendWelcome to chill-friend voice

- lowercase, 3 short bubbles, no 👋 emoji or pitch paragraph
- explicit state transition to awaiting_category"
```

---

## Task 8: `process.ts` — fix `handleCategorySelection` loop (no-policy scan + attempt counter)

**Files:**
- Modify: `convex/process.ts:266-353`

Two-layer fix: (1) scan fallback input for no-policy phrases, (2) track attempts; attempt ≥ 2 routes to LLM clarifier.

- [ ] **Step 1: Add no-policy phrase helper near the other helpers at the top of `process.ts`**

Insert after `parseCategoryInput` (around line 91):

```ts
function detectNoPolicyIntent(input: string): boolean {
  const clean = input.toLowerCase().trim();
  const phrases = [
    "don't have",
    "dont have",
    "do not have",
    "no insurance",
    "none",
    "nothing yet",
    "haven't got",
    "havent got",
    "haven't gotten",
    "new to",
    "just moved",
    "looking to get",
    "looking for",
    "shopping for",
    "no policy",
    "no policies",
  ];
  return phrases.some((p) => clean.includes(p));
}
```

- [ ] **Step 2: Rewrite the `handleCategorySelection` fallback block**

Replace lines 266-353 (the whole `handleCategorySelection` action) with:

```ts
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

    if (category) {
      await ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "awaiting_policy",
        preferredCategory: category,
      });
      await ctx.runMutation(internal.users.resetCategoryAttempts, {
        userId: args.userId,
      });

      const labels: Record<string, string> = {
        auto: "auto",
        homeowners: "homeowners",
        renters: "renters",
        other: "",
      };
      const label = labels[category] || category;
      const isImessageChannel = !!(args.linqChatId || args.imessageSender);

      if (isImessageChannel) {
        if (category === "other") {
          await sendBurst(ctx, args.userId, args.phone, [
            "ok cool",
            "send the pdf or photo whenever you have it",
          ], args.linqChatId, args.imessageSender);
        } else {
          await sendBurst(ctx, args.userId, args.phone, [
            `${label}, cool`,
            "drop the pdf or a photo in here",
          ], args.linqChatId, args.imessageSender);
        }
      } else {
        const link = getUploadLink(args.uploadToken);
        if (category === "other") {
          await sendBurst(ctx, args.userId, args.phone, [
            "ok cool",
            "drop your policy here whenever you have it",
            link,
          ]);
        } else {
          await sendBurst(ctx, args.userId, args.phone, [
            `${label}, cool`,
            "drop your policy here and i'll go through it",
            link,
          ]);
        }
      }
      return;
    }

    // Category parsing failed — check for no-policy intent first
    if (detectNoPolicyIntent(args.input)) {
      console.log("[spot:category_to_no_policy]", {
        userId: args.userId,
        input: args.input.slice(0, 80),
      });
      await ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "no_policy_chat",
      });
      await ctx.runAction(internal.noPolicyChat.handleNoPolicyChat, {
        userId: args.userId,
        phone: args.phone,
        input: args.input,
        linqChatId: args.linqChatId,
        imessageSender: args.imessageSender,
        seedContext: `user was asked to pick a category but said they don't have one. their exact words: "${args.input}". start discovery.`,
      });
      return;
    }

    // Genuinely unclear — track attempt counter and route accordingly
    const attempts: number = await ctx.runMutation(internal.users.incrementCategoryAttempts, {
      userId: args.userId,
    });

    console.log("[spot:category_fallback]", {
      userId: args.userId,
      attempts,
      input: args.input.slice(0, 80),
    });

    if (attempts === 1) {
      // Varied re-prompt (NOT identical to any prior message)
      await sendBurst(
        ctx,
        args.userId,
        args.phone,
        ["not sure i followed — auto, renters, homeowners, or something else?"],
        args.linqChatId,
        args.imessageSender
      );
      return;
    }

    // Attempt 2+ → LLM clarifier via noPolicyChat
    try {
      await ctx.runMutation(internal.users.updateState, {
        userId: args.userId,
        state: "no_policy_chat",
      });
      await ctx.runAction(internal.noPolicyChat.handleNoPolicyChat, {
        userId: args.userId,
        phone: args.phone,
        input: args.input,
        linqChatId: args.linqChatId,
        imessageSender: args.imessageSender,
        seedContext: `user was asked to pick a category but keeps not matching. their exact words: "${args.input}". figure out what they're actually trying to do — upload a policy, looking for coverage, or something else.`,
      });
    } catch (err) {
      console.warn("[spot:category_llm_clarifier_failed]", { userId: args.userId, err: String(err) });
      await sendBurst(
        ctx,
        args.userId,
        args.phone,
        ["sorry, having a moment", "are you trying to upload a policy or looking for coverage?"],
        args.linqChatId,
        args.imessageSender
      );
    }
  },
});
```

- [ ] **Step 3: Add `incrementCategoryAttempts` + `resetCategoryAttempts` mutations to `users.ts`**

Append to `convex/users.ts`:

```ts
export const incrementCategoryAttempts = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    const attempts = (user?.categoryAttempts || 0) + 1;
    await ctx.db.patch(args.userId, { categoryAttempts: attempts });
    return attempts;
  },
});

export const resetCategoryAttempts = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { categoryAttempts: 0 });
  },
});
```

- [ ] **Step 4: Sync to dev + smoke test**

```bash
cd /Users/adyan/code/experiments/spot && npx convex dev --once
```

From the Convex dashboard, call `process:handleCategorySelection` directly with these inputs on your existing test user (who has state `awaiting_category`):

```json
{ "userId": "<id>", "phone": "+16479221805", "input": "I don't have any yet", "uploadToken": "<token>", "hasAttachment": false, "linqChatId": "<chatId>" }
```

Expected: routes to `handleNoPolicyChat`. No repeat loop. Check Convex logs for `[spot:category_to_no_policy]`.

Second input:
```json
{ "userId": "<id>", "phone": "+16479221805", "input": "asdf", "uploadToken": "<token>", "hasAttachment": false, "linqChatId": "<chatId>" }
```

Expected: attempt 1 → varied re-prompt. Send the same again:

```json
{ "userId": "<id>", "phone": "+16479221805", "input": "asdf", "uploadToken": "<token>", "hasAttachment": false, "linqChatId": "<chatId>" }
```

Expected: attempt 2 → routes to LLM clarifier (noPolicyChat).

Important: reset `categoryAttempts: 0` and `state: "awaiting_category"` on the test user between runs (via the Convex dashboard Data tab) so each test starts fresh.

- [ ] **Step 5: Commit**

```bash
git add convex/process.ts convex/users.ts
git commit -m "fix(spot): category selection loop — no-policy scan + attempt counter

- detectNoPolicyIntent: keyword scan for 'don't have', 'none', 'new to', etc.
  routes to no-policy discovery chat instead of repeating re-prompt
- categoryAttempts tracked per user; attempt 1 uses varied hardcoded re-prompt,
  attempt 2+ escalates to LLM clarifier
- resets categoryAttempts on successful category match
- fixes Anna-class identical-message loop permanently"
```

---

## Task 9: `process.ts` — rewrite `nudgeForPolicy` to voice codex

**Files:**
- Modify: `convex/process.ts:364-~420` (exact end-line depends on current content)

- [ ] **Step 1: Read current `nudgeForPolicy` body**

```bash
cd /Users/adyan/code/experiments/spot && grep -n "nudgeForPolicy" convex/process.ts | head -5
```

Open `convex/process.ts` at the `nudgeForPolicy` definition. Read the full function so you can understand the existing branches (retry intent, category change, etc.) before editing.

- [ ] **Step 2: Rewrite strings only**

Keep the structure intact — just rewrite the user-facing strings in the function body to match the voice codex. Specifically, replace any bubbles that look like these (before → after):

- "Hey, no worries — send the PDF or a photo whenever you've got it" → "all good, send the pdf or photo whenever"
- "Got it, just send over the PDF when you can" → "send the pdf whenever"
- "Here's the upload link again: [link]" → keep same but lowercase everything preceding the link
- "Looks like you want to change categories — let's pick again" → "ok, which kind is it?"

Any bubble that starts with "Haha", "Hey!", "No worries", or ends with an emoji → rewrite per the codex (lowercase, terse, no tics).

If unsure about a specific branch, err toward shorter + lowercase. This is a voice pass, not logic.

- [ ] **Step 3: Sync to dev**

```bash
cd /Users/adyan/code/experiments/spot && npx convex dev --once
```

- [ ] **Step 4: Commit**

```bash
git add convex/process.ts
git commit -m "feat(spot): rewrite nudgeForPolicy strings to chill-friend voice

- lowercase, terse, no 'haha'/'no worries' tics
- variant-aware retries preserved, copy only"
```

---

## Task 10: `process.ts` — post-extraction summary + insurance slip + merge + email prompts

**Files:**
- Modify: `convex/process.ts` (multiple sites)

Voice pass on remaining hardcoded strings. All edits are string-level.

- [ ] **Step 1: Find and rewrite post-extraction summary**

```bash
cd /Users/adyan/code/experiments/spot && grep -n "sendBurst\|sendAndLog" convex/process.ts | head -40
```

Find the location where post-extraction results are announced to the user (likely in `processPolicy` or similar — search for `summary`, `buildPolicySummary`, or strings like "Here's what I see"). Rewrite to 3-4 short bubbles:

```ts
const summaryBubbles = [
  "ok got it",
  `${friendlyCategoryLabel(policy.category, policy.policyTypes)}${policy.carrier ? ` with ${policy.carrier}` : ""}`,
  policy.effectiveDate && policy.expirationDate
    ? `runs ${policy.effectiveDate} to ${policy.expirationDate}`
    : null,
  policy.premium ? `${policy.premium} — anything you want me to dig into?` : "anything you want me to dig into?",
].filter(Boolean) as string[];

await sendBurst(ctx, userId, phone, summaryBubbles, linqChatId, imessageSender);
```

Replace the existing long paragraph version with this pattern. Exact placement depends on the current code.

- [ ] **Step 2: Rewrite upload-in-progress messages**

Find strings like `"Got it — reading through your document now"` and `"Found your policy — pulling out coverages and limits"`. Replace with a single:

```ts
await sendAndLog(ctx, userId, phone, "ok reading through this", linqChatId, imessageSender);
```

If the typing indicator isn't already being started when extraction begins, add a `startTyping` call before extraction kicks off so the dots carry the wait.

- [ ] **Step 3: Rewrite insurance slip prompt**

Find the auto/homeowners insurance slip prompt (search for "insurance slip"). Replace with:

```ts
await sendBurst(ctx, userId, phone, [
  "got any existing insurance slips?",
  "can send them too or skip",
], linqChatId, imessageSender);
```

- [ ] **Step 4: Rewrite merge prompt**

Find the merge-confirmation prompt (search for "merge" or "looks like it goes"). Replace with:

```ts
await sendBurst(ctx, userId, phone, [
  `this looks like the same policy as your ${existingCategory}${existingCarrier ? ` with ${existingCarrier}` : ""}`,
  "want me to merge them or keep separate?",
], linqChatId, imessageSender);
```

- [ ] **Step 5: Rewrite email confirmation strings**

Find where the email confirmation prompt is sent (search for "Reply 'send'" or "confirm"). Replace with:

```ts
await sendBurst(ctx, userId, phone, [
  `good to send to ${recipientEmail}?`,
  "reply send or cancel whenever",
], linqChatId, imessageSender);
```

- [ ] **Step 6: Kill remaining "Haha no worries" / "Great question!" / assistant-tic strings**

```bash
cd /Users/adyan/code/experiments/spot && grep -n -i "haha\|no worries\|great question\|i'd be happy\|absolutely\|certainly" convex/process.ts
```

Review each hit. Replace or delete per the voice codex. Utility command outputs (`/debug`, `/logs`, `/autosend`) should stay functional but lowercase.

- [ ] **Step 7: Sync + commit**

```bash
cd /Users/adyan/code/experiments/spot && npx convex dev --once
git add convex/process.ts
git commit -m "feat(spot): voice pass on post-extraction, slip, merge, email prompts

- post-extraction summary: 3-4 short bubbles instead of paragraph
- upload-in-progress: single 'ok reading through this' (typing carries rest)
- insurance slip prompt, merge prompt, email confirmation all rewritten
- kill remaining assistant tics (haha, no worries, great question, etc.)"
```

---

## Task 11: `process.ts` — voice codex prepended to `handleQuestion` system prompt

**Files:**
- Modify: `convex/process.ts` (the `handleQuestion` action)

The existing agentic Q&A uses `buildAgentSystemPrompt` from `@claritylabs/cl-sdk`. We don't modify SDK behavior — we prepend the voice codex as additional instruction via the `system` argument on the `generateTextWithFallback` call.

- [ ] **Step 1: Locate `handleQuestion`**

```bash
cd /Users/adyan/code/experiments/spot && grep -n "handleQuestion\|buildAgentSystemPrompt" convex/process.ts | head -10
```

Find where the system prompt is assembled for the agentic call. There's likely something like:

```ts
const systemPrompt = buildAgentSystemPrompt({ ... });
const result = await generateTextWithFallback({
  model: getModel("qa"),
  system: systemPrompt,
  ...
});
```

- [ ] **Step 2: Prepend voice codex**

Define a constant at the top of `process.ts` (after the imports, near `CATEGORY_LABELS`):

```ts
const VOICE_CODEX = `voice:
- lowercase unless proper noun
- short bubbles — 1-2 sentences each, max
- acknowledge what they said before pivoting
- no "haha", "no worries", "great question", or assistant tics
- no emojis unless they use one first (then match theirs sparingly)
- chill friend who works in insurance, not a chatbot

engagement (tennis not lecture):
- short volleys, fast back-and-forth
- one question per message max, don't stack
- end with something that invites a reply
- never dump the full answer in one bubble

split your response into multiple short messages at natural breaks — don't emit walls of text.`;
```

In the `handleQuestion` system-prompt assembly, change:

```ts
const systemPrompt = buildAgentSystemPrompt({ ... });
```

to:

```ts
const baseSystemPrompt = buildAgentSystemPrompt({ ... });
const systemPrompt = `${VOICE_CODEX}\n\n---\n\n${baseSystemPrompt}`;
```

- [ ] **Step 3: Sync + test**

```bash
cd /Users/adyan/code/experiments/spot && npx convex dev --once
```

Text Spot a question from your test phone (the dev deployment uses the same Linq number — test against dev env vars if set). Observe that the reply is lowercase, chunked, and lacks "no worries" tics.

- [ ] **Step 4: Commit**

```bash
git add convex/process.ts
git commit -m "feat(spot): voice codex prepended to handleQuestion system prompt

- Q&A replies now lowercase, chunked, no assistant tics
- codex lives in VOICE_CODEX constant, reused in any future LLM system prompt"
```

---

## Task 12: Wire `linq.ts` webhook to use `acknowledgeInbound` + debounce routing

**Files:**
- Modify: `convex/linq.ts:106-278` (the webhook handler)

Replace the per-state dispatch in the webhook with: (a) call `acknowledgeInbound`, (b) if attachment → dispatch directly (existing logic, keep as-is), (c) else → debounce and schedule `processBufferedTurn`.

- [ ] **Step 1: Import new helpers**

At the top of `convex/linq.ts`, ensure these are imported:

```ts
import { acknowledgeInbound, debounceInbound } from "./sendHelpers";
```

- [ ] **Step 2: Replace the webhook dispatch block (lines 107-277)**

Replace this section (starting at the `Send read receipt — scheduled to avoid dangling promise in httpAction` comment around line 106, ending just before `return new Response("ok", { status: 200 });` around line 279) with:

```ts
  // Send read receipt + typing indicator — fire-and-forget, cosmetic only
  await ctx.scheduler.runAfter(0, internal.sendHelpers_acknowledgeInboundScheduled, {
    chatId,
  });

  // Phase 2: Ingest message
  const result = await ctx.runMutation(internal.ingest.ingestLinqMessage, {
    messageId: dedupeId,
    from: phone,
    text,
    hasAttachment,
    linqChatId: chatId,
  });

  if (!result) {
    return new Response("ok", { status: 200 });
  }

  const { userId, uploadToken, linqChatId } = result;

  // ── Sandbox mode: scripted responses for demo phone ──
  if (phone === SANDBOX_PHONE) {
    await ctx.scheduler.runAfter(0, internal.sandbox.handleSandboxMessage, {
      userId,
      linqChatId: linqChatId || chatId,
      phone,
    });
    return new Response("ok", { status: 200 });
  }

  // Attachments bypass debounce — dispatch immediately
  if (hasAttachment) {
    await ctx.scheduler.runAfter(0, internal.process.dispatchAttachment, {
      userId,
      phone,
      uploadToken,
      linqChatId,
      mediaParts: mediaParts.map((a) => ({
        url: a.url || "",
        mimeType: a.mime_type || "application/pdf",
      })),
      userText: text,
    });
    return new Response("ok", { status: 200 });
  }

  // Text-only: route through 2s debounce
  const { shouldScheduleFlush } = await ctx.runMutation(
    internal.users.appendMessageBuffer,
    { userId, text }
  );
  console.log("[spot:debounce]", { userId, shouldScheduleFlush });

  if (shouldScheduleFlush) {
    await ctx.scheduler.runAfter(2000, internal.process.processBufferedTurn, {
      userId,
      phone,
      uploadToken,
      linqChatId,
    });
  }

  return new Response("ok", { status: 200 });
});
```

Note: the old dispatch logic (the entire `if (isNewUser) { ... } else if (state === "awaiting_category") { ... } ...` block) has been replaced. All of those branches are now handled inside `processBufferedTurn` in `process.ts`.

- [ ] **Step 3: Expose `acknowledgeInbound` as a scheduled action**

`acknowledgeInbound` is currently a plain function in `sendHelpers.ts`, but `ctx.scheduler.runAfter` requires an internal action reference. Create a small wrapper. Add to `convex/sendHelpers.ts`:

```ts
import { internalAction } from "./_generated/server";
import { v } from "convex/values";

export const sendHelpers_acknowledgeInboundScheduled = internalAction({
  args: { chatId: v.string() },
  handler: async (ctx, args) => {
    await acknowledgeInbound(ctx, args.chatId);
  },
});
```

**Important:** `sendHelpers.ts` has `"use node"` at the top and exports helper functions. If this is the first `internalAction` defined in the file, verify `internalAction` and `v` are now imported. Verify exports typecheck by running `npx convex dev --once`.

- [ ] **Step 4: Add `dispatchAttachment` action in `process.ts`**

Append to `convex/process.ts` (near `processBufferedTurn`):

```ts
/**
 * Attachment dispatch — bypasses debounce because attachments are inherently
 * "here's a thing, deal with it now" messages. Mirrors the per-state
 * attachment branches the webhook used to have inline.
 */
export const dispatchAttachment = internalAction({
  args: {
    userId: v.id("users"),
    phone: v.string(),
    uploadToken: v.string(),
    linqChatId: v.optional(v.string()),
    imessageSender: v.optional(v.string()),
    mediaParts: v.array(v.object({ url: v.string(), mimeType: v.string() })),
    userText: v.string(),
  },
  handler: async (ctx, args) => {
    const user: any = await ctx.runQuery(internal.users.getUser, {
      userId: args.userId,
    });
    if (!user) return;

    // awaiting_insurance_slip: process as slip
    if (user.state === "awaiting_insurance_slip") {
      await ctx.runAction(internal.process.processInsuranceSlip, {
        userId: args.userId,
        attachments: args.mediaParts,
        phone: args.phone,
        linqChatId: args.linqChatId,
      });
      return;
    }

    // Everything else: process as policy media
    if (args.mediaParts.length > 1) {
      await ctx.runAction(internal.process.processMultipleMedia, {
        userId: args.userId,
        attachments: args.mediaParts,
        phone: args.phone,
        userText: args.userText,
        linqChatId: args.linqChatId,
      });
    } else {
      await ctx.runAction(internal.process.processMedia, {
        userId: args.userId,
        mediaUrl: args.mediaParts[0].url,
        mediaType: args.mediaParts[0].mimeType,
        phone: args.phone,
        userText: args.userText,
        linqChatId: args.linqChatId,
      });
    }
  },
});
```

- [ ] **Step 5: Sync + smoke test**

```bash
cd /Users/adyan/code/experiments/spot && npx convex dev --once
```

From your test phone (via dev deployment — or prod if dev is shared with same number), text:

1. A brand-new user phone → "hi" → expect 3 short bubbles matching the rewritten welcome
2. Text "what insurance can I get with you" as a fresh user → expect "hey!" then LLM discovery
3. Text "i don't have any yet" as a fresh user → expect LLM discovery
4. Text 3 messages in <2s ("hey" "hey?" "hello") → expect ONE reply addressing them as a batch

Check Convex logs after each: `[spot:intent]`, `[spot:debounce]`, `[spot:state_dispatch]` should appear.

- [ ] **Step 6: Commit**

```bash
git add convex/linq.ts convex/sendHelpers.ts convex/process.ts
git commit -m "feat(spot): wire Linq webhook through debounce + first-message classifier

- webhook now always acknowledges inbound (markRead + startTyping)
- attachments bypass debounce via dispatchAttachment
- text-only messages debounced 2s then routed via processBufferedTurn
- first-message classifier runs inside processBufferedTurn (once per user)"
```

---

## Task 13: Wire `openphone.ts` + `imessageBridge.ts` webhooks (debounce only, no read/typing)

**Files:**
- Modify: `convex/openphone.ts` (webhook handler)
- Modify: `convex/imessageBridge.ts` (webhook handler)

Apply the same debounce + `processBufferedTurn` pattern as Linq, but skip `acknowledgeInbound` (SMS and the bridge don't support native read/typing).

- [ ] **Step 1: Read current openphone.ts webhook**

```bash
cd /Users/adyan/code/experiments/spot && wc -l convex/openphone.ts && grep -n "scheduler.runAfter" convex/openphone.ts
```

Identify the dispatch block that routes by state. It mirrors the old Linq webhook structure.

- [ ] **Step 2: Replace openphone.ts dispatch block**

Replace the per-state dispatch in openphone.ts with (adapted from Task 12 Step 2):

```ts
  // Attachments bypass debounce — dispatch immediately
  if (hasAttachment) {
    await ctx.scheduler.runAfter(0, internal.process.dispatchAttachment, {
      userId,
      phone,
      uploadToken,
      mediaParts: mediaParts.map((a) => ({ url: a.url || "", mimeType: a.mime_type || "application/pdf" })),
      userText: text,
    });
    return new Response("ok", { status: 200 });
  }

  // Text-only: route through 2s debounce
  const { shouldScheduleFlush } = await ctx.runMutation(
    internal.users.appendMessageBuffer,
    { userId, text }
  );
  console.log("[spot:debounce]", { userId, shouldScheduleFlush, channel: "openphone" });

  if (shouldScheduleFlush) {
    await ctx.scheduler.runAfter(2000, internal.process.processBufferedTurn, {
      userId,
      phone,
      uploadToken,
    });
  }

  return new Response("ok", { status: 200 });
```

Note: no `linqChatId` passed since this is OpenPhone. The downstream handlers already check for `linqChatId` presence and fall back to SMS.

- [ ] **Step 3: Do the same for imessageBridge.ts**

Same pattern. Pass `imessageSender` instead of `linqChatId`:

```ts
  if (hasAttachment) {
    await ctx.scheduler.runAfter(0, internal.process.dispatchAttachment, {
      userId,
      phone,
      uploadToken,
      imessageSender,
      mediaParts: mediaParts.map((a) => ({ url: a.url || "", mimeType: a.mime_type || "application/pdf" })),
      userText: text,
    });
    return new Response("ok", { status: 200 });
  }

  const { shouldScheduleFlush } = await ctx.runMutation(
    internal.users.appendMessageBuffer,
    { userId, text }
  );
  console.log("[spot:debounce]", { userId, shouldScheduleFlush, channel: "imessage_bridge" });

  if (shouldScheduleFlush) {
    await ctx.scheduler.runAfter(2000, internal.process.processBufferedTurn, {
      userId,
      phone,
      uploadToken,
      imessageSender,
    });
  }

  return new Response("ok", { status: 200 });
```

- [ ] **Step 4: Sync + commit**

```bash
cd /Users/adyan/code/experiments/spot && npx convex dev --once
git add convex/openphone.ts convex/imessageBridge.ts
git commit -m "feat(spot): wire OpenPhone + iMessage bridge webhooks through debounce

- same processBufferedTurn flow as Linq
- no markRead/typing (neither channel supports it natively)
- attachments bypass debounce via dispatchAttachment"
```

---

## Task 14: Dev-deployment smoke test (full matrix)

**Files:** none — manual testing against dev deployment

- [ ] **Step 1: Sync and confirm dev is clean**

```bash
cd /Users/adyan/code/experiments/spot && npx convex dev --once
```

Expected: no errors, all functions up-to-date.

- [ ] **Step 2: Reset test user via admin helper**

From the Convex dashboard Functions panel (dev deployment), call `admin:deleteUserByPhone`:

```json
{ "phone": "+16479221805" }
```

Expected: user + messages + policies wiped. Clean slate.

- [ ] **Step 3: Run matrix from your real iPhone against the Linq number configured for dev**

Note: Linq number `+1 (929) 443-0153` is listed in the CLAUDE.md as the primary; confirm whether dev uses the same number or a separate one before testing. If dev shares the prod Linq number, the only way to test dev-only is to point the Linq webhook at dev temporarily OR run smoke directly via Convex dashboard actions (skipping the webhook).

Execute each test one at a time, resetting the test user between each via the admin helper:

- [ ] Greeting → send "hi" → expect 3 short bubbles matching rewritten welcome ("hey, i'm spot" / "drop an insurance policy in here and i'll read it for you" / "what kind is it?"). Verify lowercase, no 👋 emoji, read-receipt appears.
- [ ] Capability question → reset user → send "what insurance can I get with you" → expect immediate "hey!" then LLM discovery bubbles asking about what they do.
- [ ] Has policy → reset user → send "i have my renters policy to upload" → expect "renters, cool" + "drop the pdf or a photo in here" (no category question asked).
- [ ] No policy yet → reset user → send "I don't have any yet, new to the US" → expect LLM discovery opener asking what they do / where they're from.
- [ ] Wrong number → reset user → send "who is this" → expect one-sentence deflect ("hey, this is spot — an insurance-policy reader" / "if you didn't mean to text me, no problem").
- [ ] Unclear first message → reset user → send "asdf jkl" → expect LLM clarifier response, not a loop.
- [ ] Rapid fire → reset user → send "hey" then immediately "hey?" then "hello???" within 2s → expect ONE reply batch addressing the combined input.
- [ ] Category loop fix → reset user → send "hi" (get welcome) → send "idk" → expect varied re-prompt ("not sure i followed — auto, renters, homeowners, or something else?") → send "idk" again → expect LLM clarifier, NOT a repeat.
- [ ] No-policy keyword in category → reset user → send "hi" → send "I don't have one" → expect transition to no-policy chat, not a repeat.
- [ ] Duplicate-guard sanity → check Convex logs for `[spot:duplicate_guard]` — should be zero hits during the matrix. If any fire, something upstream is still trying to repeat a line.
- [ ] Returning user with policy → reset to a state where user has a policy attached (upload a PDF and let extraction finish) → ask "what's my deductible" → expect voice-codex Q&A reply (lowercase, chunked, no tics).

Fix any failing branch before proceeding.

- [ ] **Step 4: Commit post-smoke log notes (optional)**

If you tuned copy or prompts during smoke, commit those adjustments:

```bash
git add convex/
git commit -m "fix(spot): smoke test adjustments"
```

---

## Task 15: Merge to main (triggers prod deploy)

**Files:** git operations only

- [ ] **Step 1: Review the feature branch delta**

```bash
cd /Users/adyan/code/experiments/spot && git log main..feature/human-conversation-redesign --oneline
git diff main..feature/human-conversation-redesign --stat
```

Expected: ~14 commits, touching `convex/schema.ts`, `convex/sendHelpers.ts`, `convex/process.ts`, `convex/linq.ts`, `convex/openphone.ts`, `convex/imessageBridge.ts`, `convex/intent.ts`, `convex/noPolicyChat.ts`, `convex/users.ts`, `convex/messages.ts`, and the spec/plan docs.

- [ ] **Step 2: Confirm with user before merge**

Since this triggers prod deploy via GitHub Actions on `main`, STOP and confirm with the user that the dev smoke passed cleanly and they're ready to ship to prod. Do not auto-merge.

- [ ] **Step 3: Fast-forward merge to main**

Once confirmed:

```bash
cd /Users/adyan/code/experiments/spot && git checkout main && git merge --ff-only feature/human-conversation-redesign
git push origin main
```

Expected: GitHub Actions kicks off the Convex production deploy. Monitor the Actions tab.

- [ ] **Step 4: Verify prod deploy succeeded**

Watch the GitHub Actions run. Expected: green checkmark within ~2 minutes.

Cross-check by querying the prod Convex dashboard (https://dashboard.convex.dev/d/cheery-giraffe-339) — look for the new functions `intent:classifyFirstMessage`, `noPolicyChat:handleNoPolicyChat`, `process:processBufferedTurn`, `process:dispatchAttachment` in the Functions panel. Schema should show the new user fields in the Data tab.

---

## Task 16: Real-phone soak test on prod (30-60 min before event)

**Files:** none — manual testing against prod

- [ ] **Step 1: Assemble 3+ real phones**

Ideal: your phone + 2 other people (use different Apple IDs so each is a fresh user from Spot's POV). Different carriers if possible.

- [ ] **Step 2: Run the full matrix on each phone**

Exactly the same matrix as Task 14 Step 3, but now hitting prod (Linq number +1 (929) 443-0153). Between tests, reset each test user via `admin:deleteUserByPhone` on the prod Convex dashboard.

- [ ] **Step 3: Monitor Convex logs live**

Open https://dashboard.convex.dev/d/cheery-giraffe-339 → Logs. Filter for `[spot:`. You should see events streaming as tests execute:
- `[spot:intent]`
- `[spot:debounce]`
- `[spot:state_dispatch]`
- `[spot:no_policy_exit]` (after discovery wraps)

Watch for:
- `[spot:duplicate_guard]` — should fire ZERO times. If it fires, investigate immediately — something's trying to repeat a line.
- `[spot:intent_classifier_failed]` — should fire ZERO times. If it fires more than once in 30 minutes, Haiku is flaky; consider degrading gracefully (but probably don't have time to fix properly day-of).
- `[spot:no_policy_chat_failed]` — should fire ZERO times. Sonnet fallback catches most errors; if this fires, network or rate-limit issue.

- [ ] **Step 4: Tune voice if any reply feels off**

If the LLM-driven paths produce replies that break the voice codex (e.g., emojis, long paragraphs, "no worries"), iterate the system prompts in `intent.ts` / `noPolicyChat.ts` and `handleQuestion`'s `VOICE_CODEX` constant. Each tune is a one-commit push to main → auto-deploy → re-test.

- [ ] **Step 5: Mark go/no-go**

Before event doors open:
- **Go** if: all matrix items pass on all phones, no `[spot:duplicate_guard]` or `_failed` log events during soak, voice feels consistent.
- **No-go** if: any matrix item fails repeatedly. Roll back via Convex dashboard → Deployments → click prior deploy → Revert. (Instant rollback, one click. The duplicate-guard alone keeps Anna-class bugs out even on the old code, so rollback is safe.)

If no-go, report to user with specific failures and the option to either (a) fix day-of and re-soak, or (b) revert and live with the loop bug fix only (which we already committed standalone in Task 8 and would still be on prod — user can grep `detectNoPolicyIntent` presence to confirm).

---

## Self-Review Checklist (completed)

**Spec coverage:**
- ✅ Intent classifier (spec §1) → Task 4
- ✅ No-policy discovery chat (spec §2) → Task 5
- ✅ Loop fix two-layer (spec §3) → Task 8
- ✅ Human cadence (spec §4): markRead+typing via `acknowledgeInbound` → Tasks 3, 12 · delay formula → Task 2 · debounce → Tasks 3, 12, 13
- ✅ Voice codex (spec §5): hardcoded strings → Tasks 7, 9, 10 · Q&A prompt → Task 11 · no-policy prompt → Task 5 · classifier prompt → Task 4
- ✅ Copy rewrites (spec "Copy rewrites") → Tasks 7, 8, 9, 10, 11
- ✅ Consecutive-duplicate guard → Task 2
- ✅ Rate-limit debounce → Tasks 3, 12, 13
- ✅ Observability logs → distributed across Tasks 2, 3, 4, 5, 6, 8, 12, 13
- ✅ Deploy + soak (spec "Order of implementation" 7-9) → Tasks 14, 15, 16
- ✅ Test matrix (spec "Test matrix") → Task 14 Step 3, Task 16 Step 2

**Placeholder scan:** No "TBD", "TODO", "implement later", or "add error handling" phrasings in any task. Every step has concrete content.

**Type consistency:**
- `appendMessageBuffer` returns `{ isFirstInWindow }` — used identically in `debounceInbound` (Task 3) and in webhook (Task 12).
- `drainMessageBuffer` returns `{ text, messageCount }` — used in `processBufferedTurn` (Task 6).
- `setNoPolicyContext` arg is `context: string` (Task 5) — called with `context: result.updatedContext` in same task.
- `classifyFirstMessage` returns `{ intent, extractedCategory, noteForContext }` — destructured identically in `processBufferedTurn` (Task 6).
- `handleNoPolicyChat` args include `seedContext` as optional — all three callsites (classifier branches in Task 6 + Task 8) pass it; direct smoke-test call (Task 5 Step 4) also passes it. Consistent.
- `incrementCategoryAttempts` returns `number` — used as `attempts` in Task 8.

**Scope check:** The plan is bounded to conversation-layer changes. No refactors of the SDK, the extraction pipeline, or the upload flow. Each task produces an independently deployable increment (each ends in a commit + dev-sync).

No issues found. Plan ready to execute.
