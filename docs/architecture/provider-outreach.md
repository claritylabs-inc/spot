# Automated provider outreach

The procurement request Providers view matches the provider directory against the request's accepted application, drafts, or typed company facts. Direct operators can send immediately to one eligible provider or all matched providers. The manual outreach tracking operation alone never sends an email.

## Ownership and authorization

`convex/providerOutreach.ts` owns panel reads, launch, stop, claims and durable state. `convex/actions/providerOutreach.ts` owns inbox setup, generation, sending and reply classification. `convex/lib/providerOutreachMatch.ts` owns appetite matching and recipient selection; `coverageLobMapping.ts` shares ACORD mappings with requirement prefill. `providerOutreachSchedule.ts` owns business-day scheduling. `resendInbox.ts` is the Resend transport and enforces delivery mode independently of ordinary email sending.

All browser writes require a direct operator. Operator tools use the same domain writers, with exact approval for external sending. Execution rechecks request, provider, recipient and sequence state; client access and impersonation do not grant send authority. Provider contact selection rejects Spot-owned identities. Each sequence gets a per-outreach packet link using the existing packet primitive. Request-wide link rotation leaves scoped links intact; packet access remains governed by existing token and released-file checks.

## Matching

| Request coverage | Accepted provider codes |
| --- | --- |
| General liability | CGL, BOP, CPKGE |
| Property | PROP, BOP, CPKGE |
| Workers compensation | WORK |
| Commercial auto | AUTOB, TRUCK |
| Professional liability | EO, PL |
| Cyber | CYBER |
| Umbrella/excess | UMBRC, EXLIA |
| Other/unknown | Unevaluable |

Locations, property addresses and workers-compensation jurisdictions supply geography, with registration fallback. Country codes are ISO2 and US/Canadian regions use the existing provider region codes. A provider country without listed regions is country-wide. Missing primary-region service or zero covered lines excludes a provider; some covered regions/lines produce a partial match. Missing appetite is unknown fit. An undetermined request dimension is skipped with a banner. Inactive and blacklisted providers remain excluded. Unknown-fit providers require explicit individual selection and are excluded from send-all.

Explicit outreach email wins; otherwise contact roles rank submissions, general, underwriting, other, then claims/billing, with overlapping lines preferred within a role. No eligible recipient means no send.

## Durable execution

Sequences move from active to completed after the final step, stopped on lifecycle changes, or failed on terminal delivery errors. Any inbound reply first blocks sends in reply_check. A confident auto-reply with a confident negative unmonitored result resumes no earlier than one business day later. A confident unmonitored result stops; all other results, missing decisions and router failures hand off as responded. Bounces stop directly. A stale reply check times out to manual handoff.

Steps are scheduled, leased for sending, and then sent, captured, failed or cancelled. Drafts are persisted before sending. Inference start markers prevent automatic replay after an unknown generation outcome; a deterministic template can supply the fallback. Delivery retries reuse the saved draft and exact step idempotency keys. Unknown delivery can retry only within the provider's idempotency window (conservatively 23 hours); later recovery fails as delivery_unknown. Claims and finalization use lease fencing. Request closure, deletion, outreach status change or proposal filing cancels future steps.

Cadence suggestions use one Jev call with independent choices for count, business-day interval and style. Each field independently passes the shared confidence threshold or falls back to two follow-ups, three business days, brief nudge. Operator overrides remain explicit. Schedules skip weekends, respect effective-date/deadline cutoffs and a 30-day maximum, and derive subsequent due times from observed send time.

## Inboxes and ingress

One inbox belongs to each operator, named from the operator's email localpart on `PROVIDER_OUTREACH_EMAIL_DOMAIN`, with a first-name-at-Spot display name. Threads carry Spot automated and Needs reply labels. The dedicated `/resend-inbox-webhook` verifies Svix signatures with `RESEND_INBOX_WEBHOOK_SECRET`; inbox events never enter ordinary agent inbound routing. Email IDs deduplicate mirroring into procurement threads/messages. Reply attachments reuse procurement ingestion rules and remain operator-private unless separately released.

## Setup and validation

1. Verify a dedicated Resend subdomain, including DKIM, SPF and receiving MX. Do not reuse the ordinary agent or research inbox domains.
2. Configure `AUTH_RESEND_KEY`, `PROVIDER_OUTREACH_EMAIL_DOMAIN` and `RESEND_INBOX_WEBHOOK_SECRET` on the intended deployment. Register the dedicated webhook for inbox.email.received and inbox.email.sent.
3. Verify the two outreach environment checks at `/agent-health`.
4. Run local capture workflows first. Capture makes no Resend calls and must not report real sent timestamps.
5. For authorized real inbox QA, use restricted delivery mode with an explicit test address/domain allowlist. Verify same-thread replies, signatures, attachments, manual dashboard sends and idempotent recovery before enabling unrestricted delivery.

The repeatable cases and observed results live in [provider outreach workflow QA](../testing/provider-outreach-workflow.md). A successful build does not establish live inbox delivery or Jev classification accuracy. No production deployment or external domain provisioning is part of local validation.
