# Operator team email

Operators share one inbox in Spot. Operator correspondence sends through the
existing Resend inbox on `TEAM_EMAIL_DOMAIN`. Full names and the `Name / Spot`
signature remain dynamic. Operator signatures contain the name, “Spot” and the current sending inbox address on separate lines, with no logo, image, custom font, size, colour or bolding. Both the text alternative and unstyled HTML use the same identity. The default production domain is `team.spot.insure`; isolated
development uses `team.dev.spot.insure`. Client agents retain their agent-domain
addresses. The shared command address is `agent@<TEAM_EMAIL_DOMAIN>`.

## Owners

| Concern | Owner |
| --- | --- |
| Names, localparts, reserved addresses, domain ownership, signature | `convex/lib/teamEmail.ts` |
| Provisioning and active/retired inbox records | `convex/lib/operatorInbox.ts`, `convex/operatorInboxes.ts` |
| Profile settings | `convex/operatorEmailSettings.ts` |
| Resend transport and delivery-mode enforcement | `convex/lib/resendInbox.ts` |
| Transport selection by inbox id (Resend, retired `gmail:`) | `convex/lib/mailboxTransport.ts` (`transportFor`) |
| Inbox id formats (`inboxKind`, the retired `gmail:` prefix) | `convex/lib/inboxIds.ts` |
| Inbox webhook ingress, event leases, routing and the team-thread mirror (sequence-owned events are applied in `convex/providerOutreach.ts`) | `convex/teamInboxEvents.ts`, `convex/actions/teamInboxEvents.ts`, `convex/lib/teamInboxEventLease.ts` |
| Aligned DKIM verification for command ingress | `convex/lib/dkim.ts` |
| RFC Message-ID spellings and address canonicalisation | `convex/lib/messageId.ts`, `convex/lib/emailAddress.ts` |
| Shared conversations, mirroring and attachments | `convex/lib/teamEmailStore.ts` |
| Inbox reads and projection | `convex/lib/teamInboxProjection.ts`, `convex/teamInbox.ts` |
| Sender identity and reply context | `convex/lib/outreachIdentity.ts`, `convex/lib/teamThreadReply.ts` |
| Client/request links and request files | `convex/procurementRequests.ts` |
| Operator drafts and exact send authorization | `convex/operatorEmailDrafts.ts`, `convex/lib/operatorEmailTools.ts`, `convex/lib/emailTools.ts` |
| Direct reply preview, approval and context | `convex/teamEmailReplies.ts`, `convex/actions/teamEmailReplies.ts`, `convex/lib/teamEmailReply.ts` |
| Delivery claims, recovery and immediate sent records | `convex/emailDeliveryAttempts.ts`, `convex/lib/operatorInboxSend.ts`, `convex/pendingEmails.ts` |
| Command ingress, DKIM, private command threads and responses | `convex/operatorEmail.ts`, `convex/actions/handleInboundOperatorEmail.ts`, `convex/lib/operatorEmailAuthentication.ts` |
| Receiving raw MIME and attachments | `convex/lib/receivingEmail.ts` |
| Authenticated forward matching and suggestions | `convex/teamEmailForwarding.ts`, `convex/actions/teamEmailForwarding.ts` |

The transport contains no operator naming policy. Profile changes reserve an
address before provisioning, and activation rechecks the reservation. A changed
localpart or domain creates a new inbox and retires the old record. Retired inboxes
remain known for existing replies. Capture mode makes no Resend call and stores no
fake inbox record. A full name is required before sending.

Always CC is one validated external address. It appears in the stored draft and
approval. It is never added secretly after approval. Operator mail has no personal
Reply-To; replies return to the shared mailbox.

## Conversations and authorization

`teamEmailThreads` is the common conversation record for ad hoc mail, forwards,
provider outreach and client information requests. Client and request links are
optional. `teamEmailMessages` records direction, the sending operator, provider
identifiers and attachments. `teamEmailThreadLinks` maps every observed Resend
inbox/thread pair to its shared conversation, including the primary inbox. An
operator owner id alone does not prove that their current inbox holds an older
Resend thread.

