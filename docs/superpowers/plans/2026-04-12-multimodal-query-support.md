# Multimodal Query Support via cl-sdk 0.12.0

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade cl-sdk to 0.12.0 and wire SMS image attachments through the SDK's new multimodal query agent for grounded, citation-backed answers.

**Architecture:** When `handleQuestion` receives an image, call the SDK query agent with the image as a `QueryAttachment` to get structured interpretation (facts, evidence). Inject that interpretation into the existing tool-calling `generateText` loop as additional system prompt context. The model still sees the raw image too — the SDK interpretation is additive context, not a replacement.

**Tech Stack:** `@claritylabs/cl-sdk` 0.12.0, Convex, Vercel AI SDK

---

### Task 1: Bump cl-sdk to 0.12.0

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update package.json**

Change the cl-sdk dependency version:

```json
"@claritylabs/cl-sdk": "^0.12.0"
```

- [ ] **Step 2: Install and verify**

Run: `npm install`
Expected: clean install, no peer dep warnings related to cl-sdk

- [ ] **Step 3: Verify type compatibility**

Run: `npx tsc --noEmit`
Expected: no new type errors (0.12.0 is additive — `attachments` is optional on `QueryInput`)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: update @claritylabs/cl-sdk to ^0.12.0 for multimodal query support"
```

---

### Task 2: Add `lastImageMimeType` to users schema and mutation

**Files:**
- Modify: `convex/schema.ts:14` (users table)
- Modify: `convex/users.ts:96-104` (updateLastImageId mutation)

- [ ] **Step 1: Add field to schema**

In `convex/schema.ts`, add `lastImageMimeType` right after `lastImageId`:

```typescript
lastImageId: v.optional(v.id("_storage")), // most recent image for contextual vision Q&A
lastImageMimeType: v.optional(v.string()), // MIME type of lastImageId (e.g. "image/jpeg", "image/png")
```

- [ ] **Step 2: Update mutation to accept and store mimeType**

In `convex/users.ts`, update `updateLastImageId`:

```typescript
export const updateLastImageId = internalMutation({
  args: {
    userId: v.id("users"),
    lastImageId: v.id("_storage"),
    lastImageMimeType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      lastImageId: args.lastImageId,
      ...(args.lastImageMimeType ? { lastImageMimeType: args.lastImageMimeType } : {}),
    });
  },
});
```

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: PASS (no errors)

- [ ] **Step 4: Commit**

```bash
git add convex/schema.ts convex/users.ts
git commit -m "feat: add lastImageMimeType field to users for multimodal query support"
```

---

### Task 3: Pass mimeType through processMedia and processMultipleMedia

**Files:**
- Modify: `convex/process.ts:319-326` (processMedia — single image storage + updateLastImageId calls)
- Modify: `convex/process.ts:359-368` (processMedia — handleQuestion call for contextual images)
- Modify: `convex/process.ts:416-423` (processMultipleMedia — single image updateLastImageId call)
- Modify: `convex/process.ts:447-456` (processMultipleMedia — handleQuestion call for contextual images)

- [ ] **Step 1: Pass mimeType when storing lastImageId in processMedia**

In `convex/process.ts` around line 323, update the `updateLastImageId` call:

```typescript
await ctx.runMutation(internal.users.updateLastImageId, {
  userId: args.userId,
  lastImageId: storageId,
  lastImageMimeType: args.mediaType,
});
```

- [ ] **Step 2: Pass imageMimeType when routing to handleQuestion in processMedia**

In `convex/process.ts` around line 361, add `imageMimeType` to the handleQuestion call:

```typescript
await ctx.runAction(internal.process.handleQuestion, {
  userId: args.userId,
  question: args.userText || "What can you tell me about this image?",
  phone: args.phone,
  uploadToken: user?.uploadToken || "",
  linqChatId: args.linqChatId,
  imageStorageId: storageId,
  imageMimeType: args.mediaType,
});
```

- [ ] **Step 3: Pass mimeType when storing lastImageId in processMultipleMedia**

In `convex/process.ts` around line 420, update the `updateLastImageId` call:

```typescript
await ctx.runMutation(internal.users.updateLastImageId, {
  userId: args.userId,
  lastImageId: storageId,
  lastImageMimeType: d.mimeType,
});
```

- [ ] **Step 4: Pass imageMimeType when routing to handleQuestion in processMultipleMedia**

In `convex/process.ts` around line 449, add `imageMimeType`:

```typescript
await ctx.runAction(internal.process.handleQuestion, {
  userId: args.userId,
  question: args.userText || "What can you tell me about this image?",
  phone: args.phone,
  uploadToken: user?.uploadToken || "",
  linqChatId: args.linqChatId,
  imageStorageId: storageId,
  imageMimeType: d.mimeType,
});
```

- [ ] **Step 5: Verify types**

Run: `npx tsc --noEmit`
Expected: will fail because `handleQuestion` doesn't accept `imageMimeType` yet — that's Task 4

- [ ] **Step 6: Commit**

```bash
git add convex/process.ts
git commit -m "feat: pass image mimeType through processMedia to handleQuestion"
```

---

### Task 4: Add imageMimeType arg and SDK query agent call to handleQuestion

**Files:**
- Modify: `convex/process.ts:1824-1832` (handleQuestion args)
- Modify: `convex/process.ts:2181-2199` (image loading and user content building)
- Modify: `convex/sdkAdapter.ts` (import QueryAttachment type)

This is the core change. When `handleQuestion` has an image, call the SDK query agent with the image as a `QueryAttachment`, then inject the SDK's answer into the system prompt.

- [ ] **Step 1: Import QueryAttachment type in sdkAdapter.ts**

In `convex/sdkAdapter.ts`, add `QueryAttachment` to the cl-sdk import:

```typescript
import {
  createExtractor,
  createQueryAgent,
  createApplicationPipeline,
  sanitizeNulls,
  type GenerateText,
  type GenerateObject,
  type EmbedText,
  type InsuranceDocument,
  type DocumentChunk,
  type DocumentStore,
  type MemoryStore,
  type ConversationTurn,
  type ChunkFilter,
  type DocumentFilters,
  type QueryAttachment,
} from "@claritylabs/cl-sdk";
```

- [ ] **Step 2: Export QueryAttachment from sdkAdapter.ts**

Add a re-export at the bottom of the imports section or as a named export:

```typescript
export type { QueryAttachment };
```

- [ ] **Step 3: Add imageMimeType arg to handleQuestion**

In `convex/process.ts`, update the `handleQuestion` args (around line 1825-1832):

```typescript
export const handleQuestion = internalAction({
  args: {
    userId: v.id("users"),
    question: v.string(),
    phone: v.string(),
    uploadToken: v.string(),
    linqChatId: v.optional(v.string()),
    imessageSender: v.optional(v.string()),
    imageStorageId: v.optional(v.id("_storage")),
    imageMimeType: v.optional(v.string()),
  },
```

- [ ] **Step 4: Add SDK query agent call when image is present**

In `handleQuestion`, after loading the image from storage (around line 2183-2197) and before building `userContent`, add the SDK query agent interpretation. Replace the image loading block with:

```typescript
      // Build the final user message content (may include image)
      const userContent: any[] = [];
      let attachmentAnalysis = "";

      const imageId = args.imageStorageId || user?.lastImageId;
      const imageMime = args.imageMimeType || user?.lastImageMimeType || "image/jpeg";
      if (imageId) {
        try {
          const imageBlob = await ctx.storage.get(imageId);
          if (imageBlob) {
            const imageBuffer = await imageBlob.arrayBuffer();
            const imageBase64 = Buffer.from(imageBuffer).toString("base64");

            // Add raw image to user message for the model to see
            userContent.push({
              type: "image",
              image: imageBase64,
              mediaType: imageMime,
            });

            // Use SDK query agent to interpret the attachment with policy context
            try {
              const queryAgent = getQueryAgent(ctx, args.userId);
              const queryResult = await queryAgent.query({
                question: args.question,
                attachments: [{
                  kind: "image",
                  name: "user-photo",
                  mimeType: imageMime,
                  base64: imageBase64,
                }],
              });
              if (queryResult.answer) {
                attachmentAnalysis = `\n\nATTACHMENT ANALYSIS (from document intelligence):\n${queryResult.answer}`;
                if (queryResult.citations && queryResult.citations.length > 0) {
                  const citationNotes = queryResult.citations
                    .map((c: any) => `[${c.field || c.documentType || "doc"}]: "${c.quote}"`)
                    .join("\n");
                  attachmentAnalysis += `\n\nRelevant policy excerpts:\n${citationNotes}`;
                }
              }
            } catch (sdkErr) {
              console.warn("SDK query agent attachment interpretation failed, continuing without:", sdkErr);
              // Non-fatal — the model still sees the raw image
            }
          }
        } catch (_) {}
      }

      userContent.push({ type: "text", text: args.question });
```

- [ ] **Step 5: Inject attachment analysis into system prompt**

In the `generateTextWithFallback` call (around line 2260), append `attachmentAnalysis` to the system prompt. Find the system prompt string and add:

Change:
```typescript
system: `${complianceGuardrails}\n\n${sdkPrompt}\n\nHere are the user's insurance documents:\n${documentContext}\n\nUser's email on file: ${user?.email || "none"}\nUser's name: ${user?.name || "Unknown"}${memoryBlock}${analysisNote}${pendingEmailNote}${contactsNote}${appNote}`,
```

To:
```typescript
system: `${complianceGuardrails}\n\n${sdkPrompt}\n\nHere are the user's insurance documents:\n${documentContext}${attachmentAnalysis}\n\nUser's email on file: ${user?.email || "none"}\nUser's name: ${user?.name || "Unknown"}${memoryBlock}${analysisNote}${pendingEmailNote}${contactsNote}${appNote}`,
```

- [ ] **Step 6: Verify types compile**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add convex/process.ts convex/sdkAdapter.ts
git commit -m "feat: use SDK query agent for multimodal image interpretation in handleQuestion"
```

---

### Task 5: Verify end-to-end and clean up

**Files:**
- Check: `convex/process.ts`, `convex/sdkAdapter.ts`, `convex/schema.ts`, `convex/users.ts`

- [ ] **Step 1: Full type check**

Run: `npx tsc --noEmit`
Expected: PASS — zero errors

- [ ] **Step 2: Verify Convex can push schema**

Run: `npx convex dev --once --dry-run` (or just `npx convex dev` briefly)
Expected: schema validates, functions compile

- [ ] **Step 3: Verify no unused imports**

Check that `QueryAttachment` is used (it's used as a type in the `getQueryAgent` call), and that no old imports were left dangling.

- [ ] **Step 4: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore: verify multimodal query support integration"
```
