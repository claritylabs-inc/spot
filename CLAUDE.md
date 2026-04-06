# SMS Experiment — Clarity Labs Consumer PoC

## What This Is

A messaging-first insurance policy vault. Users text a phone number (via iMessage, RCS, or SMS), send their insurance policy PDFs or photos, and an AI assistant ("Spot") parses the document using the Clarity Labs SDK, stores structured data, and answers coverage questions — all over text. Spot can also send emails (proof of insurance, COI summaries), set expiration reminders, and understand photos via vision AI. No app, no login, no dashboard.

**Brand name:** Spot
**Parent company:** Clarity Labs (claritylabs.inc)
**Convex prod deployment:** `cheery-giraffe-339` (team: claritylabs, project: sms-experiment)
**Convex dev deployment:** `kindhearted-labrador-258`
**Convex dashboard:** https://dashboard.convex.dev/d/cheery-giraffe-339

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend / DB | Convex (TypeScript, serverless, real-time) |
| Messaging (primary) | Linq API v3 — iMessage, RCS, SMS via single API |
| Messaging (iMessage) | iMessage bridge — direct iMessage delivery |
| Messaging (fallback) | OpenPhone API — SMS only |
| Document AI | `@claritylabs/cl-sdk` v1.4 (classify, extract, enrich, agent prompts, personal lines, sanitizeNulls) |
| LLM (tool use) | DeepSeek V3 via `@ai-sdk/deepseek` — agentic Q&A with function calling |
| LLM (reasoning) | Kimi K2.5 via `@ai-sdk/moonshotai` — analysis, email writing |
| LLM (classification) | Claude Haiku via `@ai-sdk/anthropic` — fast classification |
| LLM (fallback) | Claude Sonnet via `@ai-sdk/anthropic` — automatic fallback for all tasks |
| Model config | `convex/models.ts` — centralized getModel(task) with `generateTextWithFallback` |
| Email | Resend API — transactional emails, inbound webhooks, thread tracking |
| Frontend | Next.js 15 + React 19 (upload page + redirect) |
| PDF parsing | `pdf-lib` (image→PDF conversion, multi-doc PDF merging, COI generation) |

---

## Messaging Channels

Spot supports two messaging channels. **Linq is primary**, OpenPhone is fallback.

| Channel | Provider | Number | Protocol | Status |
|---------|----------|--------|----------|--------|
| **Linq** | linqapp.com | +1 (929) 443-0153 | iMessage / RCS / SMS | Active (primary) |

### Channel routing logic (`sendAndLog` in `process.ts`)

1. If user has a `linqChatId` → send via Linq API
2. If Linq fails → fall back to OpenPhone SMS
3. If no `linqChatId` (legacy/OpenPhone user) → send via OpenPhone directly
4. Log which channel was actually used on each message record

### Linq-specific behavior

- **Typing indicators** — Linq supports typing bubbles. Used during PDF extraction wait instead of "Got it, one sec" text.
- **No character limit** — iMessage has no practical limit. `maxOutputTokens` is 800 for Linq users vs 400 for OpenPhone (SMS).
- **PDF via iMessage** — Linq users are asked to send PDFs directly in conversation first, with web upload as backup.
- **Photo support** — Linq users can send photos of insurance documents (JPEG/PNG); these are classified and either extracted or used for vision Q&A.
- **Retry recognition** — `nudgeForPolicy` recognizes "try again" / "retry" / "resend" intent and re-prompts for the PDF.

---

## Project Structure

