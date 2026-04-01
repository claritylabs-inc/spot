# SMS Experiment — Product Requirements Document

**Date:** March 29, 2026
**Status:** Pre-build / Scoping
**Codename:** sms-experiment

---

## Overview

A dead-simple SMS-first insurance policy vault. Users text a phone number, send their insurance policy PDFs, and the system uses the Clarity Labs SDK to deeply parse, classify, and explain their coverage back to them — all over text.

No app download. No login screen. No dashboard. Just text.

---

## Problem

People don't understand their insurance policies. They don't know what they're covered for, what their limits are, or what any of it means. The documents sit in email inboxes or filing cabinets, untouched until something goes wrong.

## Solution

A conversational SMS interface backed by AI that:
1. Accepts policy documents via MMS
2. Parses them with the Clarity Labs SDK (classification, extraction, enrichment)
3. Stores structured policy data per user
4. Responds conversationally — users can ask questions about their coverage in plain English

The magic is **not** in the file upload. The magic is in deeply understanding the documents and making that understanding accessible via text.

---

## Scope — V0 (This Build)

### Policy Categories
| Category | Why |
|----------|-----|
| **Auto** | High volume — taxi/rideshare drivers in NYC, frequent claims |
| **Tenant** | Universal need — renters insurance is common and often misunderstood |
| **Other** | Catch-all — see what people send, inform future categories |

### What We're Building
1. **OpenPhone webhook receiver** — catches inbound SMS/MMS
2. **User registration via phone number** — first text = signup
3. **Policy ingestion** — MMS attachments (PDFs) processed through CL SDK
4. **Conversational responses** — agent prompt system (SMS platform, direct intent) via CL SDK
5. **Landing page** — simple marketing page with the phone number and a quick explanation

### What We're NOT Building (Yet)
- Dashboard (OpenPhone + Convex DB is our dashboard for now)
- Web upload portal
- Magic link auth flows
- Thread management (SMS is inherently single-threaded per phone number)
- Commercial lines support

---

## Architecture

```
User (SMS/MMS)
    |
    v
OpenPhone (managed number)
    |  webhook
    v
Convex HTTP Action (webhook handler)
    |
    |-- New user? -> create user record
    |-- MMS attachment? -> download PDF -> CL SDK pipeline
    |-- Text message? -> CL SDK agent prompt -> respond via OpenPhone API
    |
    v
Convex Database
    |-- users (phone, createdAt, category)
    |-- policies (userId, category, raw PDF ref, extracted data, status)
    |-- messages (userId, direction, body, timestamp)
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **SMS Provider** | OpenPhone API (inbound webhooks + outbound messages) |
| **Backend** | Convex (TypeScript, real-time, serverless) |
| **Document AI** | @claritylabs/cl-sdk (classify, extract, enrich, agent prompts) |
| **AI Provider** | @ai-sdk/anthropic (Claude models, default for CL SDK) |
| **Landing Page** | Simple static page (can be a Convex-served page or separate) |

---

## Data Model (Convex Schema)

### `users`
| Field | Type | Description |
|-------|------|-------------|
| phone | string | E.164 phone number (unique identifier) |
| name | string? | If they provide it |
| createdAt | number | Timestamp |
| lastActiveAt | number | Last message timestamp |

### `policies`
| Field | Type | Description |
|-------|------|-------------|
| userId | Id<"users"> | Reference to user |
| category | "auto" \| "tenant" \| "other" | Policy category |
| documentType | "policy" \| "quote" | From CL SDK classification |
| carrier | string? | Extracted carrier name |
| policyNumber | string? | Extracted policy number |
| effectiveDate | string? | Coverage start |
| expirationDate | string? | Coverage end |
| premium | string? | Premium amount |
| coverages | array | Coverage details from CL SDK |
| insuredName | string? | Who's insured |
| summary | string? | AI-generated plain-English summary |
| rawExtracted | any | Full CL SDK extraction output |
| pdfStorageId | Id<"_storage">? | Convex file storage ref for the PDF |
| status | "processing" \| "ready" \| "failed" | Extraction status |
| createdAt | number | Timestamp |

### `messages`
| Field | Type | Description |
|-------|------|-------------|
| userId | Id<"users"> | Reference to user |
| direction | "inbound" \| "outbound" | Message direction |
| body | string | Message text |
| hasAttachment | boolean | Whether MMS had a file |
| openPhoneId | string? | OpenPhone message ID |
| timestamp | number | When sent/received |

---

## Core Flows

### Flow 1: First Contact (New User)
```
User texts: "Hi" (or anything)
  -> Webhook fires
  -> No user found for this phone number
  -> Create user record
  -> Respond: "Hey! Welcome to [name]. Send me any insurance policy
     (auto, rental, anything) and I'll break it down for you.
     Just snap a photo or forward the PDF."