All active operators can read team mail. Client and provider accounts cannot.
Writes require direct operator access; impersonation remains read-only. Links use
the canonical client-file and request-file writers, validate live targets, and
cannot move mail between clients. Outreach conversations remain bound to their
originating request. Filing continuations recheck the link before each batch.

Unlinked attachments remain bounded storage references on the message until
linking files them. A repeated webhook must not delete storage already owned by a
file or draft. `teamInboxReads` tracks each operator's read position; only inbound
mail advances unread state. Bounded queries expose continuation or limit metadata.

Opened messages render their stored `bodyHtml` (`teamInbox.getMessageHtml`, loaded
per message) in a script-free sandboxed frame (`components/inbox/email-html-body.tsx`)
that drops active content and unsafe URLs and folds quoted history behind a toggle;
forwards keep it open. Quote containers and attributions the server parser misses
(`lib/email-quote.ts`: "… wrote:" lines with an address, time or year, Outlook
header blocks) also fold plain-text bodies. When none matches, each new inbound
message of six or more lines gets one Jev request (`convex/actions/teamEmailQuotes.ts`,
task `team_email_quoted_history`): a Noul for whether history is quoted and a
Choice for its first line, both at the proceed threshold. The line is stored as
`quotedHistoryStart` (null for a confident "no history") and the reader folds
there. Failures or uncertainty store nothing and the message shows unfolded. Ingestion records each part's MIME Content-ID (unfiled
`contentId`, filed `inlineFiles`) so `cid:` images resolve to their files and are
not repeated as attachment chips. Image attachments the HTML does not show inline
(signatures, logos) get one Noul each (`convex/actions/teamEmailAttachments.ts`, task
`team_email_decorative_images`) over name, type, size and the email text; those at the
proceed threshold are stored in `decorativeAttachmentIds` and hidden from the chips.
Confident verdicts are remembered per sender and content hash (`teamEmailImageJudgments`), so a repeated signature is never judged again. Failures or uncertainty keep every attachment listed. Attachments are listed above the body.

The reader styles each HTML body by kind (`lib/email-html-style.ts`, shared by the
server and reader). Conversational mail (a person's message, reply or forward) takes
the reader's font, size, colours and link colour in either theme, with the sender
client's inline presentation removed, quotes and forwards shown flush with a thin
rule, data tables (header cells, a drawn border, or a text grid) styled like the shared
`Table` while signature and layout tables stay as sent, and the frame transparent so
dark mode reads natively. Designed mail
(newsletters, receipts, notifications) renders as sent on white paper. Markup settles
most mail: client markers (Gmail, Apple Mail, Outlook, Thunderbird, Yahoo) or simple
untabled HTML are conversational; unsubscribe/browser links, `@media`, layout tables
and background images are designed. The rest gets one Jev request at ingest
(`convex/actions/teamEmailHtmlStyles.ts`, task `team_email_html_style`) with three
Nouls (written by a person, sent automatically, colours carry meaning) composed in
code at the proceed threshold. The verdict is stored as `htmlStyle` and remembered
per sender and markup signals (`teamEmailHtmlStyleJudgments`), so a sender's
same-shaped mail is never judged again. Failures or uncertainty store nothing and
the message renders as sent. Messages stored before classification are backfilled with
`npx convex run teamEmailHtmlStyleMigrations:run '{"fn":"teamEmailHtmlStyleMigrations:classifyExisting"}'`
(add `--prod` for production): it is resumable, skips mail the markup settles, and
spreads the remaining Jev requests over an hour.

The shared request and main Inbox use Inbox, Sent, All mail and Archived pill
tabs. Inbox contains conversations whose latest message is inbound; Sent contains
those whose latest message is outbound, so a new reply returns a conversation to
Inbox and an operator response moves it to Sent. All mail retains both directions
and legacy threads without direction metadata. Archived remains separate. Five
direction/scope indexes keep incoming mail reachable after large outbound batches
without scanning past sent mail. Secondary filters still narrow bounded pages.
Mailbox and main-inbox ownership scope are URL-backed and followed; opening or
closing a reader retains them. Readers remain open when live activity changes the
list. Provider outreach rows use the provider name instead of generic contact
labels; search includes that name. Unread styling and the existing needs-reply
projection distinguish incoming conversations requiring attention. Pending or
captured client sends appear only in Sent and All mail.

The inbox webhook verifies Svix before recording work and rejects inbox ids not
recorded by this deployment. Routing checks the command inbox separately, then
sequence ownership, a known conversation, an inbox/thread link, and a sent message
binding before creating unlinked mail. New mail and sent-event recovery converge
on the provider email id. Legacy procurement forwarding continues to ingest into
the same team tables.

## Sending and recovery

Every operator-agent and MCP email starts as a chat draft (`save_email_draft`)
that operators can edit in the shared composer before `send_email_drafts` or the
composer's Send. A reply is a draft linked to its conversation (reply-all
recipients, `Re:` subject, threading and quoted history from the thread); a
client information request is a draft with `clientOutreach` that launches the
request's client sequence on send. Follow-ups are stored on the draft and start
on send. The retired `reply_email_thread` and `send_procurement_client_email`
names only save these drafts. An agent approval of a send binds
`operatorDraftSendFingerprint`: the draft fingerprint plus its follow-ups and
client request link. With approve-all on, the draft sends as soon as it is
approved automatically.

