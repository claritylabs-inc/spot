# SMS Experiment — Clarity Labs Consumer PoC

## What This Is

A messaging-first insurance policy vault. Users text a phone number (via iMessage, RCS, or SMS), send their insurance policy PDFs, and an AI assistant ("Spot") parses the document using the Clarity Labs SDK, stores structured data, and answers coverage questions — all over text. No app, no login, no dashboard.

**Brand name:** Spot
**Parent company:** Clarity Labs (claritylabs.inc)
**Convex prod deployment:** `cool-leopard-641` (team: claritylabs)
**Convex dev deployment:** `kindhearted-labrador-258`
**Convex dashboard:** https://dashboard.convex.dev/d/cool-leopard-641

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend / DB | Convex (TypeScript, serverless, real-time) |
| Messaging (primary) | Linq API v3 — iMessage, RCS, SMS via single API |
| Messaging (fallback) | OpenPhone API — SMS only |
| Document AI | `@claritylabs/cl-sdk` (classify, extract, enrich, agent prompts) |
| LLM | `@ai-sdk/anthropic` (Claude claude-sonnet-4-6 via Vercel AI SDK) |
| Frontend | Next.js 15 + React 19 (upload page + redirect) |
| PDF parsing | `pdf-lib` |

---

## Messaging Channels

Spot supports two messaging channels. **Linq is primary**, OpenPhone is fallback.

| Channel | Provider | Number | Protocol | Status |
|---------|----------|--------|----------|--------|
| **Linq** | linqapp.com | +1 (347) 307-4526 | iMessage / RCS / SMS | Active (primary) |
| **OpenPhone** | openphone.com | +1 (289) 212-7916 (CA) | SMS only | Active (fallback) |
| **OpenPhone** | openphone.com | +1 (929) 642-1213 (US) | SMS only | Pending A2P registration |

### Channel routing logic (`sendAndLog` in `process.ts`)

1. If user has a `linqChatId` → send via Linq API
2. If Linq fails → fall back to OpenPhone SMS
3. If no `linqChatId` (legacy/OpenPhone user) → send via OpenPhone directly
4. Log which channel was actually used on each message record

### Linq-specific behavior

- **Typing indicators** — Linq supports typing bubbles. Used during PDF extraction wait instead of "Got it, one sec" text.
- **No character limit** — iMessage has no practical limit. `maxOutputTokens` is 800 for Linq users vs 400 for OpenPhone (SMS).
- **PDF via iMessage** — Linq users are asked to send PDFs directly in conversation first, with web upload as backup.
- **Retry recognition** — `nudgeForPolicy` recognizes "try again" / "retry" / "resend" intent and re-prompts for the PDF.

---

## Project Structure

```
sms-experiment/
├── convex/                     # All backend logic (Convex functions)
│   ├── schema.ts               # Database schema (users, policies, messages, webhookLocks)
│   ├── http.ts                 # HTTP router — /openphone/webhook + /linq/webhook
│   ├── openphone.ts            # OpenPhone webhook handler (SMS inbound)
│   ├── linq.ts                 # Linq webhook handler (iMessage/RCS/SMS inbound)
│   ├── ingest.ts               # Dedup (claimWebhook) + user creation + message logging
│   ├── process.ts              # Core logic — welcome, categories, extraction, Q&A
│   ├── send.ts                 # OpenPhone outbound SMS wrapper
│   ├── sendLinq.ts             # Linq outbound — send message, create chat, typing indicators
│   ├── messages.ts             # Message CRUD (log, claim, query)
│   ├── users.ts                # User CRUD + upload token + public mutations for upload page
│   ├── policies.ts             # Policy CRUD (create, updateExtracted, getByUser)
│   ├── upload.ts               # Web upload flow — processes PDFs uploaded via the upload page
│   ├── admin.ts                # Admin utilities (deleteUserByPhone for testing)
│   ├── convex.config.ts        # Convex app config (empty, no components)
│   └── _generated/             # Auto-generated Convex types and API
├── src/
│   └── app/
│       ├── layout.tsx          # Root layout — Geist + Instrument Serif fonts, ConvexProvider
│       ├── providers.tsx       # ConvexReactClient provider
│       ├── page.tsx            # Root page — redirects to claritylabs.inc
│       ├── not-found.tsx       # 404 page — branded, links back to claritylabs.inc
│       └── upload/[userId]/    # Upload page — token-gated PDF upload via drag-and-drop
│           └── page.tsx
├── PRD.md                      # Original product requirements document
├── package.json
├── convex.json
├── next.config.ts
└── tsconfig.json
```

