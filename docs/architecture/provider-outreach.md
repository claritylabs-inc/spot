# Automated provider outreach

The procurement request Providers view matches the provider directory against the request's accepted application, drafts, or typed company facts. Direct operators can send immediately to one eligible provider or all matched providers. The manual outreach tracking operation alone never sends an email.

## Ownership and authorization

`convex/providerOutreach.ts` owns panel reads, launch, stop, claims and durable state. `convex/actions/providerOutreach.ts` owns generation, sending and reply classification; inbox setup, the inbox webhook ingress, event leases and routing, and the mirror of mail that no sequence owns are in [Operator team email](team-email.md) (`convex/teamInboxEvents.ts`); `convex/providerOutreach.ts` applies the events that route to a sequence. `convex/lib/providerOutreachMatch.ts` owns appetite matching and recipient selection; `coverageLobMapping.ts` shares ACORD mappings with requirement prefill. `providerOutreachSchedule.ts` owns business-day scheduling. `resendInbox.ts` is the Resend transport and enforces delivery mode independently of ordinary email sending.

All browser writes require a direct operator. Operator tools use the same domain writers, with exact approval for external sending. Execution rechecks request, provider, recipient and sequence state; client access and impersonation do not grant send authority. Provider contact selection rejects Spot-owned identities. Each sequence gets a per-outreach packet link using the existing packet primitive. Request-wide link rotation leaves scoped links intact; packet access remains governed by existing token and released-file checks.

## Request navigation

The Providers page reads matching candidates directly and shows only providers that fit the request. The navbar has Add provider (manual tracking record, no email). Unknown-fit and excluded providers are listed under a collapsible "Other providers" group with their reasons; unknown fit can be sent individually, excluded cannot. Contacted rows show one line of follow-up state (next follow-up and count, replied, finished, stopped or failed with reason). Existing outreach/proposal records share that same table with new matching providers. Contacted rows appear once, retain the recorded recipient and current outreach/proposal status, and expose View thread and View details in the actions column. Stop follow-ups lives in the View details sidebar footer, subscribes to the current sequence, and uses the existing stop mutation; it is hidden for read-only or finished outreach. The Status column omits sequence schedule/count summaries, and the table has no repeated Providers heading. Existing outreach remains visible even if the provider no longer matches or is absent from the bounded directory result. New candidates show Not contacted; the navigation count includes the combined list. Matching itself creates no outreach records or emails.

Follow-up cadence is a separate left-menu item immediately beneath Providers, routed through `?view=cadence`. Cadence choices save on change (`providerOutreach.saveCadenceOverride` into `procurementOutreachCadences.overrides`), win over Jev picks, survive re-suggestion, and also seed the client email composer's follow-up defaults. Chosen contacts remain request-scoped controller state used by Send/Send-all. The cadence page reuses the same inline row-card/select controls; there is no additional settings store or migration.

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

Locations, property addresses and workers-compensation jurisdictions supply geography, with mailing address before registration fallback. Country codes are ISO2 and US/Canadian regions use the existing provider region codes. Country-only US/Canadian appetite is unknown unless nationwide service is explicitly recorded. State/province exceptions override nationwide service. Every recorded request location must be serviced: any excluded location excludes the provider, while unresolved locations remain unknown fit. Partial matches refer only to coverage lines, never service areas. Hidden follow-up answers do not supply geography. Zero covered lines excludes a provider. Missing appetite is unknown fit. An undetermined request dimension is skipped and named in the empty Providers table; the From and Always CC show in the composer, not as a separate box. Do-not-contact (`blacklisted`) providers remain excluded. The first email to a new (`prospect`) provider moves it to inactive relationship (`inactive`, contacted without a reply); operators can change it back. `brokerProfileMigrations:markContactedProspectsInactive` backfills new providers that already had a sent outreach. Unknown-fit providers require explicit individual selection and are excluded from send-all.

Manual Auto-add and automated outreach share `brokerAreaFit` and the all-locations requirement, along with shared code aliases and geography normalization. The Providers view uses the shared Table and OrgBrandIcon primitives, with Provider, Contact, Coverage and Status columns. Geography remains a matching condition rather than a repeated column chip. Stored organization logos take precedence over the existing website favicon/initials fallback. The Contact column is an inline Select of current external provider contacts; options include email, recorded coverage preferences and short notes. Operator choices are request-scoped composition state and apply to individual Send and Send-all. The server validates every explicit contact choice before any launch write, rejects foreign/deleted/unusable contacts without fallback, and stores the selected recipient on the outreach and immutable sequence recipient. Live/progressed sequences cannot change contacts through this selector.

Explicit outreach email wins; an invalid or Spot-owned explicit email blocks sending without substituting another recipient; otherwise contact roles rank submissions, general, underwriting, other, then claims/billing, with overlapping lines preferred within a role. No eligible recipient means no send.

## Durable execution

