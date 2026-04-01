# SMS Experiment — Clarity Labs Consumer PoC

## What This Is

An SMS-first insurance policy vault. Users text a phone number, send their insurance policy PDFs, and an AI assistant ("Spot") parses the document using the Clarity Labs SDK, stores structured data, and answers coverage questions — all over text. No app, no login, no dashboard.

**Brand name:** Spot
**Parent company:** Clarity Labs (claritylabs.inc)
**Convex deployment:** `cool-leopard-641` (team: claritylabs)
**Convex dashboard:** https://dashboard.convex.dev/d/cool-leopard-641

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend / DB | Convex (TypeScript, serverless, real-time) |
| SMS Provider | OpenPhone API (inbound webhooks + outbound messages) |
| Document AI | `@claritylabs/cl-sdk` (classify, extract, enrich, agent prompts) |
| LLM | `@ai-sdk/anthropic` (Claude claude-sonnet-4-6 via Vercel AI SDK) |
| Frontend | Next.js 15 + React 19 (upload page + redirect) |
| PDF parsing | `pdf-lib` |

---

## Project Structure

```
sms-experiment/
├── convex/                     # All backend logic (Convex functions)
│   ├── schema.ts               # Database schema (users, policies, messages, webhookLocks)
│   ├── http.ts                 # HTTP router — single route: POST /openphone/webhook
│   ├── openphone.ts            # Webhook handler — entry point for all inbound SMS/MMS
│   ├── ingest.ts               # Dedup (claimWebhook) + user creation + message logging
│   ├── process.ts              # Core logic — welcome flow, category selection, policy extraction, Q&A
│   ├── send.ts                 # OpenPhone outbound SMS wrapper
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
| state | string? | Conversation state: `"new"`, `"awaiting_category"`, `"awaiting_policy"`, `"active"` |
| preferredCategory | string? | `"auto"`, `"tenant"`, or `"other"` |
| uploadToken | string? | 24-char random token for the web upload page (indexed) |
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
| openPhoneId | string? | OpenPhone message ID (indexed, used for dedup) |
| timestamp | number | When sent/received |

### `webhookLocks`
| Field | Type | Description |
|-------|------|-------------|
| openPhoneId | string | OpenPhone message ID (indexed) |
| processedAt | number | When the webhook was claimed |

---

## Core Flows

### Flow 1: First Contact (New User)
1. User texts anything to the Spot number
2. OpenPhone fires `message.received` webhook to `POST /openphone/webhook`
3. `openphone.ts` extracts `from`, `text`, `media`, `messageId`
4. `ingest.claimWebhook` — atomic dedup via `webhookLocks` table
5. `ingest.ingestMessage` — no user found for phone → creates user with `state: "awaiting_category"` and generates `uploadToken`
6. Schedules `process.sendWelcome` → sends 3-message burst:
   - "Hey! This is Spot"
   - "I can go through your insurance policy and tell you exactly what you're covered for"
   - "Is it auto, renters, or something else?"

### Flow 2: Category Selection (`state: "awaiting_category"`)
1. User replies with category (e.g., "auto", "renters", "1", "2", "3")
2. `process.handleCategorySelection` parses input via keyword/number matching
3. Updates user state to `"awaiting_policy"` with `preferredCategory`
4. Sends upload link: `{baseUrl}/upload/{uploadToken}`
5. If user sends an attachment instead of text, skips to policy processing

### Flow 3: Policy Upload (SMS — MMS attachment)
1. User sends a PDF via MMS while in `"awaiting_policy"` or `"active"` state
2. `process.processPolicy`:
   - Sends "Got it, one sec"
   - Downloads PDF from OpenPhone media URL
   - Converts to base64, stores raw blob in Convex file storage
   - `classifyDocumentType(pdfBase64)` → policy or quote
   - `extractFromPdf` or `extractQuoteFromPdf` → structured extraction
   - `applyExtracted` or `applyExtractedQuote` → normalized fields
   - `detectCategory` — keyword scoring (auto vs tenant vs other)
   - Stores policy record with all extracted data, status → `"ready"`
   - Updates user state to `"active"`
   - Sends summary burst: headline, coverage breakdown (top 4), "ask me anything"

### Flow 4: Policy Upload (Web — upload page)
1. User visits `{baseUrl}/upload/{uploadToken}`
2. Upload page verifies token via `users.getByUploadToken` (public query, masks phone number)
3. User drags/drops or selects a PDF (max 20MB)
4. Client: `users.generateUploadUrl` → uploads to Convex storage → `users.submitPolicy`
5. `submitPolicy` schedules `upload.processUploadedPolicy` — same extraction pipeline as SMS flow
6. Sends SMS summary to user's phone when done

### Flow 5: Conversational Q&A (`state: "active"`)
1. User texts a question (no attachment)
2. `process.handleQuestion`:
   - Loads all `"ready"` policies for user
   - If no policies → sends upload link
   - Builds system prompt via `buildAgentSystemPrompt({ platform: "sms", intent: "direct", companyName: "Spot" })`
   - Adds compliance guardrails (no selling, no legal/financial advice, natural texting tone)
   - Builds document context from `rawExtracted` via `buildDocumentContext`
   - Calls Claude claude-sonnet-4-6 via Vercel AI SDK (`generateText`, maxTokens: 400)
   - Truncates response to 1,550 chars (SMS limit safety)
   - Sends reply

### Nudge Flow (text message while `"awaiting_policy"`)
- If user sends text (not a PDF), checks if it's a category change
- Otherwise sends "I'll need to see the policy first" + upload link

---

## Phone Numbers

| Number | Region | ID | Status |
|--------|--------|----|--------|
| (929) 642-1213 | US | `PNiDaC8HHF` | Pending A2P registration |
| (289) 212-7916 | CA | `PN3iSAb7ZR` | Active (no A2P needed) |

Currently sending from the CA number. To switch to US after A2P approval:
```bash
npx convex env set OPENPHONE_PHONE_NUMBER_ID 'PNiDaC8HHF'
```

---

## Environment Variables (Convex)

All env vars are set in the Convex dashboard, not locally:

| Variable | Description |
|----------|-------------|
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

There is no local Convex — `npm run dev` syncs to the cloud deployment (`cool-leopard-641`).

### Testing the SMS flow
1. Text anything to (289) 212-7916
2. Follow the conversation (category → upload → ask questions)
3. Test phone: Adyan's number 6479221805

### Resetting a test user
Run in the Convex dashboard or via `npx convex run`:
```bash
npx convex run admin:deleteUserByPhone '{"phone": "+16479221805"}'
```
This deletes the user, all their messages, and all their policies.

---

## Key Design Decisions

1. **Webhook dedup via `webhookLocks` table** — OpenPhone can fire duplicate webhooks. `claimWebhook` is an atomic Convex mutation that prevents double-processing.

2. **All processing is scheduled via `ctx.scheduler.runAfter(0, ...)`** — The webhook handler returns 200 immediately, then processing happens async. This avoids OpenPhone webhook timeouts.

3. **`sendBurst` pattern** — Multi-message responses are sent with 0.8–1.5s random delays between messages to feel like a real person texting. This is used for welcome messages and policy summaries.

4. **Upload tokens instead of auth** — No login system. Each user gets a random 24-char token embedded in their upload URL. The upload page masks the phone number for privacy.

5. **Category detection is keyword-based** — `detectCategory` scores extracted text against auto/tenant keyword lists. Simple and effective for v0.

6. **State machine on `users.state`** — Controls conversation routing:
   - `awaiting_category` → expects category input
   - `awaiting_policy` → expects PDF attachment or sends upload link
   - `active` → handles Q&A, also accepts new policy uploads

7. **Compliance guardrails in system prompt** — Spot doesn't sell, recommend, or give legal/financial advice. Keeps responses to policy explanation only.

8. **Two upload paths** — MMS (direct in conversation) and web (upload page link). Both converge to the same extraction pipeline. Web upload exists because MMS has reliability issues with large PDFs.

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
- No webhook signature verification (OPENPHONE_WEBHOOK_SECRET exists but isn't checked)
- No rate limiting or spam protection
