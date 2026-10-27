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
| Transport selection by inbox id (Resend, connected Gmail, retired `gmail:`) | `convex/lib/mailboxTransport.ts` (`transportFor`) |
| Inbox id formats (`inboxKind`, `google:`/`gmail:` prefixes, Gmail scopes and allowed domains) | `convex/lib/inboxIds.ts` |
| Connected Gmail OAuth, send and capture | `convex/actions/operatorGmail.ts`, `convex/lib/gmailTransport.ts`, `convex/lib/gmailSenderAuthentication.ts`, `convex/gmailInbound.ts` |
| Inbox webhook ingress, event leases, routing and the team-thread mirror (sequence-owned events are applied in `convex/providerOutreach.ts`) | `convex/teamInboxEvents.ts`, `convex/actions/teamInboxEvents.ts`, `convex/lib/teamInboxEventLease.ts` |
| Aligned DKIM verification shared by command ingress and Gmail own-copy proof | `convex/lib/dkim.ts` |
| RFC Message-ID spellings and address canonicalisation | `convex/lib/messageId.ts`, `convex/lib/emailAddress.ts` |
| From picker and compose helpers | `components/inbox/send-from.tsx` |
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

Web, channel and operator MCP callers use the current operator identity. An ad hoc
draft needs no client; attaching a client file or policy requires an exact client
first. Updating a draft re-signs it as the current operator and invalidates its
previous approval. Tenant send APIs, client review links and scheduled client sends
reject operator drafts.

An exact approval binds the complete payload, signer, From, Always CC snapshot,
attachments and conversation links. The approver must be the signer. A durable
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


## Connected Gmail

An operator can connect one Google Workspace Gmail account by OAuth as a second
account beside their Resend team inbox `<localpart>@team.spot.insure`. The Inbox
stays unified: Gmail-related conversations are shared team mail like any other, and
threads and messages involving a connected Gmail carry `gmailAddress` (shown as a
Gmail badge in the list and "via Gmail" in the reader). A connected Gmail's inbox id
is `google:<address>`, distinct from the retired `gmail:` ids below.

**Connection.** Profile → Gmail starts the flow (`actions/operatorGmail:start`, a
PKCE authorization-code flow modeled on the operator MCP OAuth); the callback is
`/operator-gmail/oauth/callback` and redirects to `/operator/profile?gmail=…`. The
Google app is Internal, so only accounts in the organization can consent, and the
callback additionally requires the verified address and hosted domain to be in
`GOOGLE_MAILBOX_ALLOWED_DOMAINS`. Scopes are `openid email gmail.send
gmail.readonly`. `gmail.readonly` finds a Gmail thread or message by `rfc822msgid:`
(threading replies, reconciling an unknown send) and reads the Gmail threads bound to
Spot conversations (see Thread refresh below); Spot never reads other mail. Each
operator has one connection, and an address belongs to one operator. The refresh token is encrypted with
`EMAIL_CONNECTIONS_ENCRYPTION_KEY`. Connecting is disabled in capture mode unless
`OPERATOR_MAILBOX_CONNECTIONS_ENABLED=true`. Revocation or `invalid_grant` marks the
connection `needs_reconnect`; a missing, `needs_reconnect` or disconnected
connection blocks Gmail sends with a visible error and never falls back to Resend.
Disconnect revokes the token at Google; stored mail is kept.

**Capture.** Mail enters in two ways: through the existing Resend inbox webhook when
the operator's team address is on To, Cc or Bcc, and through Thread refresh for
Gmail threads Spot already holds. A received email whose From is a connected Gmail is the
operator's own outbound mail (attributed to them, not something to answer) only when
the message is found in their Gmail Sent folder (an `rfc822msgid:` lookup, a single
immediate check) or its original MIME carries aligned DKIM; without that proof it
stays inbound. Any other received mail that names a connected Gmail on To/Cc is ordinary inbound mail
marked with `gmailAddress`. Copies deduplicate by RFC Message-ID against the stored
outbound message when Spot sent the original, and a copy waits briefly while its
send is drafted but not yet recorded. Replies and reply-all from external people
land in the same thread only while the team address stays on the recipient list.

**Sending.** In the Inbox, a reply or new email can be sent From either the Spot
team address or the connected Gmail. A reply defaults to Gmail when the thread's
`gmailAddress` is the caller's active connected address, otherwise to the Spot
address; a new email defaults to the Spot address. Gmail sends always add the
operator's own team address as a visible Cc so recipients' reply-all returns to
Spot. That Cc is part of the reviewed payload and approval fingerprint, never added
secretly, exactly like Always CC. Provider-outreach sequences and agent/MCP saved
drafts keep sending from the Spot team address through Resend.

**Thread refresh.** A reply that drops the team address (a plain Reply to the Gmail
user, or forwarding without it) still lands in the right Spot conversation, without
importing unrelated Gmail mail. Only Gmail threads *bound* to a Spot conversation are
ever read, through `teamEmailGmailThreads` (`threadId`, `connectionId`, `address`,
`gmailThreadId`, `nextCheckAt`, `checks`, `lastRefreshedAt`). It is separate from
`teamEmailThreadLinks`, whose rows feed Resend reply planning. A binding is made
when a Gmail send is recorded (`recordOperatorInboxSentInternal`, from the draft's
`gmailThreadId`), when a Resend copy that names a connected Gmail arrives for an
unbound conversation (a `rfc822msgid:` lookup in that Gmail; the found message must
be from the same sender as the copy), and for earlier sends by the one-off
`intakeApplicationMigrations:bindEarlierGmailSends` migration (run it once through the
migrations runner on the release target; it is idempotent and resumable).