Sequences move from active to completed after the final step, stopped on lifecycle changes, or failed on terminal delivery errors. Any inbound reply first blocks sends in reply_check. A confident auto-reply with a confident negative unmonitored result resumes no earlier than one business day later. A confident unmonitored result stops; all other results, missing decisions and router failures hand off as responded. Manual handoffs schedule a `mailbox_attention` warning targeted only to the sending operator, using the existing notification delivery rules (email on by default for warnings) and linking to the request Inbox conversation for replies (delivery failures retain the Providers destination). Client-scoped preference controls are not exposed in the operator console. Client members and client Slack never receive it. Bounces stop directly. A stale reply check times out to manual handoff.

Steps are scheduled, leased for sending, and then sent, captured, failed or cancelled. Drafts are persisted before sending. Inference start markers prevent automatic replay after an unknown generation outcome; a deterministic template can supply the fallback. Delivery retries reuse the saved draft and exact step idempotency keys. Unknown delivery can retry only within the provider's idempotency window (conservatively 23 hours); later recovery fails as delivery_unknown. Claims and finalization use lease fencing. Request closure, deletion, outreach status change or proposal filing cancels future steps.

Initial provider emails use a deterministic company-first layout: “Hey” plus the
contact's first name (or provider company for missing names and shared routing
labels),
an explicit quote request naming all requested coverage lines and the company,
bounded business bullets, the secure application URL, a short invitation for
further questions, and the authenticated operator's name, Spot and sending address.
A small “What's Spot?” explanation and Spot.Insure link follow the signature in
both initial emails and follow-ups. Packet URLs retain the existing revocable
capability route; no public company-name alias is introduced. Subjects and
follow-ups use the company name rather than the applicant's personal name.
`providerOutreachSummary.ts` projects published business activities, city/region,
year established, revenue with its reporting period, all requested coverage lines
(including custom coverage, known limits and scope), current insurance, claims and
cancellations as distinct facts, and answered below-ground-work information.
Commercial auto summaries also retain up to three vehicle year/make/model descriptions.
Other supplementary answers remain in the linked application instead of a long
questionnaire in the email. No personal contact details or street addresses are
added to these summaries; the authorized packet's contents and access do not change.
Draft answers, internal notes, identifiers and file contents are not summary inputs.
Values are bounded and HTML-escaped; HTML and plain text carry equivalent facts.
This layout is the request's default mail-merge template
(`defaultProviderEmailTemplate`); the greeting, introduction and application link
are merge variables.

## First-email composer and mail merge

Send and Send to all matched open the provider email composer
(`components/procurement/provider-email-composer.tsx`) built from the shared
compose fields: From picker, To (provider contact select, or one pill per provider
for a mail merge, each removable and previewable; every provider contact pill shows the provider's logo and the contact's name, address on hover), fixed Always CC, Subject, the
reply editor with merge-variable chips and `[needs: …]` blanks, the sender
signature, and the shared send bar and Follow up control from `components/email/email-composer.tsx` (request cadence or custom). Preview opens the exact merged email in its own panel beside the composer (`previewPanel` shell slot, desktop; inline below lg), with previous/next for a mail merge. In a mail merge, the preview panel is always editable and changes only that provider's email (pencil on its pill; "Use the template" in the panel footer reverts): the edit is saved as that provider's draft (`providerOutreachDrafts.saveEdit`, source `operator`) so the AI panel reads and revises it, and launches pass it as `overrides`, which win over the template and are covered by the plan fingerprint. Every
email goes to one provider; a mail merge never puts several providers on one email.

`convex/lib/providerOutreachMerge.ts` owns the variables (`{{first_name}}`,
`{{provider}}`, `{{company}}`, `{{introduction}}`, `{{sender_first_name}}`,
`{{application_link}}`), merging, validation and rendering. `planProviderLaunch`
in `convex/providerOutreach.ts` is the one plan behind the composer preview
(`providerOutreach.previewLaunch`), the agent approval card and the launch: it
classifies each provider, merges its email and fingerprints the sender identity,
cadence, recipients and every merged subject and body. `launch` refuses a changed
fingerprint. The merged email is stored on the sequence (`message`), and the
first step renders it with the provider's packet link and signature
(`renderProviderEmail`); follow-ups are unchanged. Sequences without `message`
keep the deterministic composition.

`providerOutreachDrafts` holds Spot's drafts: one per provider and one request
template (no `brokerOrgId`). Opening the composer for one provider asks Spot's
drafting model once to tailor the template for that provider
(`actions/providerOutreachDrafts.tailor`, route `email_draft`, task
`procurement_outreach_initial_tailor`): only the lines it writes, its saved
submission standards and the application facts that answer them, keeping the
merge variables. Failed or unknown outcomes are never replayed; the template stays.
The AI panel reads and writes the same drafts with `get_procurement_provider_emails`
and `update_procurement_provider_emails`, and the open composer pushes a
`provider_email_draft` page context. Composers adopt a new draft while unedited
and otherwise offer "Replace yours".

