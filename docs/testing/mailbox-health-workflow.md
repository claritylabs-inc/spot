# Dedicated mailbox delivery and health

Actor: authenticated operator without impersonation. Local target: localhost:8080,
local Convex 127.0.0.1:8083, EMAIL_DELIVERY_MODE=capture. Run: October 27, 2026.
No real messages sent. After explicit user approval, all five existing InboxKit
Google app passwords were connected through the local UI and stored encrypted.

## Acceptance workflow

1. Navigate through Email health; show the five reserved addresses, actual connection
   state, automatic sending defaults, and a local capture banner.
2. Search, clear, sort and switch Mailboxes / Sending activity / Placement checks.
   Empty searches explain that there are no matches. Enter activates a focused tab.
3. Without the explicit local connection opt-in, capture must refuse external
   access and save no connection. Closing/reopening clears the password. With
   `OPERATOR_MAILBOX_CONNECTIONS_ENABLED=true`, SMTP verification and IMAP reads
   are permitted; outbound delivery remains captured.
4. Record a clearly labelled local QA placement observation, then reload and
   verify persistence. Do not present synthetic local results as live placement.
5. Inspect light/dark and 200% browser zoom; verify the connection drawer remains
   usable at the narrow effective viewport. Restore system theme and 100% zoom.
6. Live rollout (separate external gate): verify real SMTP/IMAP access, pause/resume,
   quota scheduling, a real seed send, a reply with attachments and unknown-send
   reconciliation. Existing sender approvals must be reviewed after identity changes.

## Evidence ledger

| Workflow | Status | Evidence |
| --- | --- | --- |
| Navigation / five mailbox rows / disabled state | Passed | Helium rendered actual unconnected state and local capture banner |
| Search / empty state / sorting / tabs | Passed | zac@ filter, no-match text, descending address sort, three views and Enter activation |
| Capture connection refusal / password lifecycle | Passed | Explicit capture refusal; no saved connection; reopened input empty |
| Placement save and reload | Passed locally | Synthetic Missing observation with `LOCAL QA FIXTURE — no email was sent` note persisted; capture overview says Local preview |
| Light / dark / narrow connection drawer | Passed | health-light.png, health-zoomed.png, health-narrow-connection.png; restored original System theme and zoom |
| Convex typecheck and local function build | Passed | Conductor ready at 11:47:26 after latest transport edits |
| Changed frontend and transitive backend types | Passed | .context/qa/mailbox-health-20261027/tsconfig.json; final tsc exit 0 |
| Focused ESLint / diff whitespace | Passed | Changed email UI/transport/settings modules; git diff --check |
| Existing email tool regression tests | Passed | 32 existing tests, convex/lib/emailTools.test.ts; no tests added |
| Five real mailbox connections / initial reply checks | Passed locally | All five passed SMTP/IMAP verification, persisted after reload and show Last checked; all-five-connected.png |
| SMTP send / pacing / reply import / attachments | Passed for Gmail seed | Spot UI sent at 12:50 PM; Gmail Inbox with SPF/DKIM/DMARC PASS; reply and attachment imported; paced final reply received at 1:00 PM in the same Gmail conversation |
| Unknown / partial recipient acceptance | Reviewed, not live-tested | Unknown sends never replay. Sent-folder reconciliation only for a single-recipient envelope; multi-recipient unknowns stay locked |

## Primitive UI revision

The revised page uses ListToolbar pill tabs, the shared Table and StatusTag,
PillButton actions and SettingsDrawer. Marketing panels and editable sending
limits are removed. Five mailboxes can connect to one operator, with one explicit
default sender. Connections remain paused until resumed. Mailbox management and
default selection are restricted to the owning operator.

Scoped TypeScript and focused ESLint both passed after the revision. Local Convex
reported functions ready at 12:08:07. Helium verified all five rows and the empty
Zac connection drawer; evidence: connection-ready.png. After action-time approval, all five addresses passed SMTP/IMAP verification
and persisted as Connected after reload. Zac remains the selected default;
all five remain paused and outgoing delivery remains captured.

## Instantly reservation

All five insurewithspot.com mailboxes were removed from sending assignments in
Spot US Businesses Treg, Hardware investor_fu, Hardware founder_fu and Hardware
Oct 7 RSVPs Team. Per-mailbox campaign views were audited empty. Final account
list shows all five Active with standard warmups and 100% Instantly health scores.
These scores are not evidence of real provider inbox placement. Adyan was briefly
paused during UI inspection and restored to Active.

Evidence: .context/qa/mailbox-health-20261027/ (gitignored), including
instantly-reserved-warmups.png and per-campaign removal screenshots.

## Fixture / operational notes

One synthetic local placement observation remains, explicitly labelled as QA.
Five live mailbox credentials are encrypted in the local backend. No real
messages sent, production deploys or database migrations.
Local services remain running through npm run conductor:dev. Temporary typecheck
configuration and screenshots remain gitignored.

Memory pressure interrupted earlier checks. Our duplicate/heavy processes and
local services were stopped without touching the unrelated Ollama workload. After
the user freed memory, services were restarted normally and interrupted local
checks were rerun. Earlier incomplete/OOM checks are not counted as passes.

## Controlled live seed workflow — October 27

Actor: Zac, local operator UI. Sender: zac@insurewithspot.com, selected and
resumed; other four mailboxes remain paused. Recipient-restricted mode permits
only Zac's three existing seed addresses; no redirect or domain-wide allowlist.

1. Send a synthetic provider-style message from Spot to the seed addresses.
2. Verify the Gmail message, original authentication and observed folder.
3. Reply from Gmail with a synthetic attachment; check replies in Spot and verify
   conversation threading and the attachment.
4. Reply from Spot and verify receipt; exercise default pacing rather than bypass it.
5. Record placement honestly; retain recipient-restricted delivery and the
   local server for the operator’s continuing UI review. Release code through a reviewed PR and CI; do not copy local
   mailbox credentials into production implicitly.

Outcomes below were verified through the browser.

Observed so far: the 12:50 PM seed arrived in personal Gmail Inbox within one
second. Show original reported SPF PASS, aligned DKIM PASS for insurewithspot.com
and DMARC PASS. A Gmail reply with spot-mailbox-test.txt arrived in the original
Spot thread; opening the stored attachment showed the exact synthetic marker.
An immediate Spot reply was refused by the ten-minute pacing guard with its
editable draft retained. The refusal now skips futile short retries and reports
the approximate wait directly. At 1:00 PM, the saved Spot reply sent successfully and appeared as the third
message in the same Gmail conversation. No duplicate messages resulted from the
pacing refusals.

After syncing the latest main, Email health now uses the shared top-bar page tabs.
Restricted recipient mode is explicitly labelled "Test recipients only". Incoming
Gmail replies appear in Inbox with Needs reply, independently of the Sent filter.

Final state: Zac remains enabled as the selected local sender; the other four
mailboxes remain paused. Local delivery remains restricted to zacyungblut@gmail.com,
zac@spot.insure and zac@yungblut.ca, with no redirect or allowed domains. The
conductor dev server stays running. Production mailbox credentials and activation
remain separate. Microsoft placement and production SMTP egress were not tested.

Artifacts: .context/qa/mailbox-live-20261027/ (gitignored): gmail-delivered.png,
auth-pass.png, spot-reply-imported.png, gmail-roundtrip-complete.png,
spot-roundtrip-complete.png and health-restricted.png. Full CI lint, typecheck,
test and root checks passed on 0f938abe before this documentation-only checkpoint.