---

## Database Schema (Convex)

### `users`
| Field | Type | Description |
|-------|------|-------------|
| phone | string | E.164 phone number (indexed, unique identifier) |
| name | string? | User-provided name |
| state | string? | Conversation state: `"awaiting_category"`, `"awaiting_policy"`, `"active"` |
| preferredCategory | string? | `"auto"`, `"tenant"`, or `"other"` |
| uploadToken | string? | 24-char random token for the web upload page (indexed) |
| linqChatId | string? | Linq chat ID for ongoing conversation (indexed by `by_linq_chat_id`) |
| lastActiveAt | number | Last message timestamp |
| createdAt | number | Signup timestamp |

### `policies`
| Field | Type | Description |
|-------|------|-------------|
| userId | Id\<"users"\> | Owner (indexed) |
| category | `"auto"` \| `"tenant"` \| `"other"` | Detected or user-specified category |
| documentType | `"policy"` \| `"quote"` | From CL SDK classification |
| carrier | string? | Extracted carrier name |
| policyNumber | string? | Extracted policy number |
| effectiveDate | string? | Coverage start date |
| expirationDate | string? | Coverage end date |
| premium | string? | Premium amount |
| insuredName | string? | Name of insured party |
| summary | string? | AI-generated plain-English summary |
| coverages | any? | Array of coverage objects from CL SDK |
| rawExtracted | any? | Full CL SDK extraction output |
| pdfStorageId | Id\<"_storage"\>? | Convex file storage reference for the raw PDF |
| status | `"processing"` \| `"ready"` \| `"failed"` | Extraction pipeline status |
| createdAt | number | Timestamp |

### `messages`
| Field | Type | Description |
|-------|------|-------------|
| userId | Id\<"users"\> | Owner (indexed) |
| direction | `"inbound"` \| `"outbound"` | Message direction |
| body | string | Message text |
| hasAttachment | boolean | Whether MMS had a file |
| openPhoneId | string? | Message ID from any channel (indexed, used for dedup) |
| channel | string? | `"openphone"` \| `"linq"` — which channel the message was sent/received on |
| timestamp | number | When sent/received |

### `webhookLocks`
| Field | Type | Description |
|-------|------|-------------|
| openPhoneId | string | Message ID from any channel (indexed, used for dedup) |
| processedAt | number | When the webhook was claimed |

---

## Core Flows

### Flow 1: First Contact (New User)
1. User texts anything to a Spot number (Linq or OpenPhone)
2. Webhook fires: Linq → `POST /linq/webhook` or OpenPhone → `POST /openphone/webhook`
3. Handler extracts sender phone, text, media, message ID, and (for Linq) chat ID
4. `ingest.claimWebhook` — atomic dedup via `webhookLocks` table
5. `ingest.ingestMessage` / `ingest.ingestLinqMessage` — no user found → creates user with `state: "awaiting_category"`, generates `uploadToken`, stores `linqChatId` if Linq
6. Schedules `process.sendWelcome` → sends 3-message burst via appropriate channel

### Flow 2: Category Selection (`state: "awaiting_category"`)
1. User replies with category (e.g., "auto", "renters", "1", "2", "3")
2. `process.handleCategorySelection` parses input via keyword/number matching
3. Updates user state to `"awaiting_policy"` with `preferredCategory`
4. Linq users: asked to send PDF directly via iMessage. OpenPhone users: sent web upload link
5. If user sends an attachment instead of text, skips to policy processing

