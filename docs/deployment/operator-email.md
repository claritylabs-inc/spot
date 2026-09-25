# Operator email and domain identities

Operators sign in using an address at `toolsforenlightenment.org`, `spot.insure`,
or `claritylabs.inc`. The normalized part before `@` identifies one person
across these exact domains: `terry@claritylabs.inc` and `terry@spot.insure`
share a user, permissions, and operator history. Each sign-in sends its OTP to
that actual mailbox. The primary stored email remains stable. Subdomains,
lookalike domains, and plus-address variants do not inherit another identity.

Existing customer accounts, organization memberships, disabled operators, and
multiple existing users matching the same identity prevent linking. This release
does not merge users, move history, or reactivate access. Resolve existing
collisions explicitly before those identities sign in. Existing roles remain
unchanged; new domain users receive operator access, with owner grants still
requiring the existing explicit owner configuration. `operator@` on all three
domains is reserved and cannot sign in.

## Conversation behavior

After signing in, an active operator can send or forward mail to
`operator@agent.spot.insure`. The adapter creates a private operator conversation,
stores supported attachments, and runs the same operator tool registry used by
the portal. Replies go only to the authenticated operator sender. Original To,
CC, BCC, forwarded participants, and Reply-To never expand the reply audience.

Spot replies from `Spot Operator <operator@agent.spot.insure>` with a thread-specific
`operator+<thread-id>@agent.spot.insure` Reply-To. Replying continues that owned thread,
including from another domain alias. A new email to the base inbox creates a new
thread. Subject lines never authorize or merge conversations. Generated files
are available through the authenticated operator-thread link in the response.

Write requests retain the registry's exact-confirmation policy. Email responses
link to the operator thread to approve or cancel there; replying with “approve”
is not an approval mechanism. A short confirmation reply such as “Yes approve
it” preserves the waiting run and exact approval and directs the operator to
the existing controls; it does not replace the task. A reply containing revised
instructions starts a replacement task as before. After a portal decision, the email delivery poll
continues to the next confirmation or terminal response. Human approvals have
no age-based expiration.

The portal separates the current message from quoted history and forwarded
source emails, rendering the latter in cards with readable headers and body
formatting. A forward nested inside a quoted reply remains history and is not
sent to the runner as a new instruction. Existing plain-text messages receive
card formatting where their stored text contains recognizable reply/forward
boundaries; quotes stripped before structured storage cannot be recovered.

Spot's sending address cannot authenticate as a human operator. The read-only `scan_workspace_mailbox` operator tool excludes mail from the Spot Operator inbox identity before returning mailbox evidence. Scheduled Workspace scanning is retired. Approval and completion notices are
separate expected deliveries, not evidence of another incoming task.

## Authentication and storage

`/resend-inbound` requires its Svix signature before routing operator mail.
Only the production webhook lane admits operator mail; the shared dev webhook
acknowledges these events without executing another task. The Node adapter retrieves the original MIME from the authenticated Resend
receiving API, verifies full-body DKIM with exact alignment to the sender's
operator domain, and requires signing of routing, message identity, and
threading headers. It never trusts an `Authentication-Results` header supplied
inside a message. Missing, ambiguous, unauthenticated, altered, or unavailable
original messages cannot execute an operator task.

Gmail can omit outer MIME interpretation headers from its signature. Signed
MIME headers retain normal decoding; unsigned outer MIME headers are ignored.
The adapter reconstructs multipart structure from delimiters in the authenticated
body, where inner attachment metadata is signed. Otherwise it uses UTF-8 plain
text, preserving unsigned transfer-encoded text in its original representation
instead of guessing how to decode it. Changing an unsigned boundary, charset,
encoding, or disposition cannot change the content passed to the agent.

Google Workspace must DKIM-sign mail for each of the three sender domains.
The route must preserve MIME and signed headers. Mailing-list rewrites or an
unsigned forwarding envelope cannot supply operator authorization; the outer
forwarding email itself must authenticate as the operator.

Raw MIME is bounded to 32 MiB. Attachments use the shared 25 MiB per-file
and 50 MiB aggregate intake limits within that raw-message ceiling, with no
file-count cap. Model processing still enforces the router's rich-asset and
serialized-request budgets after parsing and selection.
Long email bodies are preserved as an attached text file; short reply text and
forwarded evidence remain available to the agent. Storage IDs bind to the
private operator thread before the task is scheduled. Failed or duplicate
intake removes newly stored, unreferenced files.

