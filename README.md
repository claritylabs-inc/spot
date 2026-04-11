# Spot — Insurance Policy Vault over iMessage/SMS

Spot is a messaging-first insurance assistant by [Clarity Labs](https://claritylabs.inc). Users text a phone number, send their insurance policy PDFs or photos, and Spot parses the document, stores structured data, answers coverage questions, sends proof of insurance emails, generates COI certificates, sets expiration reminders, proactively analyzes coverage gaps, and tracks user context over time — all over iMessage, RCS, or SMS. No app, no login, no dashboard.

**Live number:** +1 (929) 443-0153 (iMessage / RCS / SMS via Linq)

---

## Architecture

```
                    iMessage / RCS / SMS / Email
                          │
              ┌───────────┼───────────┬──────────────┐
              ▼           ▼           ▼              ▼
    Linq API       iMessage Bridge   OpenPhone    Resend (email)
    (primary)      (direct iMessage) (SMS fallback) (inbound replies)
              │           │           │              │
    /linq/webhook  /imessage/webhook  /openphone/   /email/webhook
              │           │           webhook        │
              └───────────┴───────┬───┴──────────────┘
                                  ▼
                    Convex Backend (TypeScript, serverless)
              ┌────────────────────────────────────────────────┐
              │  Webhook dedup → Ingest → State machine        │
              │  CL SDK (classify + extract + enrich)          │
              │  Multi-model AI (DeepSeek/Kimi/Claude/Haiku)   │
              │  Agentic Q&A with tool_use (8 tools)           │
              │  Proactive intelligence (health checks, gaps)  │
              │  Email sending (Resend) + thread tracking      │
              │  COI PDF generation (ACORD-style via pdf-lib)  │
              │  Per-user agent memory                         │
              └────────────────────────────────────────────────┘
                      │              │              │
              Convex DB        File Storage    Scheduled Jobs
           (10 tables)        (PDFs, images)   (reminders, alerts)
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend / DB | [Convex](https://convex.dev) — serverless TypeScript, real-time, scheduled functions, cron jobs |
| Messaging (primary) | [Linq API v3](https://linqapp.com) — iMessage, RCS, SMS via single API |
| Messaging (iMessage) | iMessage bridge — direct iMessage delivery |
| Messaging (fallback) | [OpenPhone API](https://www.openphone.com) — SMS |
| Document AI | `@claritylabs/cl-sdk` v0.1 — classify, extract, enrich, personal lines, sanitizeNulls |
| LLM (tool use) | DeepSeek V3 via `@ai-sdk/deepseek` — agentic Q&A with function calling |
| LLM (reasoning) | Kimi K2.5 via `@ai-sdk/moonshotai` — analysis, email writing, comparisons |
| LLM (classification) | Claude Haiku via `@ai-sdk/anthropic` — fast image/document classification |
| LLM (fallback) | Claude Sonnet via `@ai-sdk/anthropic` — automatic fallback for all tasks |
| Vision AI | Claude Haiku (image classification) + DeepSeek V3 (image Q&A) |
| Email | [Resend](https://resend.com) — transactional emails, inbound webhooks, thread tracking |
| PDF | `pdf-lib` — image→PDF conversion, multi-doc merging, ACORD-style COI generation |
| Frontend | Next.js 15 + React 19 (upload page only) |
| CI/CD | GitHub Actions → `npx convex deploy` on push to main |

### Multi-Model Architecture

All AI calls go through `convex/models.ts` → `getModel(task)` with automatic runtime fallback:

| Task | Primary Model | Fallback | Cost/call |
|------|--------------|----------|-----------|
| Q&A + tool use | DeepSeek V3 | Claude Sonnet | ~$0.001 |
| Health check analysis | Kimi K2.5 | Claude Sonnet | ~$0.005 |
| Portfolio analysis | Kimi K2.5 | Claude Sonnet | ~$0.005 |
| Email generation | Kimi K2.5 | Claude Sonnet | ~$0.003 |
| Email reply handling | Kimi K2.5 | Claude Sonnet | ~$0.003 |
| Image classification | Claude Haiku | Claude Sonnet | ~$0.001 |
| Document classification | Claude Haiku | Claude Sonnet | ~$0.001 |

If any provider fails at runtime (outage, rate limit, timeout), `generateTextWithFallback` automatically retries with Claude Sonnet.

---

## Messaging Channels

| Channel | Provider | Number | Protocol | Role |
|---------|----------|--------|----------|------|
| **Linq** | linqapp.com | +1 (929) 443-0153 | iMessage / RCS / SMS | Primary |
| **iMessage Bridge** | Custom | Same number | iMessage direct | Alternative |
| **OpenPhone** | openphone.com | — | SMS | Fallback |

**Routing:** `sendAndLog` tries Linq → iMessage bridge → OpenPhone SMS in order. Channel logged on every message.

---

## Conversation State Machine

```
[first text] → awaiting_category → awaiting_policy → active ←→ awaiting_email
               "auto, homeowners,   "send PDF/photo"   Q&A +      │
                renters, other?"                       actions     awaiting_email_confirm
                                                         │         "confirm or cancel"
                                                         ↓
                                              awaiting_insurance_slip
                                              awaiting_merge_confirm
                                              awaiting_app_questions
                                              awaiting_app_confirm
```

---

## Core Capabilities

### Policy Processing
- **PDF extraction** via cl-sdk — parallelized pipeline (classify + extract + store simultaneously)
- **Photo support** — JPEG/PNG photos classified by Claude Haiku as document (→ embed in PDF → extract) or contextual (→ vision Q&A)
- **Multi-document merging** — multiple files in one message merged into single PDF via pdf-lib
- **Partial policy detection** — identifies declarations-only pages, prompts for full document
- **Duplicate/renewal detection** — matching policyNumber triggers merge or renewal comparison
- **Insurance slip upload** — auto/homeowners policies prompt for existing insurance slips

### Agentic Q&A (8 tools)
| Tool | What it does |
|------|-------------|
| `send_email` | Send proof of insurance or coverage details (AI-written plaintext, user CC'd) |
| `generate_coi` | Generate ACORD-style COI PDF and email it |
| `set_reminder` | Set expiration reminder (texts user N days before) |
| `request_email` | Ask user for their email when needed |
| `lookup_contact` | Find saved contacts by name |
| `send_upload_link` | Send upload link for another policy |
| `reextract_policy` | Re-run extraction with latest pipeline on stored PDFs |
| `save_memory` | Store facts/preferences learned during conversation |

### Email System
- **AI-written plaintext emails** — natural tone, not templates
- **Confirmation flow** — "Good to go?" → user confirms → sent
- **20s undo window** — reply "undo" after confirm to cancel
- **Auto-send mode** — `/autosend on` skips confirmation
- **Inbound reply handling** — Resend webhook receives replies, Spot answers from policy data or escalates to user via text
- **Thread tracking** — thread-specific from addresses (spot+{id}@spot.claritylabs.inc)
- **Contact auto-save** — recipients saved for future "send it to John"

### COI Generation
- ACORD 25-style PDF with correct Producer (broker) and Insurer (underwriter)
- Uses rawExtracted fields: `broker`/`brokerAgency` for Producer, `security`/`carrierLegalName` for Insurer
- Extracts producer contact info from document sections
- Attached to email alongside AI-written cover note

### Proactive Intelligence
- **Post-upload health check** — policy-type-aware analysis (HO-3, HO-4, auto, flood, umbrella each have specific checks). Texts strengths, gaps, exclusion highlights, low limits
- **Portfolio analysis** — when 2+ policies: cross-policy gaps, overlaps, consistency, total liability
- **Renewal comparison** — premium delta, coverage changes, regressions vs improvements
- **Exclusion awareness** — during Q&A, Claude proactively flags relevant exclusions
- **Daily proactive alerts** — seasonal relevance, policy milestones, expiration nudges

### Per-User Agent Memory
- `userMemory` table with typed entries: fact, preference, risk_note, event, interaction
- Auto-populated from policy extraction (address, ownership, household)
- Grows from conversation (via `save_memory` tool) and analysis (risk notes)
- Loaded into every Claude call as context — Spot remembers across conversations
- Deduplication prevents redundant entries

### Application Filling
- Upload insurance application PDFs → Spot extracts fields
- Auto-fills from existing policy data
- Asks remaining questions in batches
- Fills the PDF and sends it back

---

## Project Structure

```
sms-experiment/
├── convex/                          # All backend logic (Convex functions)
│   ├── schema.ts                    # Database schema (10 tables)
│   ├── http.ts                      # HTTP router — 4 webhook endpoints
│   ├── models.ts                    # Multi-model config — getModel(task) + fallback wrappers
│   ├── sendHelpers.ts               # Shared send utilities (sendAndLog, sendBurst)
│   │
│   ├── linq.ts                      # Linq webhook handler (iMessage/RCS/SMS)
│   ├── openphone.ts                 # OpenPhone webhook handler (SMS)
│   ├── imessageBridge.ts            # iMessage bridge webhook handler
│   ├── emailWebhook.ts             # Resend inbound email webhook
│   ├── ingest.ts                    # Dedup + user creation + message logging
│   │
│   ├── process.ts                   # Core: state machine, extraction, agentic Q&A, media routing
│   ├── imageUtils.ts                # Image detection, PDF embedding, vision classification, PDF merging
│   ├── upload.ts                    # Web upload processing
│   │
│   ├── email.ts                     # Email mutations/queries, thread tracking
│   ├── emailActions.ts              # Resend send action, AI email body generation, inbound reply handler
│   ├── coiGenerator.ts              # ACORD-style COI PDF generation via pdf-lib
│   │
│   ├── proactive.ts                 # Proactive intelligence: health check, portfolio analysis, renewal comparison
│   ├── proactiveAlerts.ts           # Alert CRUD
│   ├── proactiveAlertActions.ts     # Cron handler for scheduled alerts
│   ├── memory.ts                    # Per-user agent memory CRUD + buildMemoryContext
│   │
│   ├── reminders.ts                 # Expiration reminder CRUD
│   ├── reminderActions.ts           # Reminder check action
│   ├── crons.ts                     # Hourly reminders + daily proactive alerts
│   │
│   ├── contacts.ts                  # Contact CRUD (auto-learned from emails)
│   ├── applications.ts              # Application CRUD
│   ├── applicationActions.ts        # Application extraction + filling
│   │
│   ├── policies.ts                  # Policy CRUD
│   ├── users.ts                     # User CRUD
│   ├── messages.ts                  # Message CRUD
│   ├── send.ts                      # OpenPhone SMS wrapper
│   ├── sendLinq.ts                  # Linq outbound (send, create chat, typing)
│   ├── sendBridge.ts                # iMessage bridge outbound
│   ├── admin.ts                     # Admin utilities
│   └── convex.config.ts             # Convex app config
│
├── src/app/                         # Next.js frontend (minimal)
│   ├── page.tsx                     # Root → redirects to claritylabs.inc
│   ├── not-found.tsx                # Branded 404
│   └── upload/[userId]/page.tsx     # Token-gated PDF upload (drag-and-drop)
│
├── .github/workflows/deploy.yml     # Auto-deploy Convex on push to main
├── CLAUDE.md                        # Detailed project instructions for AI assistants
└── package.json
```

---

## Database (10 tables)

| Table | Purpose |
|-------|---------|
| `users` | Phone, email, state, preferences, channel IDs, portfolio analysis |
| `policies` | Extracted policy data, raw PDF, analysis results, insurance slips |
| `messages` | Full message log (inbound + outbound), channel tracking |
| `pendingEmails` | Email drafts awaiting confirmation or in undo window |
| `emailThreads` | Maps outbound emails to users for inbound reply routing |
| `reminders` | Policy expiration reminders with trigger dates |
| `contacts` | Auto-learned contacts from email sends |
| `applications` | Insurance application PDFs being filled |
| `userMemory` | Per-user persistent context (facts, preferences, risk notes, events) |
| `proactiveAlerts` | Tracks sent alerts to prevent duplicates |
| `webhookLocks` | Webhook dedup (atomic lock by message ID) |

---

## Environment Variables

Set in the [Convex dashboard](https://dashboard.convex.dev). Prod: `cheery-giraffe-339`. Dev: `kindhearted-labrador-258`.

| Variable | Description |
|----------|-------------|
| `DEEPSEEK_API_KEY` | DeepSeek V3 — primary for Q&A tool use |
| `MOONSHOTAI_API_KEY` | Kimi K2.5 — analysis, email writing |
| `ANTHROPIC_API_KEY` | Claude Haiku (classification) + Sonnet (fallback) |
| `LINQ_API_KEY` | Linq Partner API v3 key |
| `LINQ_WEBHOOK_SECRET` | HMAC-SHA256 signing secret |
| `LINQ_PHONE_NUMBER` | `+19294430153` — outbound sender |
| `OPENPHONE_API_KEY` | OpenPhone API key (fallback) |
| `OPENPHONE_PHONE_NUMBER_ID` | Phone number ID (`PN3iSAb7ZR`) |
| `RESEND_API_KEY` | Resend API key for email |
| `RESEND_FROM_EMAIL` | From address (default: `Spot <spot@spot.claritylabs.inc>`) |
| `RESEND_EMAIL_DOMAIN` | Email domain (default: `spot.claritylabs.inc`) |

Optional: `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` — ready to activate in `models.ts`.

Frontend: `NEXT_PUBLIC_CONVEX_URL` in `.env.local`. `NEXT_PUBLIC_APP_URL` for upload links (default: `https://secure.claritylabs.inc`).

---

## Deployments

| Environment | Convex Deployment | Deploys From |
|-------------|-------------------|-------------|
| **Production** | `cheery-giraffe-339` | `main` branch (auto via GitHub Actions) |
| **Development** | `kindhearted-labrador-258` | `npx convex dev` (local) |

---

## Development

```bash
npm install
npm run dev          # Convex backend (syncs to dev deployment)
npm run dev:frontend # Next.js frontend (upload page)
npm run dev:all      # Both concurrently
```

### Testing
1. **Linq:** iMessage to (929) 443-0153
2. Upload a policy (PDF or photo), ask questions
3. **Email:** Ask "send proof of insurance to landlord@example.com"
4. **COI:** Ask "send a COI to my landlord for my apartment lease"
5. **Reminders:** Ask "remind me before my policy expires"
6. **Photo Q&A:** Send a photo and ask "what does this mean?"
7. **Debug:** Text `/debug` for state info, `/logs` for message history

### Reset a test user
```bash
npx convex run admin:deleteUserByPhone '{"phone": "+16479221805"}'
```

---

## Key Design Decisions

1. **Multi-model with centralized config** — `models.ts` maps task → provider+model. DeepSeek for tool use, Kimi for reasoning, Haiku for classification. Auto-fallback to Claude Sonnet on failure.
2. **Linq-first channel routing** — `sendAndLog` tries Linq → iMessage bridge → OpenPhone. Typing indicators for iMessage, longer responses, native PDF support.
3. **Webhook dedup via `webhookLocks`** — atomic Convex mutation prevents double-processing. Linq keys prefixed `linq_`, email keys `email_`.
4. **Parallelized extraction** — classification + storage + optimistic extraction run via `Promise.all`. Saves 3-5s per policy.
5. **Async all processing** — webhooks return 200 immediately, everything scheduled via `ctx.scheduler.runAfter(0, ...)`.
6. **Per-user agent memory** — persistent context that grows from uploads, conversations, analysis, and email interactions. Loaded into every AI call.
7. **Email as intermediary** — Spot sends from thread-specific addresses (spot+{id}@domain), receives replies via Resend webhook, answers or escalates to user.
8. **Proactive on upload** — health check runs ~2s after extraction. Portfolio analysis when 2+ policies. Renewal comparison when matching policyNumber detected.
9. **Plaintext AI-written emails** — not HTML templates. Claude writes natural email bodies using full rawExtracted data.
10. **Convex node/non-node split** — mutations/queries in regular files, actions with Node.js APIs in `"use node"` files.
