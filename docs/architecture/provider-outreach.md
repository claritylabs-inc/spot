# Automated provider outreach

The procurement request Providers view matches the provider directory against the request's accepted application, drafts, or typed company facts. Direct operators can send immediately to one eligible provider or all matched providers. The manual outreach tracking operation alone never sends an email.

## Ownership and authorization

`convex/providerOutreach.ts` owns panel reads, launch, stop, claims and durable state. `convex/actions/providerOutreach.ts` owns inbox setup, generation, sending and reply classification. `convex/lib/providerOutreachMatch.ts` owns appetite matching and recipient selection; `coverageLobMapping.ts` shares ACORD mappings with requirement prefill. `providerOutreachSchedule.ts` owns business-day scheduling. `resendInbox.ts` is the Resend transport and enforces delivery mode independently of ordinary email sending.

All browser writes require a direct operator. Operator tools use the same domain writers, with exact approval for external sending. Execution rechecks request, provider, recipient and sequence state; client access and impersonation do not grant send authority. Provider contact selection rejects Spot-owned identities. Each sequence gets a per-outreach packet link using the existing packet primitive. Request-wide link rotation leaves scoped links intact; packet access remains governed by existing token and released-file checks.

## Request navigation

The Providers page reads matching candidates directly and shows only providers that fit the request. There are no Add provider or Auto add provider controls, no Unknown/Excluded category tabs, and no empty manual-outreach card. Existing outreach/proposal records share that same table with new matching providers. Contacted rows appear once, retain the recorded recipient and current outreach/proposal status, and expose sequence controls and View details. Existing outreach remains visible even if the provider no longer matches or is absent from the bounded directory result. New candidates show Not contacted; the navigation count includes the combined list. Matching itself creates no outreach records or emails.

Follow-up cadence is a separate left-menu item immediately beneath Providers, routed through `?view=cadence`. Both pages share the workspace's existing outreach controller, so cadence overrides and chosen contacts survive navigation between them and are used by Send/Send-all. The cadence page reuses the same inline row-card/select controls; there is no additional settings store or migration.

## Matching

| Request coverage | Accepted provider codes |
| --- | --- |
| General liability | CGL, BOPGL, BOP, CPKGE |
| Property | PROP, BOPPR, BOP, CPKGE |
| Workers compensation | WORK, WORKP |
| Commercial auto | AUTOB, TRUCK |
| Professional liability | EO, PL, PLMSC |
| Cyber | CYBER |
| Umbrella/excess | UMBRC, UMBRL, EXLIA |
| Other/unknown | Unevaluable |

Locations, property addresses and workers-compensation jurisdictions supply geography, with mailing address before registration fallback. Country codes are ISO2 and US/Canadian regions use the existing provider region codes. Country-only US/Canadian appetite is unknown unless nationwide service is explicitly recorded. State/province exceptions override nationwide service. Every recorded request location must be serviced: any excluded location excludes the provider, while unresolved locations remain unknown fit. Partial matches refer only to coverage lines, never service areas. Hidden follow-up answers do not supply geography. Zero covered lines excludes a provider. Missing appetite is unknown fit. An undetermined request dimension is skipped with a banner. Inactive and blacklisted providers remain excluded. Unknown-fit providers require explicit individual selection and are excluded from send-all.

Manual Auto-add and automated outreach share `brokerAreaFit` and the all-locations requirement, along with shared code aliases and geography normalization. The Providers view uses the shared Table and OrgBrandIcon primitives, with Provider, Contact, Coverage and Status columns. Geography remains a matching condition rather than a repeated column chip. Stored organization logos take precedence over the existing website favicon/initials fallback. The Contact column is an inline Select of current external provider contacts; options include email, recorded coverage preferences and short notes. Operator choices are request-scoped composition state and apply to individual Send and Send-all. The server validates every explicit contact choice before any launch write, rejects foreign/deleted/unusable contacts without fallback, and stores the selected recipient on the outreach and immutable sequence recipient. Live/progressed sequences cannot change contacts through this selector.

Explicit outreach email wins; an invalid or Spot-owned explicit email blocks sending without substituting another recipient; otherwise contact roles rank submissions, general, underwriting, other, then claims/billing, with overlapping lines preferred within a role. No eligible recipient means no send.

## Durable execution

Sequences move from active to completed after the final step, stopped on lifecycle changes, or failed on terminal delivery errors. Any inbound reply first blocks sends in reply_check. A confident auto-reply with a confident negative unmonitored result resumes no earlier than one business day later. A confident unmonitored result stops; all other results, missing decisions and router failures hand off as responded. Manual handoffs schedule a `mailbox_attention` warning targeted only to the sending operator, using the existing notification delivery rules (email on by default for warnings) and linking to the operator request’s Outreach view. Client-scoped preference controls are not exposed in the operator console. Client members and client Slack never receive it. Bounces stop directly. A stale reply check times out to manual handoff.

Steps are scheduled, leased for sending, and then sent, captured, failed or cancelled. Drafts are persisted before sending. Inference start markers prevent automatic replay after an unknown generation outcome; a deterministic template can supply the fallback. Delivery retries reuse the saved draft and exact step idempotency keys. Unknown delivery can retry only within the provider's idempotency window (conservatively 23 hours); later recovery fails as delivery_unknown. Claims and finalization use lease fencing. Request closure, deletion, outreach status change or proposal filing cancels future steps.

Cadence suggestions use one Jev call with independent choices for count, business-day interval and style. Each field independently passes the shared confidence threshold or falls back to two follow-ups, three business days, brief nudge. Operator overrides remain explicit. Schedules skip weekends, respect effective-date/deadline cutoffs and a 30-day maximum, and derive subsequent due times from observed send time.

## Inboxes and ingress

One inbox belongs to each operator, named from the operator's email localpart on `PROVIDER_OUTREACH_EMAIL_DOMAIN`, with a first-name-at-Spot display name. Threads carry Spot automated and Needs reply labels. The dedicated `/resend-inbox-webhook` verifies Svix signatures with `RESEND_INBOX_WEBHOOK_SECRET`; inbox events never enter ordinary agent inbound routing. Email IDs deduplicate mirroring into procurement threads/messages. View thread opens the mirrored Spot Email view; a stable Resend dashboard thread URL has not been verified. The documented Inboxes API lists attachment IDs, filenames and sizes but provides no byte-download endpoint or MIME headers. Mirroring therefore retains attachment metadata and marks byte import unavailable; operators retrieve attachments in Resend. The existing procurement attachment helpers remain the integration boundary when a supported download API becomes available. Bounce detection uses documented sender metadata; multipart/report detection is unavailable without MIME headers.

## Setup and validation

1. Verify a dedicated Resend subdomain, including DKIM, SPF and receiving MX. Do not reuse the ordinary agent or research inbox domains.
2. Configure `AUTH_RESEND_KEY`, `PROVIDER_OUTREACH_EMAIL_DOMAIN` and `RESEND_INBOX_WEBHOOK_SECRET` on the intended deployment. Register the dedicated webhook for inbox.email.received and inbox.email.sent.
3. Verify the two outreach environment checks at `/agent-health`.
4. Run local capture workflows first. Capture makes no Resend calls and must not report real sent timestamps.
5. For authorized real inbox QA, use restricted delivery mode with an explicit test address/domain allowlist. Verify same-thread replies, signatures, attachments, manual dashboard sends and idempotent recovery before enabling unrestricted delivery.

The repeatable cases and observed results live in [provider outreach workflow QA](../testing/provider-outreach-workflow.md). A successful build does not establish live inbox delivery or Jev classification accuracy. No production deployment or external domain provisioning is part of local validation.