`operatorEmailReceipts` atomically binds provider ID, signed message ID, operator,
thread, run, and original reply recipient. Replayed delivery and signed-message
replay cannot enqueue another run. Every delivery revalidates the active
operator and private thread. `operatorEmailDeliveries` stores a frozen response,
provider idempotency key, and two-minute abandoned-send lease. It permits at most
three claims. Failed delivery does not replay the agent task; its result remains
in the portal. Monitor failed delivery rows and action errors when diagnosing
missing replies.

## Production setup

The operator inbox is `operator@agent.spot.insure`. Resend receives directly on
this dedicated subdomain; no Google Workspace forwarding rule or paid mailbox
is needed. The root `spot.insure` MX stays with Google Workspace. Customer agent addresses also move to this subdomain: `agent@agent.spot.insure`,
`<workspace>@agent.spot.insure`, and their thread reply addresses. The three
operator login domains remain unchanged. Legacy inbound domain recognition
preserves thread matching when an old address still reaches the webhook; it
does not install a Google forwarding rule for mail sent to the root domain.
`convex/lib/operatorEmailAddress.ts` owns the inbox and thread reply addressing.

On 2026-09-14, Resend domain `3ee8b0d6-d06b-4918-b030-e1577da51d4b` was created
for `agent.spot.insure` with sending and receiving enabled and open/click tracking
disabled. Its five generated DNS records were published in Cloudflare: DKIM TXT,
SPF TXT and MX, the `rsend.agent` CNAME, and the receiving MX at `agent.spot.insure`.
All five records and the domain are verified for sending and receiving. The root
Google Workspace MX was left intact.

The existing production webhook `ed00bba2-8977-48c7-bf27-7e0b03a7cba3` is enabled
for `email.received` at `https://merry-platypus-82.convex.site/resend-inbound`,
which reaches the same deployment as `https://actions.spot.insure`. Reuse this
account-wide webhook; no separate inbox object or duplicate webhook is needed.

1. Confirm every DNS record for `agent.spot.insure` is verified in Resend.
   Keep the existing production webhook and root Google MX. Align Convex
   `AGENT_EMAIL_DOMAIN` / `AGENT_DOMAIN`, Vercel `NEXT_PUBLIC_AGENT_DOMAIN`, and
   the iMessage worker `SPOT_AGENT_EMAIL` with the new domain. The code also
   normalizes stale legacy domain settings.
2. Deploy the additive Convex schema/functions and frontend through the normal
   release workflow. Complete the operator identity backfill described below before enabling
   operator alias admission. Convex requires
   `AUTH_RESEND_KEY` with received-email read/send access and the existing
   production webhook's matching `RESEND_WEBHOOK_SECRET`.
3. Verify DKIM signing for each operator sender domain, then test a direct
   message, an attachment forward, and a reply from a second domain alias.
   Confirm all aliases resolve to the same operator, the reply stays private,
   the thread persists in the portal, and a write waits for portal approval.
4. Confirm a replay does not create another task and a disabled identity cannot
   enqueue or receive a result. Check the delivery ledger after a deliberate
   transport failure before enabling ordinary use.

Resend documents [receiving on a dedicated subdomain](https://resend.com/docs/dashboard/receiving/introduction),
[domain creation and capabilities](https://resend.com/docs/api-reference/domains/create-domain),
and [retrieving original messages](https://resend.com/docs/api-reference/emails/retrieve-received-email).

## Identity rollout and existing drafts

Before admitting operator aliases, run `migrations:runOperatorEmailIdentityBackfill`.
It pages existing users, operator profiles, and email auth accounts into indexed
reservations for mixed-case legacy addresses. It never changes primary email,
roles, or account ownership. Check `migrations:operatorEmailIdentityBackfillStatus`
until all three phases report `isDone`, then run
`migrations:finishOperatorEmailIdentityBackfill` and require `ready: true`.
Alias sign-in and operator email admission fail closed until completion; existing
portal sessions remain usable. Local seed setup and the production release
workflow run these steps automatically. The release script verifies all phases
and the persisted admission gate before release readiness. Administrative imports
of legacy records after completion require a controlled backfill rerun.

Stored customer thread addresses retain their history and resolve through indexed
legacy/new-address lookup. Frontend thread DTOs and new replies use the new domain.
Existing drafts with retired sender or Reply-To snapshots must be regenerated and
reviewed before sending. Their approved payloads and delivery history are not
rewritten. Human recipient addresses such as `terry@spot.insure` remain valid.