Cadence suggestions use one Jev call with independent choices for count, business-day interval and style. Each field independently passes the shared confidence threshold or falls back to two follow-ups, three business days, brief nudge. Operator overrides remain explicit. Schedules skip weekends, respect effective-date/deadline cutoffs and a 30-day maximum, and derive subsequent due times from observed send time.

## Team inbox and request mail

Operator identities, transport, shared conversations, forwarding, attachments, command email and migration are documented in [Operator team email](team-email.md). Outreach uses the same person's team address as ad hoc mail, signs with their full name and Spot, and snapshots Always CC into the stored step draft. Current identity and recipient checks still run before sending.

`teamEmailThreads` and `teamEmailMessages` are the canonical mail records. The request Email tab renders the shared inbox component with a request scope; `/operator/inbox` also includes unlinked and client-only conversations. Both surfaces open the same reader and files. Conversations created by outreach remain locked to their originating request because their sequences and packet links are request-bound. Other linked conversations may move only within the same client through the canonical audited writer.

A reply sends from the replying operator's own inbox. Replies from another operator copy the conversation owner and preserve one team conversation through `teamEmailThreadLinks`. Explicit replies stop live follow-ups. The navbar forwarding action uses the current operator's team address; legacy request forwarding addresses remain an inbound fallback.

## Setup and validation

Configure `AUTH_RESEND_KEY`, `TEAM_EMAIL_DOMAIN` and `RESEND_INBOX_WEBHOOK_SECRET` for the intended environment. `PROVIDER_OUTREACH_EMAIL_DOMAIN` is a compatibility fallback. Use separate verified development and production team domains and register the dedicated inbox received/sent webhook only after its matching secret and route are ready. Unknown inboxes are rejected before routing.

Run local capture workflows first, then authorized restricted delivery with an explicit recipient allowlist. Capture makes no Resend calls. The isolated development spike verified Receiving raw MIME, aligned DKIM and attachment bytes for a real inbox email; actual Gmail forwarding remains a separate workflow. See [team email workflows](../testing/team-email-workflows.md) and the [coverage ledger](../testing/workflow-qa.md) for observed results. Production deployment and migration are separate release steps.

## Client information requests

The same sequence machinery sends operator emails to the client. A client sequence (`audience: "client"`) has no outreach, provider or packet link; its first step's draft is the operator's exact subject and message with a greeting and signature, and follow-ups are deterministic nudges replying on the same thread. Recipients are current client portal members and the request applicant, excluding Spot-owned addresses; launch and every send re-check that list. One live client sequence per recipient per request. Request closure or deletion, a recipient change, an operator reply or Stop follow-ups end the sequence; any client reply hands off exactly like a provider reply (`client_replied`). Mirrored conversations are `category: "client"`, and reply attachments become request files through the existing mirror. Composer: Inbox navbar **Email client**. Agent/MCP: `list_procurement_client_outreach`, `send_procurement_client_email`, `reply_procurement_email_thread`, `stop_procurement_provider_outreach`.


## Conversation follow-ups

The same machinery nudges after an operator's reply on any team conversation (`audience: "thread"`). The composer's Follow up toggle (off by default; schedule "Spot picks" or a custom count and interval) is stored on the reply draft and started only after the reply is recorded as sent. The reply is step 0; follow-ups reply-all on the sender's inbox thread, waiting for the thread id of a reply sent as a new email. Jev picks the cadence when the operator did not (defaults on low confidence or failure) and, per nudge, whether the fixed nudge suffices or the specific ask should be restated by the model; validation failures and router errors use the fixed nudge. Sequences stop on any human reply, conversation archive or deletion, the usual sender identity holds, and the 30-day span. Replies are mirrored by the team path and then held for Jev classification exactly like outreach replies; no request-scoped handoff notification is sent.

## Insurance provider email copywriting rules

- Be concise and direct: short paragraphs, plain language, no filler.
- For Cold providers, explain that the client hired us at Spot to help buy their commercial insurance; use the actual sender's name.
- For Active Relationships, go straight to the quote request.
- Use we, us and our for the coordinated client request.
- Greet the human contact by first name, with the provider company name as fallback.
- Put every requested coverage line and known limit in the quote-request sentence.
- Use factual bullets for the business, location, operations, revenue, coverage and relevant history.
- Make the application link obvious and explain that clicking it opens more information and documents.
- Ask for a quote directly; providers can tell us what further information they need.
- Avoid excessive politeness: no kindly, just checking in, apologies for following up, please or repeated thanks.
- Keep brief nudges exact: Following up on our earlier request for {company}. Could you let us know if you can quote us or if there's more information needed?
- Stop automated nudges when someone replies.
- Use the actual sender's signature, with the general Spot explanation below it.
- Never email Do Not Contact providers.