```

### Flow 2: Policy Upload
```
User sends: [PDF attachment via MMS]
  -> Webhook fires with MMS attachment URL
  -> Download PDF, convert to base64
  -> CL SDK: classifyDocumentType(pdf)
  -> CL SDK: extractFromPdf(pdf) or extractQuoteFromPdf(pdf)
  -> CL SDK: applyExtracted(extracted)
  -> Determine category (auto/tenant/other) from extracted data
  -> Store policy record with full extraction
  -> Respond: "Got it! Here's what I found:
     - Carrier: [carrier]
     - Policy #: [number]
     - Coverage: [effective] to [expiration]
     - Key coverages: [list top 3]

     Want me to explain any part of this in detail?"
```

### Flow 3: Conversational Query
```
User texts: "What's my deductible for collision?"
  -> Webhook fires
  -> Load user's policies from Convex
  -> CL SDK: buildAgentSystemPrompt({ platform: "sms", intent: "direct", ... })
  -> CL SDK: buildDocumentContext(policies, query)
  -> Send to LLM with system prompt + document context + user message
  -> Respond with answer (respecting SMS 1,600 char limit)
```

---

## OpenPhone Integration

- **Webhook endpoint:** Convex HTTP action at `/openphone/webhook`
- **Events to handle:** `message.received` (inbound SMS/MMS)
- **Outbound:** OpenPhone REST API `POST /messages` to send replies
- **Required:** API key, phone number ID

---

## CL SDK Integration

```bash
npm install @claritylabs/cl-sdk ai @ai-sdk/anthropic pdf-lib
```

Key imports:
```typescript
import {
  classifyDocumentType,
  extractFromPdf,
  extractQuoteFromPdf,
  applyExtracted,
  applyExtractedQuote,
  buildAgentSystemPrompt,
  buildDocumentContext,
  AGENT_TOOLS,
} from "@claritylabs/cl-sdk";
```

Agent prompt config for this project:
```typescript
const systemPrompt = buildAgentSystemPrompt({
  platform: "sms",
  intent: "direct",
  companyName: "Clarity Labs",
  coiHandling: "ignore", // no broker routing in v0
});
```

---

## Environment Variables Needed

```env
# OpenPhone
OPENPHONE_API_KEY=           # API key from OpenPhone
OPENPHONE_PHONE_NUMBER_ID=   # The phone number ID to send from

# Anthropic (for CL SDK default models)
ANTHROPIC_API_KEY=           # Claude API key

# Convex
# (managed by `npx convex dev` — no manual env needed locally)
```

---

## Implementation Plan

### Phase 1: Scaffold (30 min)
- [x] Create project folder
- [ ] `npm create convex@latest` — init Convex project
- [ ] Install deps: `@claritylabs/cl-sdk`, `ai`, `@ai-sdk/anthropic`, `pdf-lib`
- [ ] Define Convex schema (users, policies, messages)
- [ ] Set up environment variables in Convex dashboard

### Phase 2: Inbound Pipeline (1-2 hrs)
- [ ] OpenPhone webhook HTTP action (`/openphone/webhook`)
- [ ] User lookup/creation by phone number
- [ ] Message logging (inbound)
- [ ] MMS attachment download + base64 conversion
- [ ] CL SDK classification + extraction pipeline
- [ ] Policy record creation with extracted data
- [ ] Category detection (auto/tenant/other) from extracted content

### Phase 3: Outbound Responses (1 hr)
- [ ] OpenPhone send message helper (REST API)
- [ ] Welcome message for new users
- [ ] Policy summary response after extraction
- [ ] Error/retry messaging for failed extractions

### Phase 4: Conversational Agent (1 hr)
- [ ] CL SDK agent system prompt (SMS platform)
- [ ] Document context builder from user's policies
- [ ] LLM call with Vercel AI SDK
- [ ] Response formatting (SMS length limits)
- [ ] Message logging (outbound)

### Phase 5: Landing Page (30 min)
- [ ] Simple page: headline, phone number, how-it-works (3 steps)
- [ ] Can be Convex-served or a quick static deploy

### Phase 6: Polish & Test (ongoing)
- [ ] End-to-end test with real policy PDFs
- [ ] Error handling for non-PDF attachments
- [ ] Rate limiting / spam protection (if needed)
- [ ] Dashboard (optional, only if we have time — OpenPhone is fine for now)

---

## Success Metrics (Proof of Concept)

- People actually text the number
- People send real policies
- CL SDK successfully extracts meaningful data
- Users ask follow-up questions about their coverage
- We learn what "Other" category people are sending

---

## Open Questions

- What's the OpenPhone number we're using?
- Do we want a specific brand name for the SMS experience?
- Landing page domain?
- Do we want to store the raw PDFs in Convex file storage or just the extracted data?
