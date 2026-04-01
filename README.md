# Spot — Insurance Policy Vault over iMessage/SMS

Spot is a messaging-first insurance assistant by [Clarity Labs](https://claritylabs.inc). Users text a phone number, send their insurance policy PDFs, and Spot parses the document, stores structured data, and answers coverage questions — all over iMessage, RCS, or SMS. No app, no login, no dashboard.

## How It Works

```
User sends iMessage/SMS ──► Linq (primary) ──► Webhook ──► Convex backend
                            OpenPhone (fallback) ──┘          │
                                                 ┌────────────┼────────────┐
                                                 ▼            ▼            ▼
                                            Welcome      Extract PDF    Answer
                                            flow         via CL SDK     questions
                                                 │            │         via Claude
                                                 ▼            ▼            │
                                            Linq / OpenPhone ◄── Convex DB ◄┘
                                                 │
                                                 ▼
                                           User gets reply
```

### Messaging Channels

| Channel | Provider | Number | Protocol | Role |
|---------|----------|--------|----------|------|
| **Linq** | linqapp.com | +1 (347) 307-4526 | iMessage / RCS / SMS | Primary |
| **OpenPhone** | openphone.com | +1 (289) 212-7916 | SMS | Fallback |

**Routing:** If a user has a `linqChatId` (arrived via Linq), all outbound goes through Linq. If Linq fails, falls back to OpenPhone SMS. Legacy OpenPhone users continue on SMS.

### The Conversation State Machine

```
[first text] ──► awaiting_category ──► awaiting_policy ──► active
                 "auto, renters,        "send me your       Q&A mode +
                  or something else?"    policy PDF"         accepts new policies
```

| State | What Spot expects | What happens |
|-------|-------------------|--------------|
| `awaiting_category` | Text reply: "auto", "renters", "other", or 1/2/3 | Parses category, moves to `awaiting_policy` |
| `awaiting_policy` | PDF attachment (iMessage/MMS) or web upload | Extracts policy data, sends summary, moves to `active` |
| `active` | Any text question, or another PDF | Questions get AI answers from policy data; PDFs get processed as new policies |

### Policy Extraction Pipeline (Parallelized)

Both upload paths (message attachment + web upload) use the same parallelized pipeline:

```
Step 1 (parallel):  Ack message  +  PDF download
Step 2 (parallel):  Storage      +  classifyDocumentType  +  extractFromPdf (optimistic)
Step 3 (parallel):  Create record + Progress message + Typing indicator + (if quote) extractQuoteFromPdf
Step 4 (parallel):  updateExtracted + updateState + stopTyping
Step 5:             Send summary burst
```

For the common policy case, extraction runs alongside classification — cutting total time by the classification duration (~3-5s). Quotes require a second extraction call but the record creation and progress messaging still happen in parallel.

### Q&A (Active State)

When a user with processed policies asks a question:

1. All `"ready"` policies are loaded for the user
2. System prompt is built via CL SDK's `buildAgentSystemPrompt` (tuned for SMS + direct intent)
3. Compliance guardrails are added (no selling, no legal/financial advice, natural texting tone)
4. Policy data is injected as document context via `buildDocumentContext`
5. Claude Sonnet generates a response (Linq: 800 tokens, OpenPhone: 400 tokens + 1,550 char truncation)
6. Reply is sent via the user's channel

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend / DB | [Convex](https://convex.dev) — serverless TypeScript, real-time, scheduled functions |
| Messaging (primary) | [Linq API v3](https://linqapp.com) — iMessage, RCS, SMS via single API |
| Messaging (fallback) | [OpenPhone API](https://www.openphone.com) — SMS |
| Document AI | `@claritylabs/cl-sdk` — classify, extract, enrich insurance documents |
| LLM | Claude Sonnet via `@ai-sdk/anthropic` + Vercel AI SDK |
| Frontend | Next.js 15 + React 19 (upload page only) |
| PDF parsing | `pdf-lib` |

## Project Structure

```
sms-experiment/
├── convex/                     # All backend logic
│   ├── schema.ts               # Database schema (users, policies, messages, webhookLocks)
│   ├── http.ts                 # HTTP router — /openphone/webhook + /linq/webhook
│   ├── openphone.ts            # OpenPhone webhook handler (SMS inbound)
│   ├── linq.ts                 # Linq webhook handler (iMessage/RCS/SMS inbound)
│   ├── ingest.ts               # Dedup (claimWebhook) + user upsert + message logging
│   ├── process.ts              # Core logic — welcome, categories, extraction, Q&A
│   ├── send.ts                 # OpenPhone outbound SMS wrapper
│   ├── sendLinq.ts             # Linq outbound — send message, create chat, typing indicators
│   ├── messages.ts             # Message CRUD
│   ├── users.ts                # User CRUD + upload token + public mutations for upload page
│   ├── policies.ts             # Policy CRUD
│   ├── upload.ts               # Web upload flow — processes PDFs from the upload page
│   └── admin.ts                # Admin utilities (deleteUserByPhone for testing)
├── src/app/
│   ├── page.tsx                # Root — redirects to claritylabs.inc
│   ├── not-found.tsx           # Branded 404
│   └── upload/[userId]/page.tsx  # Token-gated PDF upload page
├── CLAUDE.md                   # Detailed project instructions for AI assistants
└── PRD.md                      # Original product requirements
```

## Key Design Decisions

**Linq-first channel routing** — `sendAndLog` tries Linq (if user has `linqChatId`), falls back to OpenPhone on failure. Linq users get typing indicators, longer AI responses, and iMessage-native PDF upload. Channel is logged on every message.

**Parallelized extraction** — Classification, storage upload, and optimistic policy extraction all run via `Promise.all`. For the majority case (policies), extraction completes alongside classification. Progress messages keep users informed during the pipeline.

**Webhook HMAC verification** — Linq webhooks are verified via HMAC-SHA256 (raw UTF-8 secret, `{timestamp}.{body}` payload, hex output). OpenPhone verification is not yet implemented.

**Webhook dedup** — Both channels use `claimWebhook`, an atomic Convex mutation writing to `webhookLocks`. Linq keys are prefixed `linq_`.

**Async processing** — Webhook handlers return 200 immediately, scheduling all processing via `ctx.scheduler.runAfter(0, ...)`.

**sendBurst pattern** — Multi-message responses have 0.8–1.5s random delays to feel conversational.

**Upload tokens instead of auth** — No login. Random 24-char tokens in upload URLs. Phone numbers masked on the upload page.

## Database

Four tables in Convex:

- **users** — Phone number, conversation state, preferred category, upload token, `linqChatId`
- **policies** — Extracted policy data, raw PDF reference, processing status
- **messages** — Full message log (inbound + outbound), `channel` field tracks which provider
- **webhookLocks** — Dedup table keyed by message ID (from any channel)

## Environment Variables

Set in the [Convex dashboard](https://dashboard.convex.dev). Use `--deployment kindhearted-labrador-258` for dev.

| Variable | Description |
|----------|-------------|
| `LINQ_API_KEY` | Linq Partner API v3 key |
| `LINQ_WEBHOOK_SECRET` | HMAC-SHA256 signing secret for Linq webhook verification |
| `LINQ_PHONE_NUMBER` | Linq phone number (`+13473074526`) |
| `OPENPHONE_API_KEY` | OpenPhone API key |
| `OPENPHONE_PHONE_NUMBER_ID` | Phone number ID to send from |
| `OPENPHONE_WEBHOOK_SECRET` | Webhook signature (exists but not validated yet) |
| `ANTHROPIC_API_KEY` | Claude API key for CL SDK + Q&A |

Frontend: `NEXT_PUBLIC_CONVEX_URL` in `.env.local` (auto-set by `npx convex dev`). `NEXT_PUBLIC_APP_URL` for upload link base URL (defaults to `https://secure.claritylabs.inc`).

## Development

```bash
npm install
npm run dev          # Convex backend (syncs to cloud dev deployment)
npm run dev:frontend # Next.js frontend (upload page)
npm run dev:all      # Both
```

No local Convex — `npm run dev` syncs directly to `kindhearted-labrador-258`.

### Testing

1. **Linq (primary):** iMessage to (347) 307-4526
2. **OpenPhone (fallback):** SMS to (289) 212-7916
3. Follow the conversation: pick a category, upload a policy, ask questions

### Resetting a Test User

```bash
npx convex run admin:deleteUserByPhone '{"phone": "+16479221805"}'
```

Deletes the user, all their messages, and all their policies.

## What's Intentionally Not Built

- No dashboard (use Convex dashboard directly)
- No auth system (token-gated uploads only)
- No OpenPhone webhook signature verification (Linq IS verified)
- No rate limiting or spam protection
- No commercial lines support
- No thread management (messaging is single-threaded per number)