### Flow 3: Policy Upload (message attachment)
1. User sends a PDF via iMessage/MMS while in `"awaiting_policy"` or `"active"` state
2. `process.processPolicy` — parallelized pipeline:
   - **Step 1** (parallel): Ack message ("Got it — reading through your document now") + PDF download
   - **Step 2** (parallel): Storage upload + `classifyDocumentType` + optimistic `extractFromPdf`
   - **Step 3** (parallel): Create policy record + progress message + typing indicator + (if quote) `extractQuoteFromPdf`
   - **Step 4** (parallel): `updateExtracted` + `updateState` + stop typing
   - **Step 5**: Send summary burst via appropriate channel

### Flow 4: Policy Upload (Web — upload page)
1. User visits `{baseUrl}/upload/{uploadToken}`
2. Upload page verifies token via `users.getByUploadToken` (public query, masks phone number)
3. User drags/drops or selects a PDF (max 20MB)
4. Client: `users.generateUploadUrl` → uploads to Convex storage → `users.submitPolicy`
5. `upload.processUploadedPolicy` — same parallelized extraction pipeline
6. Sends summary to user via their channel (Linq if they have `linqChatId`, else OpenPhone)

### Flow 5: Conversational Q&A (`state: "active"`)
1. User texts a question (no attachment)
2. `process.handleQuestion`:
   - Loads all `"ready"` policies for user
   - If no policies → sends upload link
   - Builds system prompt via `buildAgentSystemPrompt({ platform: "sms", intent: "direct", companyName: "Spot" })`
   - Adds compliance guardrails (no selling, no legal/financial advice, natural texting tone)
   - Builds document context from `rawExtracted` via `buildDocumentContext`
   - Calls Claude claude-sonnet-4-6 via Vercel AI SDK (`generateText`)
   - Linq: `maxOutputTokens: 800`, no truncation. OpenPhone: `maxOutputTokens: 400`, truncated to 1,550 chars
   - Sends reply via appropriate channel

### Nudge Flow (text message while `"awaiting_policy"`)
- Recognizes retry intent ("try again", "retry", "resend") and re-prompts for PDF
- Checks if it's a category change
- Linq users: nudged to send PDF directly + web upload backup. OpenPhone: web upload link

---

## Phone Numbers

| Number | Provider | Status |
|--------|----------|--------|
| +1 (347) 307-4526 | Linq | Active — iMessage/RCS/SMS (primary) |
| +1 (289) 212-7916 | OpenPhone (CA) | Active — SMS fallback |
| +1 (929) 642-1213 | OpenPhone (US) | Pending A2P registration |

---

## Environment Variables (Convex)

All env vars are set in the Convex dashboard, not locally. Use `--deployment kindhearted-labrador-258` for dev.

| Variable | Description |
|----------|-------------|
| `LINQ_API_KEY` | Linq Partner API v3 key |
| `LINQ_WEBHOOK_SECRET` | HMAC-SHA256 signing secret for Linq webhook verification |
| `LINQ_PHONE_NUMBER` | Linq phone number (`+13473074526`) — used as `from` when creating chats |
| `OPENPHONE_API_KEY` | OpenPhone API key |
| `OPENPHONE_PHONE_NUMBER_ID` | Phone number ID to send from (currently `PN3iSAb7ZR`) |
| `OPENPHONE_WEBHOOK_SECRET` | Webhook signature verification (not currently validated in code) |
| `ANTHROPIC_API_KEY` | Claude API key for CL SDK + Q&A |

The Next.js frontend needs `NEXT_PUBLIC_CONVEX_URL` in `.env.local` (set automatically by `npx convex dev`).

`NEXT_PUBLIC_APP_URL` controls the base URL for upload links (defaults to `https://secure.claritylabs.inc`).

---

## Development

```bash
# Run Convex backend (watches for changes, syncs to cloud)
npm run dev

# Run Next.js frontend (upload page)
npm run dev:frontend

# Run both concurrently
npm run dev:all
```

There is no local Convex — `npm run dev` syncs to the cloud dev deployment (`kindhearted-labrador-258`).

### Testing the messaging flow
1. **Linq (primary):** Text anything to (347) 307-4526 via iMessage
2. **OpenPhone (fallback):** Text anything to (289) 212-7916
3. Follow the conversation (category → upload → ask questions)
4. Test phone: Adyan's number 6479221805

