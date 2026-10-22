# Provider outreach workflow QA

Actor: a direct operator signed in normally on the local app. Use the workspace's anonymous Convex backend and synthetic organizations only. No Vercel previews. Start with `EMAIL_DELIVERY_MODE=capture`; real delivery requires separately configured Resend domain, inbox webhook, and an explicitly allowlisted test recipient.

## Fixture and cases

Create a synthetic company-linked GL + cyber request with California and Ontario locations. Create providers with full appetite, partial lines/regions, empty appetite, primary-region mismatch, inactive/blacklisted status, no email, and Spot-owned contact email. Use existing provisioning and request primitives.

1. Open Providers. Verify Matched/Unknown fit/Excluded, partial reasons, selected recipient role/line ranking, and unknown-dimension banners. Change appetite and verify reactive movement.
2. Wait for cadence suggestion or documented default; override each select and verify schedule preview. Check deadlines, weekends, final flags and 30-day cap.
3. Send one matched provider in capture mode. Verify a scoped packet link and captured step; no network delivery, sentAt claim, or duplicate sequence. Send-all excludes unknown and unavailable recipients and reports counts. Reload.
4. Verify direct operator Stop and request cancellation/completion/deletion, outreach status change, and proposal filing cancel pending work. A client or impersonated operator cannot launch or stop.
5. With a verified restricted inbox, verify operator display name, packet view count, same-thread follow-up and Email-view mirroring. Human reply pauses immediately and hands off; OOO resumes no earlier than one business day; unmonitored/bounce stops. Duplicate and out-of-order webhooks do not duplicate records or resume stale checks.
6. Interrupt a send after provider acceptance. Verify recovery uses the same stored draft/key within 23 hours and fails unknown delivery after that window. A stale lease cannot finalize or start a new send. Router generation/decision unknown outcomes never replay.
7. Inspect desktop and narrow layout, keyboard controls, loading/empty/error states and light/dark presentation. Capture screenshots under `.context/qa/provider-outreach/`.

Cleanup: stop synthetic sequences, revoke synthetic packet links, and remove synthetic records through supported helpers. Keep credentials, OTPs and capabilities out of tracked artifacts.

## Evidence ledger

| Case | Status | Evidence |
| --- | --- | --- |
| Missing geography modal | Passed locally | Local Chrome normal OTP sign-in; blank country opens modal, GB has no state selector, Cancel preserves blank, US/CA save retries auto-add, reload retains geography. Missing property location corrected to Canada/Ontario; save retries successfully. `.context/qa/provider-outreach/geography-{dialog-empty,dialog-ready,saved-retry,property-mobile}.png` |
| Matching and cadence | Passed locally | GL + Property, California + Ontario fixture: appetite edit moved Lakeview reactively into partial match with explicit missing line/region chips. Empty-appetite provider remained Unknown. Jev style displayed Suggested; changing interval to five days updated preview and Edited provenance. Merged Auto add opened Provider matches drawer. |
| Capture launch and dedupe | Passed locally | Individual and send-all each captured step 0 once; active sequence removed from send-all count, unknown provider excluded. Readback: captured steps have attempt 1 and no sentAt; no operator inbox provisioned. Reinvoking sendStep on captured step returned skipped. |
| Authorization and lifecycle | Partial | Unauthenticated launch/cadence denied. Stop cancelled follow-ups and persisted after reload; both synthetic sequences stopped. Request closure/proposal and impersonation guards source-reviewed, not separately browser-exercised. |
| Real inbox send/reply/mirroring | Not run | Requires verified domain/webhook and authorized test recipient |
| Recovery and unknown outcomes | Partial | Captured-step replay skipped. Local ingress: unsigned 401, signed unknown event 200, malformed received 400, unowned inbox 200, oversized body 413. Lease races and real delivery unknown-outcome recovery source-reviewed, not fault-injected against Resend. |
| Rendered UI | Passed locally | Desktop, 390px mobile and dark mode inspected. Fixed cramped panel header and clipped mobile send-all. Screenshots: `matched-provider.png`, `captured-sequence.png`, `stopped-sequence.png`, `unknown-fit.png`, `panel-mobile-fixed.png`, `panel-dark.png`, `integrated-provider-matches.png` under `.context/qa/provider-outreach/`. |

All observations above used the local anonymous Convex deployment in capture mode, not a Vercel preview. No unit tests were added. Real inbox attachment mirroring currently retains metadata and an explicit notice; the documented Inboxes API supplies no verified attachment-byte retrieval endpoint. View thread opens the mirrored Spot Email view because no stable dashboard thread URL was verified. Synthetic packet links remain local-only.

Final integrated root TypeScript, full ESLint (zero errors, nine pre-existing warnings), and local Next.js build passed. Local Convex code generation also passed. Logs are under `.context/outreach/`.

## Request Inbox — October 22, 2026

Local Chrome at localhost:8080 with normal operator authentication and the anonymous Convex backend verified the single Inbox for forwarded mail and synthetic Resend mirror records. Conversations open in the standard app-shell right panel, with secondary classification and quote filing under Details. Mailbox address opens a toolbar popover; no address footer remains.

Passed: search/clear, Needs reply and Sent filters, keyboard selection, same-row selection, closing/reopening, reload/deep links, mobile without horizontal overflow, dark mode, 40-to-41 conversation pagination, and moving a forwarded thread between requests then restoring it. The old request clears its selection after reassignment. Backend probes verified unauthorized reads fail, mismatched request/thread reads return null, foreign threads stay excluded, Resend reassignment fails, stored outreach links determine filing context, and reader DTOs omit raw HTML.

Artifacts: `.context/qa/request-inbox/{desktop-inbox,mobile-reader,dark-reader}.png`, `browser-results.json`, and `.context/outreach/inbox-boundary-results.json`. These synthetic mirror records validate presentation and isolation, not live Resend delivery. No external emails, Vercel previews, production changes, or new unit tests were used.

## Inbox reader and replies — October 22, 2026

Local Chrome at localhost:8080 (anonymous Convex, capture mode). Opening a hovered conversation showed content without a spinner and the right panel never unmounted across clicks and arrow-key switches. The mailbox address copies from the navbar. Sending from the reply composer returned "captured locally"; no Resend call or mirrored message. Live reply delivery and Receiving-API attachment import remain unverified (no Resend inbox on the account). Artifacts: `.context/qa/inbox-v2/`.