```
sms-experiment/
├── convex/                     # All backend logic (Convex functions)
│   ├── schema.ts               # Database schema (users, policies, messages, pendingEmails, reminders, webhookLocks)
│   ├── http.ts                 # HTTP router — /openphone/webhook + /linq/webhook
│   ├── openphone.ts            # OpenPhone webhook handler (SMS inbound)
│   ├── linq.ts                 # Linq webhook handler (iMessage/RCS/SMS inbound)
│   ├── ingest.ts               # Dedup (claimWebhook) + user creation + message logging
│   ├── process.ts              # Core logic — welcome, categories, extraction, Q&A (agentic with tool_use), media routing, email state handlers
│   ├── imageUtils.ts           # Image detection, PDF embedding, vision intent classification
│   ├── email.ts                # Email mutations/queries, HTML template builders (proof of insurance, COI, coverage details)
│   ├── emailActions.ts         # Email send action (Resend API, "use node")
│   ├── reminders.ts            # Reminder CRUD mutations/queries
│   ├── reminderActions.ts      # Reminder check action (sends texts for due reminders)
│   ├── crons.ts                # Convex cron — checks reminders every hour
│   ├── send.ts                 # OpenPhone outbound SMS wrapper
│   ├── sendLinq.ts             # Linq outbound — send message, create chat, typing indicators
│   ├── messages.ts             # Message CRUD (log, claim, query)
│   ├── users.ts                # User CRUD + upload token + email + lastImageId + public mutations for upload page
│   ├── policies.ts             # Policy CRUD (create, updateExtracted, getByUser, getById)
│   ├── upload.ts               # Web upload flow — processes PDFs uploaded via the upload page
│   ├── contacts.ts             # Contact CRUD — auto-learned from email sends, name search
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
| email | string? | User's email address (for CC on outbound emails) |
| state | string? | Conversation state: `"awaiting_category"`, `"awaiting_policy"`, `"awaiting_email"`, `"awaiting_email_confirm"`, `"awaiting_insurance_slip"`, `"awaiting_merge_confirm"`, `"active"` |
| preferredCategory | string? | `"auto"`, `"homeowners"`, `"renters"`, `"other"`, etc. |
| uploadToken | string? | 24-char random token for the web upload page (indexed) |
| linqChatId | string? | Linq chat ID for ongoing conversation (indexed by `by_linq_chat_id`) |
| lastImageId | Id\<"_storage"\>? | Most recent image sent by user, for vision Q&A context |
| autoSendEmails | boolean? | If true, skip email confirmation and send immediately (no undo timer) |
| pendingMergePolicyId | Id\<"policies"\>? | Existing policy to merge into (during merge confirmation flow) |
| pendingMergeStorageId | Id\<"_storage"\>? | New PDF waiting to be merged (during merge confirmation flow) |
| lastActiveAt | number | Last message timestamp |
| createdAt | number | Signup timestamp |

### `policies`
| Field | Type | Description |
|-------|------|-------------|
| userId | Id\<"users"\> | Owner (indexed) |
| category | string | Detected or user-specified category: `"auto"`, `"homeowners"`, `"renters"`, `"flood"`, `"umbrella"`, `"pet"`, `"travel"`, `"earthquake"`, `"recreational"`, `"farm"`, `"commercial"`, `"other"` |
| policyTypes | string[]? | SDK granular type array (e.g., `["homeowners_ho3"]`, `["personal_auto"]`) |
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
| pdfStorageId | Id\<"_storage"\>? | Convex file storage reference for the raw PDF (may be merged multi-doc PDF) |
| insuranceSlipStorageId | Id\<"_storage"\>? | Existing insurance slip uploaded by user (auto/home only) |
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
| channel | string? | `"openphone"` \| `"linq"` \| `"email"` — which channel was used |
| imageStorageId | Id\<"_storage"\>? | Stored image attachment for vision context |
| timestamp | number | When sent/received |

### `pendingEmails`
| Field | Type | Description |
|-------|------|-------------|
| userId | Id\<"users"\> | Owner (indexed) |
| recipientEmail | string | Where to send the email |
| recipientName | string? | Recipient's name |
| subject | string | Email subject |
| htmlBody | string | Full HTML email body |
| ccEmail | string? | User's email (CC'd on outbound) |
| purpose | string | `"proof_of_insurance"` \| `"coverage_details"` \| `"coi"` \| `"general_info"` |
| status | string | `"awaiting_confirmation"` \| `"scheduled"` \| `"sent"` \| `"cancelled"` \| `"undone"` \| `"failed"` |
| scheduledFunctionId | string? | Convex scheduler ID for the 20s delayed send |
| createdAt | number | Timestamp |

### `reminders`
| Field | Type | Description |
|-------|------|-------------|
| userId | Id\<"users"\> | Owner (indexed) |
| policyId | Id\<"policies"\> | Which policy this reminder is for |
| triggerDate | number | Timestamp when to send the reminder text |
| daysBefore | number | How many days before expiration (typically 30) |
| status | string | `"pending"` \| `"sent"` \| `"cancelled"` |
| createdAt | number | Timestamp |

### `contacts`
| Field | Type | Description |
|-------|------|-------------|
| userId | Id\<"users"\> | Owner (indexed) |
| name | string | Contact name (e.g. "John", "Sarah") |
| email | string | Contact email (indexed with userId for uniqueness) |
| label | string? | Optional role label (e.g. "landlord", "property manager", "agent") |
| lastUsedAt | number | Last time this contact was emailed |
| createdAt | number | Timestamp |

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
1. User replies with category (e.g., "auto", "homeowners", "1", "2", "3", "4")
2. `process.handleCategorySelection` parses input via keyword/number matching
3. Updates user state to `"awaiting_policy"` with `preferredCategory`
4. Linq users: asked to send PDF or photo directly via iMessage. OpenPhone users: sent web upload link
5. If user sends an attachment instead of text, skips to media processing

### Flow 3: Media Upload (message attachment — PDF or photo)
1. User sends a PDF or image via iMessage/MMS while in `"awaiting_policy"` or `"active"` state
2. `process.processMedia` routes based on MIME type:
   - **PDF** → `processPolicy` (existing extraction pipeline)
   - **Image (JPEG/PNG)** → classify intent via Claude Haiku vision:
     - **Document photo** → embed in PDF via `pdf-lib` → extraction pipeline
     - **Contextual photo** → store image, route to `handleQuestion` with vision context
   - **HEIC/WebP document** → ask user to resend as PDF or screenshot (not embeddable)

### Flow 4: Policy Upload (Web — upload page)
1. User visits `{baseUrl}/upload/{uploadToken}`
2. Upload page verifies token via `users.getByUploadToken` (public query, masks phone number)
3. User drags/drops or selects a PDF (max 20MB)
4. Client: `users.generateUploadUrl` → uploads to Convex storage → `users.submitPolicy`
5. `upload.processUploadedPolicy` — same parallelized extraction pipeline
6. Sends summary to user via their channel (Linq if they have `linqChatId`, else OpenPhone)

### Flow 5: Agentic Q&A (`state: "active"`)
1. User texts a question (no attachment)
2. `process.handleQuestion` (now agentic with tool_use):
   - Loads all `"ready"` policies for user
   - If no policies → sends upload link
   - Builds system prompt + document context
   - If user has a recent `lastImageId`, includes it as vision content in the prompt
   - Calls Claude Sonnet via `generateText` with tools:
     - `send_email` — draft + send proof of insurance / coverage details to someone
     - `generate_coi` — create and send COI summary email
     - `set_reminder` — set expiration reminder
     - `request_email` — ask user for their email (if not on file)
     - `send_upload_link` — send the user their upload link
   - `stopWhen: stepCountIs(5)` — allows multi-step tool use
   - If email tool was used → sets state to `"awaiting_email_confirm"` for user confirmation

### Flow 6: Email Confirmation (`state: "awaiting_email_confirm"`)
1. User receives "I'll send [details] to [recipient]. Reply 'send' to confirm"
2. User replies:
   - `send` / `yes` / `go` → schedules email with 20s undo window
   - `cancel` / `no` → cancels pending email
   - `undo` → cancels scheduled email during 20s window
   - `/autosend on` → enables auto-send (skips confirmation for future emails)
   - `/autosend off` → disables auto-send
3. If user has `autoSendEmails: true`, emails are sent immediately (no confirmation, no undo)

### Flow 7: Email Collection (`state: "awaiting_email"`)
1. Claude's `request_email` tool was called (user wants to send email but has no email on file)
2. Spot asks for their email
3. User replies with email address → validated, stored, state returns to `"active"`

### Flow 8: Expiration Reminders
1. Claude's `set_reminder` tool creates a reminder record (typically 30 days before expiration)
2. `crons.ts` runs `reminderActions.checkAndSendReminders` every hour
3. When triggerDate is reached, texts user via their channel about the upcoming expiration

### Flow 9: Insurance Slip Upload (`state: "awaiting_insurance_slip"`)
1. After uploading an auto or homeowners policy, Spot asks if they have an existing insurance slip
2. User can:
   - **Send a file** (PDF/image, single or multiple) → saved as `insuranceSlipStorageId` on the policy
   - **Say yes** (no attachment) → prompted to send the file
   - **Say no/skip** → transitions to active, told Spot can generate one anytime
   - **Say something else** → transitions to active, routed to Q&A
3. Multiple slip attachments are merged into one PDF via `pdf-lib` before storage

### Flow 10: Multi-Document Upload (multiple attachments in one message)
1. User sends multiple files (PDFs, images, or mix) in a single message
2. `processMultipleMedia` downloads all attachments in parallel
3. Files are merged into a single PDF using `pdf-lib` (`mergeIntoPdf` in `imageUtils.ts`)
   - PDFs: pages are copied via `copyPages`
   - Images (JPEG/PNG): embedded as individual pages
   - HEIC/WebP: skipped with warning
4. Merged PDF is stored and processed through the standard extraction pipeline → single policy record
5. Useful for split policies (e.g., declarations page + coverage doc sent together)

### Flow 11: Partial Policy Detection
1. After extraction, `isPartialPolicy()` heuristic checks for incomplete data:
   - Has carrier/policy number + dates but no coverages → likely just a declarations page
   - Only 1 or fewer key fields extracted → stub/partial document
2. If partial: Spot tells user "Looks like this might be just a declarations page" and asks for the full policy
3. User can send the rest later — merge detection (Flow 12) will match it automatically

### Flow 12: Intelligent Policy Merging (`state: "awaiting_merge_confirm"`)
1. After extraction, `findMatchingPolicy` checks if the new document matches an existing policy:
   - **Strong match:** same policy number (case-insensitive)
   - **Medium match:** same carrier + same category
2. If match found, Spot asks: "This looks like it goes with [existing policy]. Want me to merge them? (yes/no)"
3. User state → `awaiting_merge_confirm`, pending merge info stored on user record
4. On **confirm**: `executePolicyMerge` runs:
   - Downloads both PDFs from storage
   - Merges into one PDF via `mergeIntoPdf`
   - Re-extracts from the combined document (full pipeline)
   - Updates existing policy record, deletes the duplicate
5. On **deny**: keeps both as separate policies
6. On **unclear response**: re-asks for confirmation

### Flow 13: `/merge` Cleanup Command
1. User texts `/merge` while in active state
2. Spot scans all ready policies for merge candidates (same policyNumber or same carrier+category)
3. If candidates found: presents the first match and asks for merge confirmation
4. Enters `awaiting_merge_confirm` flow (same as Flow 12)
5. If no candidates: lists all policies and confirms they're all separate

### Flow 14: Saved Contacts
1. **Auto-learn:** When an email is sent successfully (via Resend), the recipient's name + email is auto-saved via `contacts.upsert` (deduped by email per user)
2. **Lookup:** When user says "send proof to John", Claude's `lookup_contact` tool searches saved contacts by name/label
3. **System prompt context:** All saved contacts are included in the agentic Q&A system prompt so Claude can match names immediately
4. **`/contacts` command:** Lists all saved contacts with names, labels, and emails
5. Contacts can also have role labels (e.g. "landlord", "property manager") for natural-language matching

### Nudge Flow (text message while `"awaiting_policy"`)
- Recognizes retry intent ("try again", "retry", "resend") and re-prompts for PDF/photo
- Checks if it's a category change
- Linq users: nudged to send PDF/photo directly + web upload backup. OpenPhone: web upload link

---

## Phone Numbers

| Number | Provider | Status |
|--------|----------|--------|
| +1 (929) 443-0153 | Linq | Active — iMessage/RCS/SMS (primary) |

---

## Environment Variables (Convex)

All env vars are set in the Convex dashboard, not locally. Prod: `cheery-giraffe-339`. Dev: `kindhearted-labrador-258` (currently cleared — copy from prod if needed).

| Variable | Description |
|----------|-------------|
| `LINQ_API_KEY` | Linq Partner API v3 key |
| `LINQ_WEBHOOK_SECRET` | HMAC-SHA256 signing secret for Linq webhook verification |
| `LINQ_PHONE_NUMBER` | Linq phone number (`+19294430153`) — used as `from` when creating chats |
| `OPENPHONE_API_KEY` | OpenPhone API key |
| `OPENPHONE_PHONE_NUMBER_ID` | Phone number ID to send from (currently `PN3iSAb7ZR`) |
| `OPENPHONE_WEBHOOK_SECRET` | Webhook signature verification (not currently validated in code) |
| `DEEPSEEK_API_KEY` | DeepSeek V3 — primary for agentic Q&A with tool use |
| `MOONSHOTAI_API_KEY` | Kimi K2.5 — analysis, email writing, comparisons |
| `ANTHROPIC_API_KEY` | Claude Haiku (classification) + Sonnet (fallback) + CL SDK |
| `RESEND_API_KEY` | Resend API key for transactional email sending |
| `RESEND_FROM_EMAIL` | From address for emails (default: `Spot <spot@spot.claritylabs.inc>`) |
| `RESEND_EMAIL_DOMAIN` | Email domain for thread-specific addresses (default: `spot.claritylabs.inc`) |

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

There is no local Convex — `npm run dev` syncs to the dev deployment (`kindhearted-labrador-258`). Production is `cheery-giraffe-339`.

### Testing the messaging flow
1. **Linq (primary):** Text anything to (929) 443-0153 via iMessage
2. **OpenPhone (fallback):** Text anything to (289) 212-7916
3. Follow the conversation (category → upload → ask questions)
4. Test photo handling: send a JPEG/PNG photo of a policy page
5. Test email: ask Spot to "send proof of insurance to [email]"
6. Test reminders: ask Spot to "remind me before my policy expires"
7. Test phone: Adyan's number 6479221805

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

4. **Parallelized extraction pipeline** — `processPolicy` runs classification + optimistic policy extraction + storage upload in parallel via `Promise.all`. For the common policy case, extraction is already done when classification finishes. Quotes require a second extraction call. Extraction uses `concurrency: 3` for parallel page processing. `sanitizeNulls()` is applied to all extraction output before storing in Convex.

5. **Progress messages during extraction** — Users get intermediate updates ("Got it — reading through your document now", "Found your policy — pulling out coverages and limits") so they know the pipeline is working. Linq users also get typing indicators.

6. **All processing is scheduled via `ctx.scheduler.runAfter(0, ...)`** — Webhook handlers return 200 immediately, then processing happens async. This avoids webhook timeouts.

7. **`sendBurst` pattern** — Multi-message responses are sent with 0.8–1.5s random delays between messages to feel like a real person texting.

8. **Upload tokens instead of auth** — No login system. Each user gets a random 24-char token embedded in their upload URL. The upload page masks the phone number for privacy.

9. **State machine on `users.state`** — Controls conversation routing:
   - `awaiting_category` → expects category input
   - `awaiting_policy` → expects PDF/photo attachment or sends upload link
   - `awaiting_email` → expects email address input
   - `awaiting_email_confirm` → expects send/cancel/undo for pending email
   - `awaiting_insurance_slip` → expects insurance slip upload or skip (auto/home only)
   - `awaiting_merge_confirm` → expects yes/no for merging duplicate policies
   - `active` → handles Q&A with tool_use, also accepts new policy uploads

10. **Compliance guardrails in system prompt** — Spot doesn't sell, recommend, or give legal/financial advice. Keeps responses to policy explanation only.

11. **Two upload paths** — iMessage/MMS (direct in conversation) and web (upload page link). Both converge to the same parallelized extraction pipeline. Web upload exists as backup for large PDFs.

12. **Image handling via media router** — `processMedia` classifies images as document photos (→ embed in PDF → extract) or contextual (→ vision Q&A). Uses Claude Haiku for fast classification. JPEG/PNG are embedded via `pdf-lib`; HEIC/WebP document photos prompt user to resend.

13. **Agentic Q&A with tool_use** — `handleQuestion` uses Vercel AI SDK's `generateText` with tools (`send_email`, `generate_coi`, `set_reminder`, `request_email`, `send_upload_link`). Claude decides when to use tools based on user intent. `stopWhen: stepCountIs(5)` allows multi-step workflows.

14. **Email confirmation with undo** — Emails require user confirmation before sending (reply "send" or "cancel"). Once confirmed, emails are scheduled with a 20s undo window via `ctx.scheduler.runAfter(20_000, ...)`. The scheduled function checks status before sending — if the user replies "undo" within 20s, the scheduled function ID is cancelled. Auto-send mode (`/autosend on`) skips both confirmation and undo timer.

15. **Convex node/non-node split** — Mutations and queries go in regular files. Actions requiring Node.js APIs (`process.env`, `fetch` for external APIs) go in `"use node"` files. This is why email/reminder logic is split: `email.ts` (mutations/queries/templates) + `emailActions.ts` (Resend API action), `reminders.ts` (CRUD) + `reminderActions.ts` (send action).

16. **Insurance slip upload flow** — After auto/home policy extraction, Spot asks users if they have an existing insurance slip. Users can send it (stored as `insuranceSlipStorageId` on the policy) instead of having Spot generate a custom COI. Supports multiple attachments merged into one.

17. **Multi-document merging via pdf-lib** — `mergeIntoPdf()` in `imageUtils.ts` combines multiple PDFs and images into a single PDF. PDFs are merged via `copyPages`, images are embedded as pages. Used for multi-attachment uploads and policy merge operations.

18. **Partial policy detection** — `isPartialPolicy()` heuristic detects incomplete extractions (e.g., just a declarations page). Checks for missing coverages, minimal field counts. Prompts user to send the full policy document.

19. **Saved contacts from email sends** — Every successful email send auto-saves the recipient as a contact via `contacts.upsert` (deduped by email per user). Contacts are loaded into the agentic Q&A system prompt and a `lookup_contact` tool lets Claude resolve names like "John" or "my landlord" to email addresses without re-asking. `/contacts` command lists all saved contacts.

20. **Intelligent policy merge with confirmation** — After extraction, `findMatchingPolicy` checks for existing policies with the same carrier/policy number or carrier/category. If matched, enters `awaiting_merge_confirm` state. On confirmation, PDFs are merged, re-extracted, and the duplicate record is removed. `/merge` command provides manual cleanup.

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
| `sanitizeNulls` | `process.ts`, `upload.ts` | Strips null values from extraction output for Convex safety |

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
- No official ACORD COI generation (COI emails are informational summaries)
- No HEIC/WebP document extraction (users prompted to resend as JPEG/PNG/PDF)
