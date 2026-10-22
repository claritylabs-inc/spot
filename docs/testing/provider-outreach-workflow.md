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
| Matching and cadence | Not run | Implementation in progress |
| Capture launch and dedupe | Not run | Implementation in progress |
| Authorization and lifecycle | Not run | Implementation in progress |
| Real inbox send/reply/mirroring | Not run | Requires verified domain/webhook and authorized test recipient |
| Recovery and unknown outcomes | Not run | Implementation in progress |
| Rendered UI | Not run | Implementation in progress |
