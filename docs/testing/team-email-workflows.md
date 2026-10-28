# Operator team email workflows

Use the local Conductor stack on Node 24 with `EMAIL_DELIVERY_MODE=capture`.
Verify `.env.local` selects `127.0.0.1` before opening Chrome. Start the backend
only through `npm run conductor:dev`; unset both inherited Convex deployment
keys for every other CLI command. Never use Vercel previews or production data.

Use two synthetic active operators, Terry QA and Amy QA, in separate Chrome
profiles. Sign in through email OTP capture and normal second-factor enrollment.
Create two synthetic clients, requests, a provider contact, and a small attachment
whose bytes are known. Record fixture IDs in gitignored `.context/qa/team-inbox/`.
Include team threads/messages, file associations, a sequence, an extraction with
an established source reference, organization fact provenance, and pending drafts.

## Workflows

1. **Profile identity.** Open Profile, set a full name and an available team
   localpart, and save an allowed external Always CC through ordinary autosave.
   Reload and verify all values and the command address. Try reserved and already
   owned localparts, malformed CC and Spot-owned CC; errors must preserve editable
   input. Change the localpart and verify the previous real inbox remains retired
   and routable. Capture mode must never persist fake Resend inbox IDs.
2. **Ad hoc draft and send.** In operator chat, draft an email without a client.
   Verify From, CC, signature, body and attachments in the single draft card.
   Approve the exact email and verify it appears in the team inbox with person
   attribution. Reload both views. Change a draft after approval and ensure the
   old approval cannot send. A legacy draft must be blocked until revised.
   Exercise restricted-delivery rejection without losing the draft.
3. **MCP identity.** Use an operator-scoped token for each synthetic operator to
   draft the same request. Verify each token's own sender and signature. Tenant
   tokens cannot discover or send these drafts. A read-scoped operator token
   cannot invoke drafting or linking tools. Never record tokens in artifacts.
4. **Procurement email.** Send a captured provider sequence and client information
   request, then ingest their replies. Verify each conversation appears in the
   request and team inbox, shares the same messages, stops automated follow-ups
   when answered, and retains request-specific attachments and activity.
5. **Two operators.** Terry opens a thread; Amy sees his avatar. Amy focuses the
   composer; Terry sees the replying indicator. Hide Amy's tab and confirm it
   clears promptly. Amy replies with her own From, Terry CC and quoted history.
   Verify one shared thread across both Resend-thread mappings, exact approval
   for the full recipient set, and no duplicate after the sent webhook arrives.
   Reject an approval by someone other than the draft sender. Confirm shared
   unread counts are per person and outbound messages do not create unread mail.
6. **Forward and link.** Ingest an authenticated synthetic forward from Terry's
   login alias to his team address. A unique participant/request match links and
   files its attachment. Multiple plausible requests invoke the routed Choice;
   uncertainty leaves an unlinked thread and suggestion. Accept the suggestion,
   then verify the canonical file and request association. Exercise client-only
   linking, conflicting targets, locked outreach threads, and a changed target
   during attachment continuation. An unknown inbox must never create records.
   Legacy procurement forwarding must continue to ingest. A synthetic Gmail-style
   block does not establish coverage of actual Gmail forwarding.
7. **Command email.** A verified command to the configured agent inbox creates a
   private operator conversation keyed by Resend thread ID. A second email reuses
   it and receives a response from Spot. Send “Reply with team email check complete.
   Do not change anything.” Verify the exact response and no saved draft or other
   business write. Separately request a draft to a named test recipient and verify
   that explicit drafting still works. Known agent mail must not enter the team
   inbox. Unavailable raw MIME limits the run to reads and reply prose; every
   attempted write, send and external MCP call remains blocked after resume.
   An explicit DKIM failure is rejected, never downgraded. Replies must not leak
   data to an unverified Reply-To. Legacy operator addresses remain authenticated
   and routable across supported agent domains.
8. **Team storage and authorization.** Verify file associations, outreach reply
   classification, notifications and extraction use team IDs only. Retain an
   existing extraction source reference and applied fingerprint when claiming an
   unchanged conversation; new mail must still trigger extraction. Old storage
   IDs must not resolve or gain write authorization. Client/provider accounts
   cannot access team mail; impersonating operators cannot change it.

9. **Connected Gmail.** Run the cases in
   [operator Gmail workflow](operator-gmail-workflow.md); Gmail threads, CC
   copies and sends must stay in the shared team inbox with the Gmail marker.

For the profile, inbox, reader, linking action and draft card, exercise keyboard
navigation, a narrow viewport, light and dark themes, and loading, empty and failed
states. Unsent reply text must survive a failed send and switching conversations
but not a reload. A locked send must survive a reload until the server reports its
outcome. Ordinary edits need no save mode.

## Live integration prerequisites

Use only isolated `team.dev.spot.insure` inboxes and an explicit recipient allowlist
after capture workflows pass. Confirm the webhook belongs to this deployment,
its signing secret is installed, and test operators' inboxes are recorded locally.
Use bounded synthetic mail and byte-compare the received attachment. Record actual
Gmail forwarding separately when an authorized Gmail sender is available. Do not
activate production delivery or run production migrations as local verification.

## Evidence and cleanup

Record each outcome in `docs/testing/workflow-qa.md` with screenshots, browser
traces and readback JSON paths under `.context/qa/team-inbox/`. Never include OTPs,
cookies, signed download URLs or credentials. Use Passed only for the actual
workflow; distinguish failure, blocked prerequisite and not run. Remove temporary
allowlists/webhooks and test inboxes after the run, retain useful synthetic local
fixtures, and restore capture mode. Do not remove filed storage during cleanup.
