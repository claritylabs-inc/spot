# Operator team email

Operators share one mailbox in Spot. Each person sends from their own Resend
inbox on `TEAM_EMAIL_DOMAIN`, with their full name and the `Name / Spot`
signature. The default production domain is `team.spot.insure`; isolated
development uses `team.dev.spot.insure`. Client agents retain their agent-domain
addresses. The shared command address is `agent@<TEAM_EMAIL_DOMAIN>`.

## Owners

| Concern | Owner |
| --- | --- |
| Names, localparts, reserved addresses, domain ownership, signature | `convex/lib/teamEmail.ts` |
| Provisioning and active/retired inbox records | `convex/lib/operatorInbox.ts`, `convex/operatorInboxes.ts` |
| Profile settings | `convex/operatorEmailSettings.ts` |
| Resend transport and delivery-mode enforcement | `convex/lib/resendInbox.ts` |
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
through indexed conversation pointers, including retired inboxes. Provider and client sequence behavior is
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