### Resetting a test user
Run in the Convex dashboard or via `npx convex run`:
```bash
npx convex run admin:deleteUserByPhone '{"phone": "+16479221805"}'
```
This deletes the user, all their messages, and all their policies.

---

## Key Design Decisions

1. **Multi-channel with Linq-first routing** — `sendAndLog` tries Linq (if `linqChatId` exists), falls back to OpenPhone on failure, logs which channel was used. New users arriving via Linq get `linqChatId` stored on first contact.

2. **Webhook dedup via `webhookLocks` table** — Both OpenPhone and Linq can fire duplicate webhooks. `claimWebhook` is an atomic Convex mutation that prevents double-processing. Linq dedup keys are prefixed `linq_`.

3. **Linq webhook HMAC verification** — `linq.ts` verifies `X-Webhook-Signature` using HMAC-SHA256. Secret is raw UTF-8 (not base64-decoded), payload is `{timestamp}.{rawBody}`, output is hex with no prefix.

4. **Parallelized extraction pipeline** — `processPolicy` runs classification + optimistic policy extraction + storage upload in parallel via `Promise.all`. For the common policy case, extraction is already done when classification finishes. Quotes require a second extraction call.

5. **Progress messages during extraction** — Users get intermediate updates ("Got it — reading through your document now", "Found your policy — pulling out coverages and limits") so they know the pipeline is working. Linq users also get typing indicators.

6. **All processing is scheduled via `ctx.scheduler.runAfter(0, ...)`** — Webhook handlers return 200 immediately, then processing happens async. This avoids webhook timeouts.

7. **`sendBurst` pattern** — Multi-message responses are sent with 0.8–1.5s random delays between messages to feel like a real person texting.

8. **Upload tokens instead of auth** — No login system. Each user gets a random 24-char token embedded in their upload URL. The upload page masks the phone number for privacy.

9. **State machine on `users.state`** — Controls conversation routing:
   - `awaiting_category` → expects category input
   - `awaiting_policy` → expects PDF attachment or sends upload link
   - `active` → handles Q&A, also accepts new policy uploads

10. **Compliance guardrails in system prompt** — Spot doesn't sell, recommend, or give legal/financial advice. Keeps responses to policy explanation only.

11. **Two upload paths** — iMessage/MMS (direct in conversation) and web (upload page link). Both converge to the same parallelized extraction pipeline. Web upload exists as backup for large PDFs.

---

## CL SDK Usage

The Clarity Labs SDK (`@claritylabs/cl-sdk`) is the core intelligence layer:

| Function | Used In | Purpose |
|----------|---------|---------|
| `classifyDocumentType` | `process.ts`, `upload.ts` | Determines if PDF is a policy or quote |
| `extractFromPdf` | `process.ts`, `upload.ts` | Extracts structured data from policy PDFs |
| `extractQuoteFromPdf` | `process.ts`, `upload.ts` | Extracts structured data from quote PDFs |
| `applyExtracted` | `process.ts`, `upload.ts` | Normalizes policy extraction into standard fields |
| `applyExtractedQuote` | `process.ts`, `upload.ts` | Normalizes quote extraction into standard fields |
| `buildAgentSystemPrompt` | `process.ts` | Generates system prompt tuned for SMS + direct intent |
| `buildDocumentContext` | `process.ts` | Builds document context string from extracted policy data |

---

## Frontend (Next.js)

Minimal — exists primarily for the upload page:

- **`/`** — Redirects to `https://claritylabs.inc`
- **`/upload/[token]`** — Token-gated PDF upload page (drag-and-drop, mobile-friendly)
- **`/404`** — Branded 404 page

Design follows the Clarity Labs design system: `#faf8f4` background, Instrument Serif headings, Geist body, `#111827` dark accents, `#8a8578` muted text.

---

## What's NOT Built (Intentionally)

- No dashboard (OpenPhone + Convex dashboard used directly)
- No web upload portal beyond the token-gated page
- No auth flows (tokens only)
- No thread management (SMS is single-threaded per number)
- No commercial lines support
- No OpenPhone webhook signature verification (OPENPHONE_WEBHOOK_SECRET exists but isn't checked; Linq signatures ARE verified)
- No rate limiting or spam protection