Web, channel and operator MCP callers use the current operator identity; in the
web app a reply, new email or agent chat draft can instead be sent as any active
operator with a team address (`fromUserId`), signed as them, with the clicking
operator recorded as the approver. An ad hoc
draft needs no client; attaching a client file or policy requires an exact client
first. Updating a draft keeps its sender unless an operator or the agent picks
another (`fromUserId`), re-signs it, and invalidates its previous approval. Tenant send APIs, client review links and scheduled client sends
reject operator drafts.

An exact approval binds the complete payload, signer, From, Always CC snapshot,
attachments and conversation links. Any active operator may approve sending as
the signer, in the web app or through an agent or MCP confirmation; the approver
is recorded on the approval. A durable
claim locks the draft before external work, and a final transaction rechecks the
active operator, run, target and approval immediately before sending. Inbox draft
and send keys include the full content fingerprint. A known delivered message is
recorded locally before the draft becomes sent; recording failures retry without
another delivery. Unknown send outcomes stay locked while bounded read-only
reconciliation looks for positive delivery evidence.

A reply uses the replier's inbox. When the latest message has no replyable mapping in that inbox, the approved message is a standalone `Re:` with quoted history and
the owner copied. Its new Resend conversation is linked to the same Spot thread.
Browser replies store the exact message and context before sending and retain their
idempotency key across reloads. A different message cannot reuse that key. An unbound
sent mirror is never treated as a message in the primary Resend thread. Unknown write
timeouts and server failures stay locked. Replying stops live automated follow-ups
through indexed conversation pointers, including retired inboxes. New emails composed in the
Inbox follow the same protocol under a `compose:` key: `composeTeamEmail` builds the
exact draft (one To, Cc/Bcc, optional client link, Always CC, signature) and its
fingerprint, the approval accepts a compose draft only without a conversation, and the
sent mirror creates the conversation. Spot system addresses are refused as recipients. Provider and client sequence behavior is
described in [provider outreach](provider-outreach.md). Outreach launch reviews From
and Always CC and binds a sender fingerprint. Identity changes hold the initial send;
only its sender can approve a new identity. Drafts with an attempted send cannot be
replaced while their outcome is unresolved.

## Command email

The runner tells both tool-family selection and response generation that the
final answer is delivered automatically to the authenticated operator. A request
to reply in this conversation needs response prose, not a separate saved draft.
Explicit requests to prepare or send another email still use the existing tools
and authorization checks. A no-change request excludes saved drafts.

The `kind: agent` inbox is separate from team correspondence. It maps Resend thread
ids to private operator agent conversations and requires the same operator on every
message. Original MIME comes from the Receiving API. Authentication requires an
aligned, valid, full-body DKIM signature covering protected routing headers; text
claiming authentication is never trusted.