`refreshGmailThread` (`actions/operatorGmailSync`) reads a bound thread with
`threads.get` in `minimal` format, skips drafts, trash, spam and anything older than
the conversation's first stored message (minus ten minutes), and fetches the raw MIME
of messages Spot has not stored. Stored means the key
`google:<address>:<gmailMessageId>` in `teamEmailMessages.resendInboxEmailId`: it
reuses an indexed field that already keys `gmail:` legacy and Resend ids, cannot
collide with them and needs no schema change on the large message table. Messages are
parsed with `mailparser` and mirrored through `mirrorTeamEmail` (at most 25 per
refresh, 10 attachments of 25 MB, inline images skipped, anything dropped named in the
text; oversized messages are stored as a stub). A message with the SENT label is the
operator's own outbound mail (`sentByUserId` the owner) and stops live automated
follow-ups like a reply sent from Spot; any other message is inbound and alerts the
team through the same notify path as Resend mail. `mirrorTeamEmail` treats a message
as a copy when its conversation already holds the same normalized RFC Message-ID from
the same From address, in either direction, so the Gmail and Resend paths deduplicate
each other; requiring the From stops a forged Message-ID from suppressing real mail.

*Triggers (no Pub/Sub needed).* After a Gmail send, one scheduled job per binding
checks at about +5m, +1h, +6h, +1d, +3d and +7d (`nextCheckAt`/`checks`; a newer send
restarts the schedule, and a daily sweep restarts a lost job). Opening a Gmail
conversation in the reader refreshes it when `lastRefreshedAt` is over five minutes
old. A Resend copy for a bound conversation refreshes it after 30 seconds.

*Push (Gmail `watch` + Pub/Sub).* With `GOOGLE_GMAIL_PUBSUB_TOPIC` set, connecting or
reconnecting calls `users.watch` for the INBOX and SENT labels and stores `historyId`
and `watchExpiresAt`; disconnect calls `users.stop`. Pub/Sub pushes to
`POST /operator-gmail/push`, which verifies the `Authorization: Bearer` Google OIDC token
(audience `GOOGLE_GMAIL_PUSH_AUDIENCE`, default `<CONVEX_SITE_URL>/operator-gmail/push`;
`email` must equal `GOOGLE_GMAIL_PUSH_SERVICE_ACCOUNT` and be verified). Missing or
invalid tokens get 401. Everything after that is 204 (which stops retries): unknown,
disconnected or needs-reconnect connections are ignored, and valid notifications
schedule `processHistory`. It takes a per-connection lease, lists `history.list`
(`messageAdded`) from the stored `historyId` one page per run, refreshes only the
threads that have a binding for the connection (other messages are never fetched), and
advances `historyId` monotonically after the last page. A daily cron
(`renewAll`) renews watches expiring within 48 hours (or never started) and runs one
catch-up per connection. Without a topic, watch and push are off and the triggers
above still work. Capture mode disables all of it.

*Failure modes.* `needs_reconnect` connections are skipped (a stop is attempted once
with the stored grant if a watch is recorded). 429 and quota errors reschedule with
backoff (honouring `Retry-After`, up to six attempts, then a note). A 404 from
`history.list` means the cursor expired: the cursor is reset from `getProfile`,
conversations active in the last 30 days are refreshed, and `syncError` says so.
`syncError` and `lastSyncAt` are returned by `operatorGmail.myConnection` and shown on
the Profile Gmail card; they hold fixed text, never provider messages. Tokens are never
logged.

**Setup (once per Google Cloud project/deployment).**

1. Enable the Gmail API.
2. Set the OAuth consent screen user type to Internal.
3. Add the scopes `openid`, `email`, `gmail.send` and `gmail.readonly`.
4. Create a Web application OAuth client whose redirect URI is
   `<CONVEX_SITE_URL>/operator-gmail/oauth/callback`, one per deployment.
5. Set the Convex env vars `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`
   and `GOOGLE_MAILBOX_ALLOWED_DOMAINS` (comma-separated domains). The existing
   `EMAIL_CONNECTIONS_ENCRYPTION_KEY` is reused.
6. Optional push: create a Pub/Sub topic, grant `gmail-api-push@system.gserviceaccount.com`
   Publisher on it, and create a push subscription to
   `<CONVEX_SITE_URL>/operator-gmail/push` with OIDC authentication (a dedicated
   service account, audience the same URL). Set `GOOGLE_GMAIL_PUBSUB_TOPIC` (the full
   `projects/<project>/topics/<topic>` name), `GOOGLE_GMAIL_PUSH_SERVICE_ACCOUNT` (the
   invoker's email) and, only if the audience differs from the URL,
   `GOOGLE_GMAIL_PUSH_AUDIENCE`. Existing connections get a watch at the next daily
   renewal, or immediately by reconnecting. The scopes are unchanged.

Manual QA is in [operator Gmail workflow](../testing/operator-gmail-workflow.md).

## Retired Google sender rollout

This section describes the retired app-password path (`gmail:` inbox ids,
`operatorSendingMailboxes`, IMAP); it is unrelated to the OAuth-connected Gmail
above, whose inbox ids are `google:<address>`.

On 2026-10-27 operator sending returned to Resend. The operator’s saved team
localpart and `TEAM_EMAIL_DOMAIN` select the sender, without consulting Google
connections. Profile uses the original Team address controls. `/operator/email-health`
redirects to Inbox; the Google connect, default-sender and resume APIs and SMTP
implementation are removed. Connected Gmail sends compose their MIME with plain `nodemailer` (the `spot-mailer` dependency is gone).

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