Only a confirmed absence of raw MIME permits the read-only fallback. Explicit
signature failure, malformed or mismatched mail is rejected; network and DNS
outages remain retryable failures. Read-only runs can read and answer, but cannot
save drafts, execute writes, send business mail or call external MCP. The flag is
bound to the run, preserved across continuation, and checked at selection and every
execution boundary. Unauthenticated mail cannot supersede a live authenticated
request. Its unverified Message-ID never controls cross-transport deduplication.

Responses use an explicit To of the resolved operator's verified login address,
never an unverified Reply-To or CC. Stable reply-draft and send keys prevent a retry
from switching delivery strategies. Email text cannot approve exact writes. Legacy
`operator(+thread)@` addresses retain DKIM authentication on supported agent domains.

## Cutover and release

The legacy `procurementEmailThreads` and `procurementEmailMessages` schema,
copy/adoption code, migration functions, and mapping fields are removed. All
readers and writers use the team tables, including outreach reply classification.
Procurement forwarding addresses and tool argument aliases remain supported, but
only team-thread IDs resolve. Existing extraction rows own their stable source
references, preserving fingerprints and company-wiki provenance after removal of
the migration fields.

Production migration and complete readback passed on 2026-10-23 before this
cleanup. Hosted development was not verified in that rollout. A deployment with
unmigrated legacy data must use the pre-cleanup revision to migrate it and clear
the retired mapping fields before upgrading. Removing a table from Convex schema
does not purge its stored documents.
Agents do not deploy; production changes run through CI.

Each environment needs `AUTH_RESEND_KEY`, `TEAM_EMAIL_DOMAIN`, and
`RESEND_INBOX_WEBHOOK_SECRET`, verified sending/receiving DNS, and a webhook for
`inbox.email.received` and `inbox.email.sent`. `PROVIDER_OUTREACH_EMAIL_DOMAIN` is a
compatibility fallback. Provision the command inbox through
`actions/handleInboundOperatorEmail:provisionAgentInbox` only after configuration.
Check `/agent-health` and known inbox records before enabling the webhook.

## Capacity and testing

Resend documents three included inboxes; more need its account overage setting
([account limits](https://resend.com/docs/knowledge-base/account-quotas-and-limits)).
Account capacity must cover one inbox per operator plus the command inbox, allowing
for retired inboxes.

The repeatable local acceptance cases and actual outcomes belong in
[team email workflows](../testing/team-email-workflows.md) and the
[workflow ledger](../testing/workflow-qa.md). Use capture first, then isolated
restricted delivery with an explicit allowlist. Never test through Vercel previews.


## Retired Google sender rollout

On 2026-10-27 operator sending returned to Resend. The operator’s saved team
localpart and `TEAM_EMAIL_DOMAIN` select the sender, without consulting Google
connections. Profile uses the original Team address controls. `/operator/email-health`
redirects to Inbox; the Google connect, default-sender and resume APIs and SMTP
implementation are removed. The `spot-mailer` dependency is removed.

The existing `operatorSendingMailboxes`, `operatorMailboxHealth`,
`operatorMailboxDrafts` and `operatorEmailPlacementChecks` tables remain compatible
with stored production data. They are not sending configuration. Existing encrypted
connections support only read-only IMAP sync for replies to already-sent Spot mail
and positive Sent-folder reconciliation of unresolved single-recipient drafts.
The two-minute legacy reply sync remains; it does not send mail or import unrelated
mailbox traffic. No schema/data migration or credential deletion is needed.

`mailboxTransport.ts` rejects create, send and reply attempts for `gmail:` inbox IDs.
Historical Google reads remain available, and unknown sends remain locked instead
of being replayed via Resend. `googleMailboxTransport.ts`'s `readGoogleDraft` is
kept only so unresolved legacy attempts can still be reconciled; nothing creates
`gmail:` drafts any more. Old Google inbox records stay known for inbound mail;
ensuring the operator’s Resend inbox reactivates its prior record and retires the
Google inbox. Reply planning excludes retired Google senders and uses the existing
cross-inbox quoted reply behavior where necessary. Existing approved initial
outreach and saved drafts retain their identity checks; the switch never authorizes
a send under a different From address. Already-sent messages and shared inbox
history are retained.

This restores transport, not the reputation or placement of the Resend sending
domain. Instantly campaigns and warmups are not changed by this rollback.
